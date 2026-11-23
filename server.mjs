// Petit serveur statique sans dépendance.
//   PORT=8080 HOST=0.0.0.0 node server.mjs
//   TLS_CERT=cert.pem TLS_KEY=key.pem node server.mjs   → HTTPS (nécessaire pour la caméra hors localhost)
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '127.0.0.1';

// Seuls ces dossiers/fichiers sont servis (pas node_modules, scripts, tests…).
const PUBLIC = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor'];

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

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/diag' && req.method === 'POST') return await saveDiagnostic(req, res);
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

// Dans Docker, node tourne en PID 1 : on quitte proprement sur `docker stop`.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
