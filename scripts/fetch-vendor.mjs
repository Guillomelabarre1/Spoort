// Copie MediaPipe Tasks Vision depuis node_modules et télécharge les modèles de pose
// dans ./vendor, pour que l'app tourne sans aucun CDN externe.
import { cp, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const vendor = join(root, 'vendor');

const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  'pose_landmarker_full.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
};

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

await mkdir(join(vendor, 'wasm'), { recursive: true });
await cp(join(pkg, 'vision_bundle.mjs'), join(vendor, 'vision_bundle.mjs'));
await cp(join(pkg, 'wasm'), join(vendor, 'wasm'), { recursive: true });
console.log('✓ MediaPipe Tasks Vision copié dans vendor/');

for (const [name, url] of Object.entries(MODELS)) {
  const dest = join(vendor, name);
  if (await exists(dest)) { console.log(`✓ ${name} déjà présent`); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement de ${name} échoué : HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${name} téléchargé`);
}
