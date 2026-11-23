import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgram, summarize, ProgramRun } from '../js/program.js';
import { CATALOG } from '../js/exercises.js';

test('programme : nettoyage (exercice inconnu retiré, objectifs bornés, nom par défaut)', () => {
  const p = normalizeProgram({ name: '  ', rest: 9999, steps: [
    { exercise: 'pushup', target: 20 }, { exercise: 'inconnu', target: 5 }, { exercise: 'plank', target: 2 }, { exercise: 'squat', target: -3 },
  ] }, CATALOG);
  assert.equal(p.name, 'Mon programme');
  assert.equal(p.rest, 600);
  assert.deepEqual(p.steps, [{ exercise: 'pushup', target: 20 }, { exercise: 'plank', target: 5 }, { exercise: 'squat', target: 1 }]);
});

test('programme : résumé (répétitions, secondes tenues, durée estimée)', () => {
  const p = normalizeProgram({ rest: 30, steps: [{ exercise: 'pushup', target: 20 }, { exercise: 'squat', target: 30 }, { exercise: 'plank', target: 60 }] }, CATALOG);
  const s = summarize(p, CATALOG);
  assert.deepEqual([s.count, s.reps, s.hold], [3, 50, 60]);
  assert.equal(s.minutes, 5); // 125 + 60 + 60 + 30 = 275 s ≈ 4,6 min
});

test('programme : déroulé étape par étape, étape passée = incomplète', () => {
  const run = new ProgramRun(normalizeProgram({ steps: [{ exercise: 'pushup', target: 10 }, { exercise: 'plank', target: 30 }, { exercise: 'squat', target: 15 }] }, CATALOG));
  assert.equal(run.step.exercise, 'pushup');
  assert.equal(run.nextStep.exercise, 'plank');
  run.complete({ done: 10, seconds: 25 });
  run.complete({ done: 20, seconds: 20 }); // gainage arrêté à 20 s sur 30
  assert.ok(run.isLast);
  run.complete({ done: 15, seconds: 40 });
  assert.ok(run.finished);
  assert.deepEqual(run.results.map((r) => r.skipped), [false, true, false]);
  assert.deepEqual(run.report(CATALOG), { completed: 2, total: 3, reps: 25 });
});
