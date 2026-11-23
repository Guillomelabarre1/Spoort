import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastDays, totals, currentStreak, bestSession, pace, heatLevel, dayKey } from '../js/stats.js';

const now = new Date(2026, 10, 23, 18, 0); // lundi 23 nov. 2026, 18 h
const at = (daysAgo, reps, exercise = 'pushup', seconds = 60) => {
  const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(9);
  return { date: d.toISOString(), exercise, reps, partials: 0, seconds };
};
const history = [at(9, 10), at(3, 12), at(2, 15, 'squat'), at(1, 20), at(0, 8), at(0, 5, 'squat')];

test('lastDays additionne par jour, du plus ancien au plus récent', () => {
  const days = lastDays(history, 4, 'all', now);
  assert.deepEqual(days.map((d) => d.reps), [12, 15, 20, 13]);
  assert.equal(days.at(-1).key, dayKey(now));
  assert.deepEqual(lastDays(history, 4, 'squat', now).map((d) => d.reps), [0, 15, 0, 5]);
});

test('totals sur 7 jours et la semaine précédente', () => {
  assert.deepEqual(totals(history, 'all', 7, now), { reps: 60, sessions: 5 });
  assert.deepEqual(totals(history, 'all', 7, now, 7), { reps: 10, sessions: 1 });
  assert.deepEqual(totals(history, 'pushup', 7, now), { reps: 40, sessions: 3 });
});

test('série de jours d\'affilée, y compris si pas encore entraîné aujourd\'hui', () => {
  assert.equal(currentStreak(history, now), 4);
  assert.equal(currentStreak(history.filter((h) => !h.date.startsWith(now.toISOString().slice(0, 10)) || new Date(h.date).getDate() !== now.getDate()), now), 3);
  assert.equal(currentStreak([at(3, 5)], now), 0);
  assert.equal(currentStreak(history, now, 'pushup'), 2);
});

test('record, cadence et niveaux du calendrier', () => {
  assert.equal(bestSession(history).reps, 20);
  assert.equal(bestSession(history, 'squat').reps, 15);
  assert.equal(bestSession([], 'squat'), null);
  assert.equal(pace(30, 60), 30);
  assert.equal(pace(3, 5), null);
  assert.deepEqual([0, 1, 10, 20, 40].map((r) => heatLevel(r, 40)), [0, 1, 1, 2, 4]);
});

test('volume par muscle : principaux 1, secondaires 0,5, maintien 3 s = 1', async () => {
  const { muscleVolume } = await import('../js/stats.js');
  const { CATALOG } = await import('../js/exercises.js');
  const h = [
    { date: now.toISOString(), exercise: 'pushup', reps: 10, seconds: 30 },
    { date: now.toISOString(), exercise: 'plank', kind: 'hold', reps: 60, seconds: 60 },
    { date: new Date(2026, 9, 1).toISOString(), exercise: 'squat', reps: 50, seconds: 60 }, // trop ancien
  ];
  const v = muscleVolume(h, CATALOG, 7, now);
  assert.equal(v.pecs, 10);
  assert.equal(v.abs, 5 + 20); // secondaire des pompes + principal du gainage
  assert.equal(v.quads, undefined);
});

test('les maintiens comptent pour la série mais pas dans les totaux de répétitions', async () => {
  const h = [at(0, 60, 'plank'), at(1, 10)];
  h[0].kind = 'hold';
  assert.equal(currentStreak(h, now), 2);
  assert.deepEqual(totals(h, 'all', 7, now), { reps: 10, sessions: 1 });
  assert.equal(bestSession(h, 'plank').reps, 60);
});
