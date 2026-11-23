import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepCounter, LM } from '../js/counter.js';
import { CATALOG, MUSCLES, PRESETS, makeCustom, allExercises } from '../js/exercises.js';

const rad = (d) => d * Math.PI / 180;

/** Squelette debout de face, tous les points visibles ; `over` remplace des points { index: [x, y] }. */
function body(over = {}, visibility = 0.95) {
  const base = {
    [LM.nose]: [0.5, 0.15],
    [LM.leftShoulder]: [0.42, 0.25], [LM.rightShoulder]: [0.58, 0.25],
    [LM.leftElbow]: [0.4, 0.38], [LM.rightElbow]: [0.6, 0.38],
    [LM.leftWrist]: [0.4, 0.5], [LM.rightWrist]: [0.6, 0.5],
    [LM.leftHip]: [0.45, 0.52], [LM.rightHip]: [0.55, 0.52],
    [LM.leftKnee]: [0.45, 0.7], [LM.rightKnee]: [0.55, 0.7],
    [LM.leftAnkle]: [0.45, 0.88], [LM.rightAnkle]: [0.55, 0.88],
  };
  const pts = { ...base, ...over };
  return Array.from({ length: 33 }, (_, i) => {
    const p = pts[i];
    return p ? { x: p[0], y: p[1], visibility: p[2] ?? visibility } : { x: 0.5, y: 0.5, visibility: 0 };
  });
}

/** Point C tel que l'angle ABC vaille `deg`, en tournant depuis la direction B→A. */
function bend(a, b, deg, len, dir = 1) {
  const ang = Math.atan2(a[1] - b[1], a[0] - b[0]) + dir * rad(deg);
  return [b[0] + len * Math.cos(ang), b[1] + len * Math.sin(ang)];
}

function feed(counter, poses, dt = 50, t0 = 0) {
  const events = [];
  poses.forEach((p, i) => { const r = counter.update(p, t0 + i * dt); if (r.event) events.push(r.event); });
  return events;
}
const ramp = (from, to, n = 8) => Array.from({ length: n }, (_, i) => from + (to - from) * i / (n - 1));
const cycle = (top, bottom, n = 8) => [...ramp(top, bottom, n), ...ramp(bottom, top, n)];
const hold = (v, n = 10) => Array(n).fill(v);

test('catalogue : chaque exercice a un détecteur connu et des muscles valides', () => {
  for (const ex of Object.values(CATALOG)) {
    assert.ok(['angle', 'height', 'stature', 'hold'].includes(ex.detector.type), ex.id);
    assert.ok(ex.muscles.primary.length > 0, ex.id);
    for (const m of [...ex.muscles.primary, ...ex.muscles.secondary]) assert.ok(MUSCLES[m], `${ex.id} : ${m}`);
    assert.doesNotThrow(() => new RepCounter(ex.id));
  }
  assert.ok(Object.keys(CATALOG).length >= 15);
});

test('jumping jacks : bras le long du corps → en l\'air → en bas = 1', () => {
  const c = new RepCounter('jumping_jack', { smoothing: 0 });
  const pose = (deg) => {
    const hipL = [0.45, 0.52], shL = [0.42, 0.25], hipR = [0.55, 0.52], shR = [0.58, 0.25];
    return body({ [LM.leftWrist]: bend(hipL, shL, deg, 0.25, 1), [LM.rightWrist]: bend(hipR, shR, deg, 0.25, -1) });
  };
  const events = feed(c, [...hold(15, 3), ...cycle(15, 165), ...cycle(15, 165), ...cycle(15, 165), 15].map(pose));
  assert.equal(c.reps, 3);
  assert.deepEqual(events, ['rep', 'rep', 'rep']);
});

test('fentes alternées : une fente par jambe, chacune compte 1', () => {
  const c = new RepCounter('lunge', { smoothing: 0 });
  const pose = (left, right) => body({
    [LM.leftAnkle]: bend([0.45, 0.52], [0.45, 0.7], left, 0.18, 1),
    [LM.rightAnkle]: bend([0.55, 0.52], [0.55, 0.7], right, 0.18, -1),
  });
  const poses = [
    ...hold(175, 3).map((v) => pose(v, 175)),
    ...cycle(175, 90).map((v) => pose(v, 175)),   // jambe gauche
    ...cycle(175, 90).map((v) => pose(175, v)),   // jambe droite
    pose(175, 175),
  ];
  feed(c, poses);
  assert.equal(c.reps, 2);
});

test('montées de genoux : chaque genou compte séparément', () => {
  const c = new RepCounter('high_knees', { smoothing: 0 });
  const pose = (left, right) => body({
    [LM.leftKnee]: bend([0.42, 0.25], [0.45, 0.52], left, 0.18, -1),
    [LM.rightKnee]: bend([0.58, 0.25], [0.55, 0.52], right, 0.18, 1),
  });
  const poses = [
    ...hold(175, 3).map((v) => pose(v, v)),
    ...cycle(175, 85).map((v) => pose(v, 175)),
    ...cycle(175, 85).map((v) => pose(175, v)),
    ...cycle(175, 85).map((v) => pose(v, 175)),
  ];
  feed(c, poses);
  assert.equal(c.reps, 3);
});

test('dips : hauteur des épaules au-dessus des mains, buste droit', () => {
  const c = new RepCounter('dips', { smoothing: 0 });
  const pose = (pct) => {
    const sy = 0.6 - 0.3 * pct / 100;
    return body({
      [LM.leftShoulder]: [0.42, sy], [LM.rightShoulder]: [0.58, sy],
      [LM.leftWrist]: [0.38, 0.6], [LM.rightWrist]: [0.62, 0.6],
      [LM.leftHip]: [0.45, sy + 0.3], [LM.rightHip]: [0.55, sy + 0.3],
    });
  };
  feed(c, [...hold(100), ...cycle(100, 40), ...cycle(100, 40), 100].map(pose));
  assert.equal(c.reps, 2);
});

test('dips : en planche (hanches au niveau des épaules), rien ne démarre', () => {
  const c = new RepCounter('dips', { smoothing: 0 });
  const pose = (pct) => {
    const sy = 0.6 - 0.3 * pct / 100;
    return body({ [LM.leftShoulder]: [0.42, sy], [LM.rightShoulder]: [0.58, sy], [LM.leftWrist]: [0.38, 0.6], [LM.rightWrist]: [0.62, 0.6], [LM.leftHip]: [0.45, sy + 0.02], [LM.rightHip]: [0.55, sy + 0.02] });
  };
  feed(c, [...hold(100), ...cycle(100, 40), 100].map(pose));
  assert.equal(c.reps, 0);
});

test('burpees : debout → au sol → debout = 1', () => {
  const c = new RepCounter('burpee', { smoothing: 0 });
  const pose = (pct) => {
    const noseY = 0.88 - 0.7 * pct / 100;
    const standing = pct > 70;
    return body({
      [LM.nose]: [0.5, noseY],
      [LM.leftShoulder]: [0.42, noseY + 0.08], [LM.rightShoulder]: [0.58, noseY + 0.08],
      [LM.leftHip]: [0.45, standing ? noseY + 0.35 : noseY + 0.05], [LM.rightHip]: [0.55, standing ? noseY + 0.35 : noseY + 0.05],
    });
  };
  feed(c, [...hold(100), ...cycle(100, 15, 10), ...hold(100, 3), ...cycle(100, 15, 10), 100].map(pose));
  assert.equal(c.reps, 2);
});

test('gainage de profil : compte les secondes tenues, pas debout', () => {
  const plank = body({
    [LM.leftShoulder]: [0.3, 0.6], [LM.rightShoulder]: [0.31, 0.6, 0.3],
    [LM.leftHip]: [0.6, 0.63], [LM.rightHip]: [0.61, 0.63, 0.3],
    [LM.leftWrist]: [0.3, 0.75], [LM.rightWrist]: [0.31, 0.75, 0.3],
  });
  const c = new RepCounter('plank');
  const events = feed(c, Array(80).fill(plank)); // 4 s
  assert.ok(c.reps >= 3 && c.reps <= 4, `reps = ${c.reps}`);
  assert.ok(events.includes('tick'));

  const standing = new RepCounter('plank');
  feed(standing, Array(80).fill(body()));
  assert.equal(standing.reps, 0);
});

test('chaise : cuisses à l\'horizontale, dos droit', () => {
  const sit = body({
    [LM.leftShoulder]: [0.42, 0.2], [LM.rightShoulder]: [0.58, 0.2, 0.3],
    [LM.leftHip]: [0.45, 0.5], [LM.rightHip]: [0.55, 0.5, 0.3],
    [LM.leftKnee]: [0.65, 0.5], [LM.rightKnee]: [0.75, 0.5, 0.3],
    [LM.leftAnkle]: [0.65, 0.78], [LM.rightAnkle]: [0.75, 0.78, 0.3],
  });
  const c = new RepCounter('wall_sit');
  feed(c, Array(70).fill(sit));
  assert.ok(c.reps >= 2, `reps = ${c.reps}`);
  const stand = new RepCounter('wall_sit');
  feed(stand, Array(70).fill(body()));
  assert.equal(stand.reps, 0);
});

test('pont fessier (valeur inversée) : hanches en bas → en haut → en bas = 1', () => {
  const c = new RepCounter('glute_bridge', { smoothing: 0 });
  const pose = (deg) => {
    const sh = [0.2, 0.8], hip = [0.45, 0.78];
    const knee = bend(sh, hip, deg, 0.2, 1);
    return body({ [LM.leftShoulder]: sh, [LM.rightShoulder]: [0.2, 0.8, 0.3], [LM.leftHip]: hip, [LM.rightHip]: [0.45, 0.78, 0.3], [LM.leftKnee]: knee, [LM.rightKnee]: [knee[0], knee[1], 0.3] });
  };
  feed(c, [...hold(125, 3), ...cycle(125, 172), ...cycle(125, 172), 125].map(pose));
  assert.equal(c.reps, 2);
});

test('exercice personnalisé : le mouvement choisi est compté', () => {
  const def = makeCustom({ name: 'Curl élastique', primary: ['biceps'], secondary: ['forearms', 'inconnu'], preset: 'elbows' });
  assert.deepEqual(def.muscles, { primary: ['biceps'], secondary: ['forearms'] });
  const c = new RepCounter(def, { smoothing: 0 });
  const pose = (deg) => body({ [LM.leftWrist]: bend([0.42, 0.25], [0.4, 0.38], deg, 0.12, 1), [LM.rightWrist]: bend([0.58, 0.25], [0.6, 0.38], deg, 0.12, -1) });
  feed(c, [...hold(170, 3), ...cycle(170, 60), ...cycle(170, 60), 170].map(pose));
  assert.equal(c.reps, 2);
  const all = allExercises([{ id: 'custom_x', name: 'Test', primary: ['abs'], preset: 'hold' }]);
  assert.equal(all.custom_x.kind, 'hold');
  assert.ok(all.pushup);
  for (const key of Object.keys(PRESETS)) assert.doesNotThrow(() => new RepCounter(makeCustom({ name: key, preset: key })));
});
