// Rejoue un enregistrement de diagnostic (logs/diag-*.json) dans le compteur actuel.
//   node scripts/replay-diag.mjs logs/diag-....json [--verbose]
import { readFileSync } from 'node:fs';
import { RepCounter } from '../js/counter.js';

const [file, flag] = process.argv.slice(2);
const d = JSON.parse(readFileSync(file, 'utf8'));
const aspect = d.video ? d.video.width / d.video.height : 1;
const c = new RepCounter(d.exercise);
const t0 = d.frames.find((f) => f.s === 'active')?.t ?? 0;
for (const f of d.frames) {
  if (f.s !== 'active') continue;
  const lm = f.lm?.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) ?? null;
  const r = c.update(lm, f.t, aspect);
  if (r.event || flag === '--verbose') {
    console.log(`${((f.t - t0) / 1000).toFixed(1).padStart(5)}s ${r.event ?? ''} reps=${r.reps} phase=${r.phase} val=${r.angle?.toFixed(0)} posture=${r.posture}`);
  }
}
console.log(`Total : ${c.reps} répétitions, ${c.partials} incomplètes`);
