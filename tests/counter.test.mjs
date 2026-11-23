import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { RepCounter, angleAt, LM } from '../js/counter.js';

const rad = (d) => d * Math.PI / 180;

/** Pose synthétique : 33 points, l'articulation suivie a l'angle demandé. */
function pose(exercise, deg, { visibility = 0.9, noseY = 0.33, torsoVertical = false } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility }; };
  const both = (l, r, x, y) => { set(l, x, y); set(r, x, y); };
  const t = rad(deg);

  if (exercise === 'pushup') {
    // `deg` = hauteur des épaules au-dessus des mains, en % de la hauteur bras tendus (0.3).
    const shoulderY = 0.7 - 0.3 * deg / 100;
    both(LM.leftWrist, LM.rightWrist, 0.4, 0.7);
    both(LM.leftShoulder, LM.rightShoulder, 0.4, shoulderY);
    // Debout : hanches bien plus bas que les épaules, mains qui pendent à côté.
    both(LM.leftHip, LM.rightHip, 0.42, torsoVertical ? shoulderY + 0.27 : shoulderY + 0.05);
  } else if (exercise === 'squat') {
    both(LM.leftHip, LM.rightHip, 0.5, 0.4);
    both(LM.leftKnee, LM.rightKnee, 0.5, 0.6);
    both(LM.leftAnkle, LM.rightAnkle, 0.5 + 0.2 * Math.sin(t), 0.6 - 0.2 * Math.cos(t));
  } else if (exercise === 'pullup') {
    both(LM.leftShoulder, LM.rightShoulder, 0.5, 0.4);
    both(LM.leftElbow, LM.rightElbow, 0.5, 0.3);
    both(LM.leftWrist, LM.rightWrist, 0.5 + 0.1 * Math.sin(t), 0.3 + 0.1 * Math.cos(t));
    set(LM.nose, 0.5, noseY);
  }
  return lm;
}

/** Fait passer une suite d'angles (une image toutes les 50 ms) et renvoie les événements. */
function run(counter, exercise, angles, opts) {
  const events = [];
  angles.forEach((deg, i) => {
    const o = typeof opts === 'function' ? opts(deg, i) : opts;
    const r = counter.update(pose(exercise, deg, o), i * 50);
    if (r.event) events.push(r.event);
  });
  return events;
}

/** Un mouvement complet : tendu → fléchi → tendu, en `steps` images par demi-mouvement. */
function rep(from, to, steps = 8) {
  const down = Array.from({ length: steps }, (_, i) => from + (to - from) * (i / (steps - 1)));
  return [...down, ...down.slice().reverse()];
}

test('angleAt calcule un angle droit et un angle plat', () => {
  assert.equal(Math.round(angleAt({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 180);
});

test('angleAt tient compte du rapport largeur/hauteur', () => {
  // En coordonnées normalisées sur une image 16:9, (0.1, 0) et (0, 0.1) ne sont pas à 45° de l'horizontale.
  const a = angleAt({ x: 0.1, y: 0 }, { x: 0, y: 0 }, { x: 0.1, y: 0.1 }, 16 / 9);
  assert.ok(Math.abs(a - Math.atan2(0.1, 0.1 * 16 / 9) * 180 / Math.PI) < 1e-9);
});

// Pompes : la référence « bras tendus » s'apprend sur une planche immobile (≥ 0,4 s).
const hold = (v, n = 10) => Array(n).fill(v);

for (const [exercise, top, bottom] of [['pushup', 100, 20], ['squat', 175, 80], ['pullup', 175, 60]]) {
  test(`${exercise} : 3 répétitions complètes sont comptées`, () => {
    const c = new RepCounter(exercise, { smoothing: 0 });
    const events = run(c, exercise, [...hold(top), ...rep(top, bottom), ...rep(top, bottom), ...rep(top, bottom), top]);
    assert.deepEqual(events, ['rep', 'rep', 'rep']);
    assert.equal(c.reps, 3);
  });

  test(`${exercise} : compte aussi avec le lissage par défaut`, () => {
    const c = new RepCounter(exercise);
    run(c, exercise, [...hold(top), ...rep(top, bottom, 10), top, top, ...rep(top, bottom, 10), top, top]);
    assert.equal(c.reps, 2);
  });
}

test('une demi-pompe est signalée comme incomplète, pas comptée', () => {
  const c = new RepCounter('pushup', { smoothing: 0 });
  const events = run(c, 'pushup', [...hold(100), ...rep(100, 65), 100]);
  assert.deepEqual(events, ['partial']);
  assert.equal(c.reps, 0);
});

test('les petites oscillations autour de la position haute ne comptent pas', () => {
  const c = new RepCounter('squat', { smoothing: 0 });
  const events = run(c, 'squat', [175, 165, 172, 158, 170, 162, 175]);
  assert.deepEqual(events, []);
});

test('rien ne compte tant que la position de départ (tendue) n\'est pas atteinte', () => {
  const c = new RepCounter('squat', { smoothing: 0 });
  // On commence accroupi : la première remontée ne doit pas compter comme une répétition.
  const events = run(c, 'squat', [80, 90, 120, 175, ...rep(175, 80), 175]);
  assert.deepEqual(events, ['rep']);
});

test('pompes : en s\'installant debout près du téléphone, la référence n\'est pas faussée', () => {
  const c = new RepCounter('pushup', { smoothing: 0 });
  // On s'approche en bougeant (mains très loin sous les épaules), puis planche, puis 2 pompes.
  const walking = Array.from({ length: 10 }, (_, i) => 200 - i * 8);
  run(c, 'pushup', walking, { torsoVertical: true });
  const t0 = walking.length * 50;
  const seq = [...hold(100), ...rep(100, 20), ...rep(100, 20), 100];
  seq.forEach((v, i) => c.update(pose('pushup', v), t0 + i * 50));
  assert.equal(c.reps, 2);
});

for (const [file, expected] of [['pushup-iphone-face.json', 2], ['pushup-iphone-face-2.json', 5]])
test(`pompes : séance réelle sur iPhone, vue de face (${file})`, () => {
  const d = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)));
  const c = new RepCounter('pushup');
  const aspect = d.video.width / d.video.height;
  for (const f of d.frames) {
    const lm = f.lm && Array.from({ length: 33 }, (_, i) => {
      const p = f.lm[i];
      return p ? { x: p[0], y: p[1], visibility: p[2] } : { x: 0, y: 0, visibility: 0 };
    });
    c.update(lm, f.t, aspect);
  }
  // L'ancienne version (angle du coude) n'en comptait aucune.
  assert.ok(c.reps >= expected, `reps = ${c.reps}`);
});

test('pompes : rien ne compte si le buste est vertical (debout)', () => {
  const c = new RepCounter('pushup', { smoothing: 0 });
  run(c, 'pushup', [...hold(100), ...rep(100, 20), ...hold(100)], { torsoVertical: true });
  assert.equal(c.reps, 0);
  const last = c.update(pose('pushup', 100, { torsoVertical: true }), 10_000);
  assert.equal(last.valid, false);
  assert.match(last.hint, /position de pompe/);
});

test('tractions : sans le menton au niveau de la barre, la répétition est incomplète', () => {
  const c = new RepCounter('pullup', { smoothing: 0 });
  const events = run(c, 'pullup', [175, ...rep(175, 60), 175], { noseY: 0.45 });
  assert.deepEqual(events, ['partial']);
  assert.equal(c.reps, 0);
});

test('un mouvement trop rapide (bruit) est ignoré', () => {
  const c = new RepCounter('squat', { smoothing: 0, minRepMs: 400 });
  // Descente + remontée en 3 images (150 ms) : trop rapide pour être réel.
  const events = run(c, 'squat', [175, 175, 90, 175, 175]);
  assert.deepEqual(events, []);
});

test('points peu visibles : image ignorée et consigne de placement', () => {
  const c = new RepCounter('squat', { smoothing: 0 });
  const r = c.update(pose('squat', 170, { visibility: 0.1 }), 0);
  assert.equal(r.valid, false);
  assert.ok(r.hint);
  assert.equal(c.update(null, 50).valid, false);
});
