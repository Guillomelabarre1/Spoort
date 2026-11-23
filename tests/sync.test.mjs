import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mergeDocs, normalizeDoc, legacyId, live, tombstone } from '../js/merge.js';

const s1 = { id: 'a', date: '2026-11-01T10:00:00Z', exercise: 'pushup', reps: 10, updatedAt: 1 };
const s2 = { id: 'b', date: '2026-11-02T10:00:00Z', exercise: 'squat', reps: 20, updatedAt: 2 };

test('fusion : union des séances de deux appareils', () => {
  const m = mergeDocs({ history: [s1] }, { history: [s2] });
  assert.deepEqual(m.history.map((h) => h.id), ['a', 'b']);
});

test('fusion : la version la plus récente gagne, les suppressions se propagent', () => {
  const edited = { ...s1, reps: 12, updatedAt: 5 };
  assert.equal(mergeDocs({ history: [s1] }, { history: [edited] }).history[0].reps, 12);
  const gone = mergeDocs({ history: [s1, s2] }, { history: [tombstone(s1, 9)] });
  assert.deepEqual(live(gone.history).map((h) => h.id), ['b']);
  // Une vieille copie hors ligne ne ressuscite pas une séance supprimée.
  assert.equal(live(mergeDocs(gone, { history: [s1] }).history).length, 1);
});

test('fusion : anciennes séances sans id → id stable, sans doublon', () => {
  const old = { date: '2026-11-01T10:00:00.000Z', exercise: 'pushup', reps: 5 };
  const d = normalizeDoc({ history: [old] });
  assert.equal(d.history[0].id, legacyId(old));
  assert.equal(mergeDocs({ history: [old] }, { history: [old] }).history.length, 1);
});

test('fusion : programmes de séance modifiés sur deux appareils', () => {
  const p1 = { id: 'p1', name: 'Haut du corps', rest: 30, steps: [{ exercise: 'pushup', target: 20 }], updatedAt: 1 };
  const p1b = { ...p1, steps: [...p1.steps, { exercise: 'dips', target: 12 }], updatedAt: 3 };
  const p2 = { id: 'p2', name: 'Jambes', rest: 45, steps: [{ exercise: 'squat', target: 30 }], updatedAt: 2 };
  const m = mergeDocs({ programs: [p1, p2] }, { programs: [p1b] });
  assert.equal(m.programs.length, 2);
  assert.equal(m.programs.find((p) => p.id === 'p1').steps.length, 2);
});

test('fusion : profil le plus récent', () => {
  const m = mergeDocs({ profile: { name: 'A', updatedAt: 1 } }, { profile: { name: 'B', updatedAt: 2 } });
  assert.equal(m.profile.name, 'B');
  assert.equal(mergeDocs({ profile: { name: 'A', updatedAt: 1 } }, {}).profile.name, 'A');
});

// ---------- Serveur ----------
let dir, server, base;

/** Petit client HTTP (évite fetch, qui fait planter node:test ici). Renvoie { status, json(), text() }. */
function http(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'repcounter-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  server = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, DEV_USER: '', DATA_SECRET: 'secret-de-test-tres-long' },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await http(base); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('serveur non démarré');
});
after(async () => { server?.kill(); await rm(dir, { recursive: true, force: true }); });
const call = (path, user, opts = {}) => http(base + path, { ...opts, headers: { ...(user ? { 'Remote-User': user, 'Remote-Name': user.toUpperCase() } : {}), 'Content-Type': 'application/json' } });

const tokens = {};
const withToken = (id, opts = {}) => ({ ...opts, headers: { 'X-Profile-Token': tokens[id] ?? '' } });
const req = (path, user, opts = {}) => http(base + path, { ...opts, headers: { ...(user ? { 'Remote-User': user, 'Remote-Name': user.toUpperCase() } : {}), 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
const put = (id, user, doc) => req(`/api/profiles/${id}/data`, user, withToken(id, { method: 'PUT', body: JSON.stringify(doc) }));
const get = (id, user) => req(`/api/profiles/${id}/data`, user, withToken(id));
const create = async (user, body) => {
  const r = await (await call('/api/profiles', user, { method: 'POST', body: JSON.stringify(body) })).json();
  if (r.id) tokens[r.id] = r.token;
  return r;
};

test('serveur : sans identité Pangolin, pas de synchro ni de profils', async () => {
  assert.deepEqual(await (await call('/api/me')).json(), { sync: false });
  assert.equal((await call('/api/profiles')).status, 403);
});

test('serveur : création de profils avec code, liste (prénom, photo, code présent)', async () => {
  const avatar = 'data:image/jpeg;base64,' + Buffer.from('photo').toString('base64');
  const a = await create('guillome', { name: 'Guillome', avatar, pin: '1234' });
  const b = await create('guillome', { name: 'Copine', pin: '0000' });
  assert.match(a.id, /^p_[a-f0-9]{16}$/);
  assert.ok(a.token.length > 30);
  const list = await (await call('/api/profiles', 'guillome')).json();
  assert.deepEqual(list.map((p) => [p.name, p.hasPin]), [['Guillome', true], ['Copine', true]]);
  assert.equal(list[0].avatar, avatar);
  assert.equal((await call('/api/profiles', 'guillome', { method: 'POST', body: JSON.stringify({ name: 'X' }) })).status, 400); // sans code
  assert.equal((await call('/api/profiles', 'guillome', { method: 'POST', body: JSON.stringify({ name: 'X', pin: '12a4' }) })).status, 400);
  globalThis.ids = { a: a.id, b: b.id };
});

test('serveur : sans le bon jeton, les données sont inaccessibles', async () => {
  const { a } = globalThis.ids;
  assert.equal((await req(`/api/profiles/${a}/data`, 'guillome')).status, 401);
  assert.equal((await req(`/api/profiles/${a}/data`, 'guillome', { headers: { 'X-Profile-Token': 'faux' } })).status, 401);
  assert.equal((await req(`/api/profiles/${a}/data`, 'guillome', { method: 'PUT', body: '{}', headers: { 'X-Profile-Token': tokens[globalThis.ids.b] } })).status, 401); // jeton d'un autre profil
  assert.equal((await get(a, 'guillome')).status, 200);
  // Le fichier du code n'est jamais servi, et l'empreinte n'apparaît pas dans les données.
  const doc = await (await get(a, 'guillome')).text();
  assert.ok(!doc.includes('pinHash'));
});

test('serveur : chaque profil a ses propres données, fusionnées à chaque envoi', async () => {
  const { a, b } = globalThis.ids;
  await put(a, 'guillome', { history: [s1] });
  const r = await (await put(a, 'guillome', { history: [s2] })).json();
  assert.deepEqual(r.history.map((h) => h.id), ['a', 'b']);
  assert.equal((await (await get(b, 'guillome')).json()).history.length, 0);
  assert.equal(r.profile.name, 'Guillome');
});

test('serveur : envois simultanés de deux appareils, rien n\'est perdu', async () => {
  const { b } = globalThis.ids;
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, date: new Date(2026, 10, 3, i).toISOString(), exercise: 'pushup', reps: i, updatedAt: 10 + i }));
  await Promise.all(items.map((it) => put(b, 'elle', { history: [it] })));
  assert.equal((await (await get(b, 'elle')).json()).history.length, 20);
});

test('serveur : déverrouillage par code, attente après 5 erreurs', async () => {
  const { b } = globalThis.ids;
  const unlock = (pin) => req(`/api/profiles/${b}/unlock`, 'guillome', { method: 'POST', body: JSON.stringify({ pin }) });
  const ok = await unlock('0000');
  assert.equal(ok.status, 200);
  const t2 = (await ok.json()).token;
  assert.equal((await req(`/api/profiles/${b}/data`, 'guillome', { headers: { 'X-Profile-Token': t2 } })).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await unlock('9999')).status, 401);
  const fifth = await unlock('9999');
  assert.equal(fifth.status, 401);
  const blocked = await unlock('0000'); // même le bon code doit attendre
  assert.equal(blocked.status, 429);
  assert.ok((await blocked.json()).retryAfter > 0);
});

test('serveur : changer de code révoque les anciens accès', async () => {
  const { a } = globalThis.ids;
  const old = tokens[a];
  const r = await req(`/api/profiles/${a}/pin`, 'guillome', { method: 'PUT', body: JSON.stringify({ pin: '4321' }), headers: { 'X-Profile-Token': old } });
  assert.equal(r.status, 200);
  tokens[a] = (await r.json()).token;
  assert.equal((await req(`/api/profiles/${a}/data`, 'guillome', { headers: { 'X-Profile-Token': old } })).status, 401);
  assert.equal((await get(a, 'guillome')).status, 200);
  // Verrouiller cet appareil : le jeton ne marche plus.
  await req(`/api/profiles/${a}/lock`, 'guillome', { method: 'POST', headers: { 'X-Profile-Token': tokens[a] } });
  assert.equal((await get(a, 'guillome')).status, 401);
  tokens[a] = (await (await req(`/api/profiles/${a}/unlock`, 'guillome', { method: 'POST', body: JSON.stringify({ pin: '4321' }) })).json()).token;
});

test('serveur : ancien profil sans code → accessible jusqu\'à la création du code', async () => {
  const id = 'p_00000000000legacy'.replace('legacy', 'abcdef');
  await (await import('node:fs/promises')).mkdir(join(dir, 'profiles'), { recursive: true });
  await (await import('node:fs/promises')).writeFile(join(dir, 'profiles', `${id}.json`), JSON.stringify({ profile: { name: 'Ancien' } }));
  const list = await (await call('/api/profiles', 'guillome')).json();
  assert.equal(list.find((p) => p.id === id).hasPin, false);
  assert.equal((await req(`/api/profiles/${id}/data`, 'guillome')).status, 200);
  const r = await req(`/api/profiles/${id}/pin`, 'guillome', { method: 'PUT', body: JSON.stringify({ pin: '1111' }) });
  assert.equal(r.status, 200);
  assert.equal((await req(`/api/profiles/${id}/data`, 'guillome')).status, 401);
});

test('serveur : fichiers chiffrés sur le disque (rien de lisible)', async () => {
  const { readFile: rf, readdir: rd } = await import('node:fs/promises');
  const { b } = globalThis.ids;
  const raw = await rf(join(dir, 'profiles', `${b}.json`), 'utf8');
  const box = JSON.parse(raw);
  assert.equal(box.alg, 'aes-256-gcm');
  assert.ok(!raw.includes('Copine') && !raw.includes('pushup'));
  // Le code PIN n'est stocké que sous forme d'empreinte.
  const auth = await rf(join(dir, 'profiles', `${b}.auth.json`), 'utf8');
  assert.ok(!auth.includes('"0000"'));
  assert.ok((await rd(join(dir, 'profiles'))).every((f) => !f.endsWith('.tmp')));
});

test('serveur : mauvaise clé → erreur claire, données jamais écrasées', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const { b } = globalThis.ids;
  const before = await rf(join(dir, 'profiles', `${b}.json`), 'utf8');
  const port2 = 40000 + Math.floor(Math.random() * 10000);
  const other = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port2), HOST: '127.0.0.1', DATA_DIR: dir, DEV_USER: '', DATA_SECRET: 'une-autre-cle-pas-la-bonne' },
    stdio: 'ignore',
  });
  try {
    const b2 = `http://127.0.0.1:${port2}`;
    for (let i = 0; i < 50; i++) { try { await http(b2); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const h = { 'Remote-User': 'x', 'Content-Type': 'application/json', 'X-Profile-Token': tokens[b] };
    const r = await http(`${b2}/api/profiles/${b}/data`, { method: 'PUT', headers: h, body: JSON.stringify({ history: [] }) });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /clé de chiffrement/);
    assert.equal(await rf(join(dir, 'profiles', `${b}.json`), 'utf8'), before);
  } finally {
    other.kill();
  }
});

test('serveur : photo invalide retirée, profil inconnu refusé, chemins piégés refusés', async () => {
  const { a } = globalThis.ids;
  const r = await (await put(a, 'guillome', { profile: { name: 'G', avatar: 'javascript:alert(1)', updatedAt: Date.now() + 1000 } })).json();
  assert.equal(r.profile.avatar, undefined);
  assert.equal((await call('/api/profiles/p_0000000000000000/data', 'guillome')).status, 404);
  assert.equal((await call('/api/profiles/..%2F..%2Fserver/data', 'guillome')).status, 404);
  assert.equal((await req(`/api/profiles/${a}/data`, 'guillome', withToken(a, { method: 'PUT', body: '{oops' }))).status, 400);
  assert.equal((await http(`${base}/server.mjs`)).status, 404);
});

test('serveur : suppression d\'un profil (code exigé, mis à la corbeille)', async () => {
  const { a, b } = globalThis.ids;
  assert.equal((await req(`/api/profiles/${b}/data`, 'guillome', { method: 'DELETE' })).status, 401);
  assert.equal((await req(`/api/profiles/${a}/data`, 'guillome', withToken(a, { method: 'DELETE' }))).status, 200);
  const list = await (await call('/api/profiles', 'guillome')).json();
  assert.ok(!list.some((p) => p.id === a));
  assert.equal((await readdir(join(dir, 'trash'))).length, 2); // données + code
});
