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

test('AMRAP : la liste tourne en boucle, score = tours complets + répétitions du tour entamé', () => {
  const p = normalizeProgram({ mode: 'amrap', duration: 1200, steps: [{ exercise: 'pushup', target: 10 }, { exercise: 'squat', target: 20 }, { exercise: 'burpee', target: 10 }] }, CATALOG);
  assert.equal(p.rest, 0); // pas de repos par défaut
  const run = new ProgramRun(p);
  for (let i = 0; i < 6; i++) run.complete({ done: run.step.target });
  assert.equal(run.round, 2);
  assert.equal(run.step.exercise, 'pushup');
  assert.ok(!run.finished && !run.isLast);
  run.complete({ done: 10 });
  run.complete({ done: 12 }); // temps écoulé pendant les squats
  assert.deepEqual([run.report(CATALOG).rounds, run.report(CATALOG).extra, run.report(CATALOG).reps], [2, 22, 102]);
  assert.deepEqual(run.perSlot().map((x) => x.done), [30, 52, 20]);
  const sum = summarize(p, CATALOG);
  assert.deepEqual([sum.amrap, sum.minutes, sum.perRound], [true, 20, 40]);
});

test('programme en plusieurs tours et étapes chronométrées (« le plus possible en 30 s »)', () => {
  const p = normalizeProgram({ rounds: 3, rest: 10, steps: [{ exercise: 'squat', target: 20, timed: true }, { exercise: 'plank', target: 30, timed: true }] }, CATALOG);
  assert.deepEqual(p.steps, [{ exercise: 'squat', target: 20, timed: true }, { exercise: 'plank', target: 30 }]); // le gainage est déjà en secondes
  const run = new ProgramRun(p);
  assert.equal(run.length, 6);
  run.complete({ done: 14, timeUp: true });  // 14 squats en 20 s : réussi
  run.complete({ done: 30 });
  run.complete({ done: 9 });                 // passé avant la fin du temps
  assert.deepEqual(run.results.map((r) => r.skipped), [false, false, true]);
  assert.equal(run.round, 1);
  while (!run.finished) run.complete({ done: 30, timeUp: true });
  assert.equal(run.report(CATALOG).total, 6);
  const sum = summarize(p, CATALOG);
  assert.equal(sum.hold, 150); // (20 + 30) × 3
});

test('séances toutes prêtes : exercices connus, rien de perdu au nettoyage', async () => {
  const { LIBRARY } = await import('../js/library.js');
  assert.ok(LIBRARY.length >= 6);
  for (const lib of LIBRARY) {
    const p = normalizeProgram(lib, CATALOG);
    assert.equal(p.steps.length, lib.steps.length, lib.key);
    assert.equal(p.mode, lib.mode, lib.key);
    if (lib.source) assert.match(lib.source.url, /^https:\/\//);
  }
});
