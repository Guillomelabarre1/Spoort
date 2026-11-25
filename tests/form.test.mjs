import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FormCoach, bodyLine, kneeRatio } from '../js/form.js';
import { RepCounter, LM } from '../js/counter.js';
import { CATALOG } from '../js/exercises.js';

const rep = (low, high, ms, extra = {}) => ({ low, high, ms, downMs: ms * 0.6, partial: false, ...extra });
const feed = (coach, reps) => { for (const r of reps) coach.frame([], 1, { valid: false, angle: null, rep: r }); };

test('bilan : amplitude complète et rythme contrôlé → rien à corriger', () => {
  const c = new FormCoach(CATALOG.squat);
  feed(c, Array.from({ length: 6 }, () => rep(80, 172, 2600)));
  const r = c.report();
  assert.equal(r.verdict, 'good');
  assert.ok(r.items.every((i) => i.kind !== 'tip'));
});

test('bilan : squats trop hauts et trop rapides → conseils de profondeur et de rythme', () => {
  const c = new FormCoach(CATALOG.squat);
  feed(c, Array.from({ length: 6 }, () => rep(98, 172, 900)));
  const r = c.report();
  assert.equal(r.verdict, 'work');
  const text = r.items.filter((i) => i.kind === 'tip').map((i) => i.text).join(' ');
  assert.match(text, /parallèles/);
  assert.match(text, /Ralentis/);
});

test('bilan : répétitions incomplètes et fatigue en fin de série', () => {
  const c = new FormCoach(CATALOG.pushup);
  feed(c, [...Array.from({ length: 6 }, () => rep(20, 100, 2200)), ...Array.from({ length: 4 }, () => rep(48, 100, 2200)), rep(65, 100, 2000, { partial: true }), rep(66, 100, 2000, { partial: true }), rep(64, 100, 2000, { partial: true })]);
  const text = c.report().items.map((i) => i.text).join(' ');
  assert.match(text, /3 répétitions sur 13 incomplètes/);
  assert.match(text, /fin de série/);
});

test('bilan : moins de 3 répétitions → pas de jugement', () => {
  const c = new FormCoach(CATALOG.pushup);
  feed(c, [rep(20, 100, 2000)]);
  assert.equal(c.report().verdict, 'none');
});

test('mesures : corps de profil (hanches basses) et genoux qui rentrent de face', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const put = (i, x, y) => { lm[i] = { x, y, visibility: 0.9 }; };
  put(LM.leftShoulder, 0.2, 0.5); put(LM.leftHip, 0.5, 0.6); put(LM.leftAnkle, 0.85, 0.55);
  for (const i of [LM.rightShoulder, LM.rightHip, LM.rightAnkle]) lm[i] = { x: 0, y: 0, visibility: 0.1 };
  const line = bodyLine(lm);
  assert.ok(line.sag && line.angle < 165, JSON.stringify(line));

  const f = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
  const both = (l, r, dx, y) => { f[l] = { x: 0.5 - dx, y, visibility: 0.9 }; f[r] = { x: 0.5 + dx, y, visibility: 0.9 }; };
  both(LM.leftHip, LM.rightHip, 0.08, 0.5); both(LM.leftKnee, LM.rightKnee, 0.04, 0.65); both(LM.leftAnkle, LM.rightAnkle, 0.08, 0.8);
  assert.ok(kneeRatio(f) < 0.75);
});

test('bilan sur une vraie séance (pompes sur poignées, de face) : 5 bonnes répétitions', () => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/pushup-poignees.json', import.meta.url)));
  const counter = new RepCounter('pushup');
  const coach = new FormCoach(CATALOG.pushup);
  const aspect = d.video.width / d.video.height;
  for (const f of d.frames) {
    const lm = f.lm && Array.from({ length: 33 }, (_, i) => (f.lm[i] ? { x: f.lm[i][0], y: f.lm[i][1], visibility: f.lm[i][2] } : { x: 0, y: 0, visibility: 0 }));
    coach.frame(lm, aspect, counter.update(lm, f.t, aspect));
  }
  const r = coach.report();
  assert.equal(r.detail, '5 bonnes répétitions sur 5');
  assert.notEqual(r.verdict, 'work');
});
