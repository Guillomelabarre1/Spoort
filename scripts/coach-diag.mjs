// Rejoue un diagnostic et affiche le bilan de posture.
//   node scripts/coach-diag.mjs logs/diag-....json
import { readFileSync } from 'node:fs';
import { RepCounter } from '../js/counter.js';
import { FormCoach } from '../js/form.js';
import { CATALOG } from '../js/exercises.js';

for (const file of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const aspect = d.video ? d.video.width / d.video.height : 1;
  const ex = d.exerciseDef ?? CATALOG[d.exercise];
  const c = new RepCounter(ex);
  const coach = new FormCoach(ex);
  for (const f of d.frames) {
    if (f.s && f.s !== 'active') continue;
    const lm = !f.lm ? null : Array.isArray(f.lm)
      ? f.lm.map(([x, y, z, visibility]) => ({ x, y, z, visibility }))
      : Array.from({ length: 33 }, (_, i) => (f.lm[i] ? { x: f.lm[i][0], y: f.lm[i][1], visibility: f.lm[i][2] } : { x: 0, y: 0, visibility: 0 }));
    coach.frame(lm, aspect, c.update(lm, f.t, aspect));
  }
  console.log(`\n${file} — ${c.reps} reps, ${c.partials} incomplètes`);
  console.log(coach.reps.map((r) => `low ${r.low.toFixed(0)} high ${r.high.toFixed(0)} ${r.ms} ms${r.partial ? ' (incomplète)' : ''}${r.line ? ` ligne ${r.line.angle.toFixed(0)}°` : ''}`).join('\n'));
  console.log(JSON.stringify(coach.report(), null, 1));
}
