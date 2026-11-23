// Petit serveur statique sans dépendance.
//   PORT=8080 HOST=0.0.0.0 node server.mjs
//   TLS_CERT=cert.pem TLS_KEY=key.pem node server.mjs   → HTTPS (nécessaire pour la caméra hors localhost)
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, scrypt, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename, readdir } from 'node:fs/promises';
import { mergeDocs, normalizeDoc, emptyDoc, LISTS } from './js/merge.js';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '127.0.0.1';

// Seuls ces dossiers/fichiers sont servis (pas node_modules, scripts, tests…).
const PUBLIC = ['index.html', 'dashboard.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// Optionnel : DIAG_DIR=logs → l'app peut envoyer ses enregistrements de diagnostic (POST /api/diag).
// Chemin relatif au projet (logs) ou absolu (/data/diag dans Docker).
const DIAG_DIR = process.env.DIAG_DIR ? resolve(root, process.env.DIAG_DIR) : null;
const DIAG_MAX_FILES = 200; // garde-fou : l'endpoint est public quand il est activé
const DIAG_MAX_BYTES = 25 * 1024 * 1024;

async function saveDiagnostic(req, res) {
  if (!DIAG_DIR) return res.writeHead(404).end('Not found');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > DIAG_MAX_BYTES) return res.writeHead(413).end('Too large');
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return res.writeHead(400).end('Bad JSON'); }
  const { mkdir, writeFile, readdir } = await import('node:fs/promises');
  await mkdir(DIAG_DIR, { recursive: true });
  if ((await readdir(DIAG_DIR)).length >= DIAG_MAX_FILES) return res.writeHead(507).end('Diagnostic storage full');
  const name = `diag-${new Date().toISOString().replace(/[:.]/g, '-')}-${String(data.exercise ?? 'x').replace(/\W/g, '')}.json`;
  await writeFile(join(DIAG_DIR, name), JSON.stringify(data));
  console.log(`Diagnostic reçu : ${name} (${data.frames?.length ?? 0} images, ${data.result?.reps ?? '?'} reps)`);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
}

// ---------- Profils synchronisés ----------
// DATA_DIR=/data/users : un fichier JSON par profil (profiles/<id>.json). Chacun choisit son profil
// sur la page « Qui s'entraîne ? ». L'accès est réservé aux personnes connectées via Pangolin :
// l'en-tête Remote-User est ajouté par Pangolin (et supprimé s'il est envoyé par le visiteur).
// Sans cet en-tête, la synchro est désactivée et l'app garde ses données sur le téléphone.
// ⚠️ Ne jamais publier le port du conteneur directement : seul Pangolin doit pouvoir le joindre.
const DATA_DIR = process.env.DATA_DIR ? resolve(root, process.env.DATA_DIR) : null;
const PROFILES_DIR = DATA_DIR && join(DATA_DIR, 'profiles');
const IDENTITY_HEADER = (process.env.IDENTITY_HEADER ?? 'remote-user').toLowerCase();
const DEV_USER = process.env.DEV_USER || null; // développement local uniquement : simule un utilisateur
// SHARED_ACCESS=1 : pas de comptes Pangolin. Tous les visiteurs partagent le même espace et chaque
// profil n'est protégé que par son code PIN. L'en-tête d'identité est alors ignoré.
const SHARED_ACCESS = /^(1|true|yes|oui)$/i.test(process.env.SHARED_ACCESS ?? '');
const DATA_MAX_BYTES = 5 * 1024 * 1024;
const LIST_MAX = 20000;
const PROFILES_MAX = 20;
const AVATAR_MAX = 300 * 1024;
const ID_RE = /^p_[a-z0-9]{8,32}$/;
const writeQueues = new Map(); // une écriture à la fois par profil

function identity(req) {
  if (SHARED_ACCESS) return DATA_DIR ? { name: 'Famille' } : null;
  const user = req.headers[IDENTITY_HEADER] || DEV_USER;
  if (!user || !DATA_DIR) return null;
  const name = req.headers['remote-name'] || (DEV_USER && !req.headers[IDENTITY_HEADER] ? DEV_USER : String(user).split('@')[0]);
  return { name: String(name).slice(0, 60) };
}

const json = (res, code, body) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
const fail = (status, message) => Object.assign(new Error(message), { status });
const profileFile = (id) => join(PROFILES_DIR, `${id}.json`);

// ---------- Chiffrement des données au repos ----------
// Chaque fichier de profil est chiffré en AES-256-GCM (authentifié : toute modification du fichier
// est détectée), lié à son identifiant de profil. La clé vient de DATA_SECRET (à mettre en secret
// dans Dockhand) ; sans DATA_SECRET, une clé aléatoire est créée dans DATA_DIR/.key (moins sûr :
// elle voyage avec les sauvegardes du volume). Perdre la clé = perdre les données.
let DATA_KEY = null;
if (DATA_DIR) {
  if (process.env.DATA_SECRET) {
    if (process.env.DATA_SECRET.length < 16) throw new Error('DATA_SECRET doit faire au moins 16 caractères');
    DATA_KEY = scryptSync(process.env.DATA_SECRET, 'repcounter-data-v1', 32);
  } else {
    const keyFile = join(DATA_DIR, '.key');
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    DATA_KEY = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex');
    console.warn(`⚠️  DATA_SECRET non défini : clé de chiffrement stockée dans ${keyFile} (définis DATA_SECRET pour la séparer des données).`);
  }
}

function encrypt(id, text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', DATA_KEY, iv);
  c.setAAD(Buffer.from(id));
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(id, raw) {
  const box = JSON.parse(raw);
  if (box?.alg !== 'aes-256-gcm') return box; // ancien fichier en clair : chiffré à la prochaine écriture
  try {
    const d = createDecipheriv('aes-256-gcm', DATA_KEY, Buffer.from(box.iv, 'base64'));
    d.setAAD(Buffer.from(id));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
  } catch {
    // Jamais de document vide ici : on écraserait les vraies données à la prochaine écriture.
    throw fail(500, 'Déchiffrement impossible : clé de chiffrement (DATA_SECRET) incorrecte ou fichier modifié');
  }
}

const idOf = (file) => file.split(/[\\/]/).pop().replace(/\.json$/, '');

async function readDoc(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return emptyDoc();
    throw err;
  }
  return normalizeDoc(decrypt(idOf(file), raw));
}

async function readBody(req, max) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(413, 'Too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Bad JSON'); }
}

/** Photo de profil : uniquement une image en data URL, de taille raisonnable. */
function sanitize(doc) {
  const p = doc.profile;
  if (p && typeof p === 'object') {
    if (p.avatar && !(typeof p.avatar === 'string' && p.avatar.length <= AVATAR_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.avatar))) delete p.avatar;
    if (p.name != null) p.name = String(p.name).slice(0, 40);
  }
  return doc;
}

async function writeDoc(id, update) {
  const prev = writeQueues.get(id) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(async () => {
    const merged = sanitize(update(await readDoc(profileFile(id))));
    for (const list of LISTS) if (merged[list].length > LIST_MAX) merged[list] = merged[list].slice(-LIST_MAX);
    await mkdir(PROFILES_DIR, { recursive: true });
    const tmp = `${profileFile(id)}.${process.pid}.tmp`;
    await writeFile(tmp, encrypt(id, JSON.stringify(merged)));
    await rename(tmp, profileFile(id)); // écriture atomique : jamais de fichier à moitié écrit
    return merged;
  });
  writeQueues.set(id, task);
  return task;
}

async function listProfiles() {
  const files = await readdir(PROFILES_DIR).catch(() => []);
  const out = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !ID_RE.test(id)) continue;
    let profile;
    try { ({ profile } = await readDoc(profileFile(id))); } catch (err) {
      console.error(`Profil ${id} illisible : ${err.message}`); // ne bloque pas les autres profils
      continue;
    }
    const hasPin = Boolean((await readFile(join(PROFILES_DIR, `${id}.auth.json`), 'utf8').then(JSON.parse).catch(() => null))?.pinHash);
    out.push({ id, name: profile?.name ?? 'Profil', avatar: profile?.avatar ?? null, color: profile?.color ?? null, createdAt: profile?.createdAt ?? 0, hasPin });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- Code PIN par profil ----------
// Le code n'est jamais stocké en clair : empreinte scrypt + sel, dans profiles/<id>.auth.json (jamais
// renvoyé au navigateur). Un code juste donne un jeton d'accès propre à l'appareil (180 jours), à
// envoyer dans l'en-tête X-Profile-Token pour lire / modifier les données du profil.
// Après 5 erreurs, attente croissante (30 s, 1 min, 2 min… jusqu'à 15 min) : impossible d'essayer
// les 10 000 codes.
const PIN_RE = /^\d{4}$/;
const TOKEN_TTL = 180 * 86400000;
const TOKENS_MAX = 20;
const attempts = new Map(); // id → { fails, until }
const scryptAsync = promisify(scrypt);
const authFile = (id) => join(PROFILES_DIR, `${id}.auth.json`);
const sha256 = (t) => createHash('sha256').update(String(t)).digest('hex');
const sameHex = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function readAuth(id) {
  try { return JSON.parse(await readFile(authFile(id), 'utf8')); } catch { return null; }
}

async function writeAuth(id, auth) {
  await mkdir(PROFILES_DIR, { recursive: true });
  const tmp = `${authFile(id)}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(auth));
  await rename(tmp, authFile(id));
}

const hashPin = async (pin, salt) => (await scryptAsync(String(pin), salt, 32)).toString('hex');

/** Nouveau jeton d'accès pour cet appareil (les jetons expirés sont retirés). */
async function issueToken(id, auth) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  auth.tokens = [...(auth.tokens ?? []).filter((t) => now - t.createdAt < TOKEN_TTL), { hash: sha256(token), createdAt: now }].slice(-TOKENS_MAX);
  await writeAuth(id, auth);
  return token;
}

/** Définit (ou remplace) le code : tous les anciens jetons sont révoqués. Renvoie un jeton. */
async function setPin(id, pin) {
  if (!PIN_RE.test(String(pin ?? ''))) throw fail(400, 'Le code doit faire 4 chiffres');
  const salt = randomBytes(16).toString('hex');
  return issueToken(id, { salt, pinHash: await hashPin(pin, salt), tokens: [], updatedAt: Date.now() });
}

/** L'appareil a-t-il accès à ce profil ? (Profil sans code : accès libre, en attendant qu'il en ait un.) */
async function authorized(req, id) {
  const auth = await readAuth(id);
  if (!auth?.pinHash) return true;
  const token = req.headers['x-profile-token'];
  if (!token) return false;
  const h = sha256(token), now = Date.now();
  return (auth.tokens ?? []).some((t) => now - t.createdAt < TOKEN_TTL && sameHex(t.hash, h));
}

async function unlock(id, pin) {
  const a = attempts.get(id) ?? { fails: 0, until: 0 };
  const wait = a.until - Date.now();
  if (wait > 0) throw Object.assign(fail(429, `Trop d'essais. Réessaie dans ${Math.ceil(wait / 1000)} s.`), { retryAfter: Math.ceil(wait / 1000) });
  const auth = await readAuth(id);
  if (!auth?.pinHash) throw fail(409, 'Ce profil n\'a pas encore de code');
  if (PIN_RE.test(String(pin ?? '')) && sameHex(await hashPin(pin, auth.salt), auth.pinHash)) {
    attempts.delete(id);
    return issueToken(id, auth);
  }
  a.fails += 1;
  if (a.fails >= 5) a.until = Date.now() + Math.min(15 * 60000, 30000 * 2 ** (a.fails - 5));
  attempts.set(id, a);
  const left = Math.max(0, 5 - a.fails);
  throw Object.assign(fail(401, left ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} avant attente)` : 'Code incorrect'), { retryAfter: a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0 });
}

async function handleSync(req, res, path) {
  const who = identity(req);
  if (path === '/api/me') return json(res, 200, who ? { sync: true, user: who } : { sync: false });
  if (!who) throw fail(403, 'Synchronisation indisponible (pas d\'identité Pangolin)');

  if (path === '/api/profiles') {
    if (req.method === 'GET') return json(res, 200, await listProfiles());
    if (req.method !== 'POST') throw fail(405, 'Méthode non autorisée');
    const body = await readBody(req, AVATAR_MAX + 4096);
    const name = String(body?.name ?? '').trim().slice(0, 40);
    if (!name) throw fail(400, 'Prénom manquant');
    if (!PIN_RE.test(String(body?.pin ?? ''))) throw fail(400, 'Le code doit faire 4 chiffres');
    if ((await listProfiles()).length >= PROFILES_MAX) throw fail(409, 'Trop de profils');
    const id = `p_${randomBytes(8).toString('hex')}`;
    const now = Date.now();
    const token = await setPin(id, body.pin);
    await writeDoc(id, (doc) => ({ ...doc, profile: { name, avatar: body.avatar ?? null, createdAt: now, updatedAt: now } }));
    return json(res, 201, { id, token });
  }

  const m = path.match(/^\/api\/profiles\/([^/]+)\/(data|unlock|pin|lock)$/);
  if (!m || !ID_RE.test(m[1])) throw fail(404, 'Profil inconnu');
  const [, id, action] = m;
  const exists = await stat(profileFile(id)).then(() => true, () => false);
  if (!exists) throw fail(404, 'Profil inconnu');

  if (action === 'unlock') {
    if (req.method !== 'POST') throw fail(405, 'Méthode non autorisée');
    const { pin } = (await readBody(req, 1024)) ?? {};
    return json(res, 200, { token: await unlock(id, pin) });
  }
  // Tout le reste exige l'accès au profil.
  if (!(await authorized(req, id))) throw fail(401, 'Profil verrouillé');

  if (action === 'pin') {
    if (req.method !== 'PUT') throw fail(405, 'Méthode non autorisée');
    const { pin } = (await readBody(req, 1024)) ?? {};
    return json(res, 200, { token: await setPin(id, pin) });
  }
  if (action === 'lock') {
    // Oublie le jeton de cet appareil.
    const auth = await readAuth(id);
    const h = sha256(req.headers['x-profile-token'] ?? '');
    if (auth?.tokens) { auth.tokens = auth.tokens.filter((t) => !sameHex(t.hash, h)); await writeAuth(id, auth); }
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET') return json(res, 200, await readDoc(profileFile(id)));
  if (req.method === 'PUT') {
    const incoming = await readBody(req, DATA_MAX_BYTES);
    return json(res, 200, await writeDoc(id, (doc) => mergeDocs(doc, incoming)));
  }
  if (req.method === 'DELETE') {
    // Suppression : les fichiers partent dans trash/ (récupérables à la main), jamais effacés directement.
    await (writeQueues.get(id) ?? Promise.resolve()).catch(() => {});
    await mkdir(join(DATA_DIR, 'trash'), { recursive: true });
    const stamp = Date.now();
    await rename(profileFile(id), join(DATA_DIR, 'trash', `${id}-${stamp}.json`));
    await rename(authFile(id), join(DATA_DIR, 'trash', `${id}-${stamp}.auth.json`)).catch(() => {});
    return json(res, 200, { ok: true });
  }
  throw fail(405, 'Méthode non autorisée');
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/diag' && req.method === 'POST') return await saveDiagnostic(req, res);
    if (url.pathname === '/api/me' || url.pathname.startsWith('/api/profiles')) {
      try { return await handleSync(req, res, url.pathname); } catch (err) { return json(res, err.status ?? 500, { error: err.message, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) }); }
    }
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = normalize(join(root, rel));
    const top = rel.split('/')[0];
    if (!file.startsWith(root + sep) || !PUBLIC.includes(top)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': top === 'vendor' ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(self), microphone=()',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Server error');
  }
}

const tls = process.env.TLS_CERT && process.env.TLS_KEY
  ? { cert: await readFile(process.env.TLS_CERT), key: await readFile(process.env.TLS_KEY) }
  : null;

const server = tls ? createHttps(tls, handler) : createHttp(handler);
server.listen(PORT, HOST, () => {
  if (DIAG_DIR) console.log(`Diagnostics activés → ${DIAG_DIR}`);
  if (DATA_DIR) console.log(`Profils synchronisés → ${PROFILES_DIR} (accès : ${SHARED_ACCESS ? 'partagé, protégé par les codes PIN' : `en-tête ${IDENTITY_HEADER}`})`);
  if (DEV_USER) console.warn(`⚠️  DEV_USER=${DEV_USER} : toute requête sans identité est attribuée à cet utilisateur (développement uniquement)`);
  console.log(`RepCounter sur ${tls ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (!tls && HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.log('⚠️  En HTTP, l\'iPhone refusera la caméra : utilise HTTPS (voir README).');
  }
});

// Optionnel : page HTTP d'installation du certificat racine sur l'iPhone (CA_CERT=certs/RepCounter-CA.crt).
// Ne sert que le certificat public (jamais la clé) et un lien vers l'app en HTTPS.
if (tls && process.env.CA_CERT) {
  const CA_PORT = Number(process.env.CA_PORT ?? 8080);
  const ca = await readFile(process.env.CA_CERT);
  createHttp((req, res) => {
    const host = (req.headers.host ?? 'localhost').split(':')[0];
    if (req.url === '/RepCounter-CA.crt') {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="RepCounter-CA.crt"',
      });
      return res.end(ca);
    }
    const app = `https://${host}:${PORT}/`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Installer RepCounter</title>
<body style="font:17px -apple-system,sans-serif;max-width:520px;margin:24px auto;padding:0 16px;line-height:1.5">
<h1>Installer RepCounter</h1>
<ol>
<li><a href="/RepCounter-CA.crt">Télécharger le certificat</a>, puis « Autoriser ».</li>
<li>Réglages → Général → VPN et gestion de l'appareil → « RepCounter Local CA » → Installer.</li>
<li>Réglages → Général → Informations → Réglages des certificats → activer « RepCounter Local CA ».</li>
<li>Ouvrir <a href="${app}">${app}</a>, puis Partager → Sur l'écran d'accueil.</li>
</ol></body>`);
  }).listen(CA_PORT, HOST, () => console.log(`Installation du certificat : http://${HOST}:${CA_PORT}`));
}

// Au démarrage : les fichiers de profils encore en clair sont chiffrés.
if (DATA_DIR && existsSync(PROFILES_DIR)) {
  for (const f of readdirSync(PROFILES_DIR)) {
    const id = f.replace(/\.json$/, '');
    if (!f.endsWith('.json') || !ID_RE.test(id)) continue;
    const raw = readFileSync(join(PROFILES_DIR, f), 'utf8');
    if (JSON.parse(raw)?.alg === 'aes-256-gcm') continue;
    writeFileSync(join(PROFILES_DIR, f), encrypt(id, raw));
    console.log(`Profil ${id} chiffré.`);
  }
}

// Dans Docker, node tourne en PID 1 : on quitte proprement sur `docker stop`.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
