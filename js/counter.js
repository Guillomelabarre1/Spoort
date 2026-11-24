// Logique de comptage des répétitions, indépendante du navigateur (testable sous Node).
//
// Chaque exercice (voir js/exercises.js) décrit un « détecteur » qui transforme les 33 points de
// pose MediaPipe en une valeur par image : angle d'articulation, hauteur relative, ou maintien.
// Pour les répétitions, une machine à états avec deux seuils (hystérésis) compte :
// position de départ (valeur ≥ extended) → descente (≤ flexed) → retour (≥ extended) = 1 répétition.

import { CATALOG } from './exercises.js';

export const EXERCISES = CATALOG;

// Indices des points MediaPipe Pose (33 points).
export const LM = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFoot: 31, rightFoot: 32,
};

const SIDES = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle },
};

/** Angle ABC en degrés (B au sommet). `aspect` = largeur/hauteur de l'image, car x et y sont normalisés séparément. */
export function angleAt(a, b, c, aspect = 1) {
  const abx = (a.x - b.x) * aspect, aby = a.y - b.y;
  const cbx = (c.x - b.x) * aspect, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const norm = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (norm === 0) return NaN;
  return Math.acos(Math.min(1, Math.max(-1, dot / norm))) * 180 / Math.PI;
}

const visibility = (p) => p?.visibility ?? 1;

/** Score de visibilité d'un côté pour une articulation (minimum des 3 points). */
function sideScore(lm, side, joint) {
  return Math.min(...joint.map((j) => visibility(lm[side[j]])));
}

/** Choisit le côté du corps le mieux vu pour l'articulation suivie. */
export function pickSide(lm, joint) {
  let best = null;
  for (const [name, side] of Object.entries(SIDES)) {
    const score = sideScore(lm, side, joint);
    if (!best || score > best.score) best = { name, side, score };
  }
  return best;
}

/** Inclinaison épaule → hanche par rapport à l'horizontale, en degrés. */
function torsoTilt(lm, side, aspect) {
  const s = lm[side.shoulder], h = lm[side.hip];
  return Math.atan2(Math.abs(h.y - s.y), Math.abs(h.x - s.x) * aspect) * 180 / Math.PI;
}

// Vérifications de posture (par nom, pour que les exercices restent de simples données).
const POSTURES = {
  none: () => true,
  torsoHorizontal: (lm, side, aspect) => torsoTilt(lm, side, aspect) < 45,
  lying: (lm, side, aspect) => torsoTilt(lm, side, aspect) < 50,
  wristsAboveShoulders: (lm, side) => lm[side.wrist].y < lm[side.shoulder].y,
};

const TOP_CHECKS = {
  // En haut de la traction, le nez doit passer au niveau des poignets.
  chinOverBar(lm) {
    const wristY = (lm[LM.leftWrist].y + lm[LM.rightWrist].y) / 2;
    return lm[LM.nose].y < wristY + 0.03;
  },
};

/** Fenêtre glissante pour savoir si des points sont immobiles. */
class Stillness {
  constructor(ms = 400, range = 0.02) { this.ms = ms; this.range = range; this.samples = []; }
  push(t, values) {
    this.samples.push({ t, values });
    while (this.samples.length && t - this.samples[0].t > this.ms) this.samples.shift();
    if (t - this.samples[0].t < this.ms * 0.75) return false;
    return values.every((_, i) => {
      const col = this.samples.map((s) => s.values[i]);
      return Math.max(...col) - Math.min(...col) < this.range;
    });
  }
  reset() { this.samples = []; }
}

/** Machine à états d'une répétition (une par côté pour les exercices alternés). */
class RepMachine {
  constructor({ extended, flexed, partial, minRepMs, smoothing }) {
    Object.assign(this, { extended, flexed, partial, minRepMs, smoothing });
    this.reset();
  }

  reset() {
    this.phase = 'waiting'; // waiting → up → down → up …
    this.value = null;
    this.minValue = Infinity;
    this.repStartedAt = null;
    this.reachedTop = false;
  }

  /** Renvoie 'rep', 'partial' ou null. `topCheck()` : condition supplémentaire en bas du mouvement. */
  feed(raw, t, topCheck = null) {
    this.value = this.value === null ? raw : this.smoothing * this.value + (1 - this.smoothing) * raw;
    const v = this.value;
    const { extended, flexed, partial } = this;
    switch (this.phase) {
      case 'waiting':
        if (v >= extended) this.phase = 'up';
        return null;
      case 'up':
        if (v < extended) this.minValue = Math.min(this.minValue, v);
        if (v <= flexed) {
          this.phase = 'down';
          this.repStartedAt ??= t;
          this.reachedTop = topCheck ? topCheck() : true;
        } else if (v >= extended && this.minValue <= partial) {
          this.minValue = Infinity;
          this.repStartedAt = null;
          return 'partial'; // redescendu sans atteindre le seuil
        } else if (v >= extended) {
          this.minValue = Infinity;
          this.repStartedAt = null;
        } else if (this.repStartedAt === null) {
          this.repStartedAt = t;
        }
        return null;
      case 'down': {
        if (topCheck && !this.reachedTop) this.reachedTop = topCheck();
        if (v < extended) return null;
        const tooFast = this.repStartedAt !== null && t - this.repStartedAt < this.minRepMs;
        const event = !this.reachedTop ? 'partial' : tooFast ? null : 'rep';
        this.phase = 'up';
        this.minValue = Infinity;
        this.repStartedAt = null;
        this.reachedTop = false;
        return event;
      }
    }
    return null;
  }

  /** Hors position : on n'arme pas de répétition. */
  disarm() { if (this.phase === 'down') this.phase = 'up'; }
}

export class RepCounter {
  /** `exercise` : identifiant du catalogue ou définition complète (exercice personnalisé). */
  constructor(exercise, opts = {}) {
    const ex = typeof exercise === 'string' ? CATALOG[exercise] : exercise;
    if (!ex) throw new Error(`Exercice inconnu : ${exercise}`);
    this.ex = ex;
    this.det = ex.detector;
    this.kind = ex.kind ?? 'reps';
    this.minVisibility = opts.minVisibility ?? 0.5;
    this.lostAfterMs = opts.lostAfterMs ?? 1000;
    this.machineOpts = {
      extended: this.det.extended, flexed: this.det.flexed, partial: this.det.partial,
      minRepMs: opts.minRepMs ?? this.det.minRepMs ?? 400,
      smoothing: opts.smoothing ?? 0.5,
    };
    this.reset();
  }

  reset() {
    this.reps = 0;
    this.partials = 0;
    this.machines = {}; // une machine par flux de valeurs ('main', ou 'left'/'right')
    this.lastValidAt = null;
    this.ref = null;    // hauteur de référence (détecteurs height / stature)
    this.tops = [];
    // Maintien : tolérance plus large (on respire, on tremble un peu), seuls les vrais mouvements comptent.
    this.still = this.kind === 'hold' ? new Stillness(500, 0.04) : new Stillness();
    this.heldMs = 0;    // maintien
    this.lastHoldT = null;
  }

  get phase() {
    if (this.kind === 'hold') return this.holdPhase ?? 'waiting';
    const ms = Object.values(this.machines);
    if (!ms.length) return 'waiting';
    if (ms.some((m) => m.phase === 'down')) return 'down';
    return ms.some((m) => m.phase === 'up') ? 'up' : 'waiting';
  }

  get angle() {
    const ms = Object.values(this.machines).filter((m) => m.value !== null);
    return ms.length ? Math.min(...ms.map((m) => m.value)) : null;
  }

  machine(key) {
    return (this.machines[key] ??= new RepMachine(this.machineOpts));
  }

  /**
   * Traite une image. `lm` = tableau des 33 points {x, y, visibility} (ou null si personne).
   * Retourne { reps, phase, angle, valid, event: 'rep' | 'partial' | 'tick' | null, hint, side, raw, posture, score }.
   */
  update(lm, t, aspect = 1) {
    this.diag = { side: null, raw: null, posture: null, score: null };
    const out = (valid, event = null, hint = null) => ({
      reps: this.reps, phase: this.phase, angle: this.angle, valid, event, hint, ...this.diag,
    });
    const lostHint = () =>
      this.lastValidAt === null || t - this.lastValidAt > this.lostAfterMs ? this.ex.setupHint : null;

    if (!lm) { this.lastHoldT = null; return out(false, null, lostHint()); }

    // Après une longue perte de suivi (téléphone déplacé…), on réapprend les références.
    if (this.lastValidAt !== null && t - this.lastValidAt > 3000) {
      this.ref = null; this.tops = []; this.still.reset();
    }

    if (this.kind === 'hold') return this.updateHold(lm, t, aspect, out, lostHint);

    const m = this.measure(lm, t, aspect);
    if (!m) return out(false, null, lostHint());
    if (m.values === null) return out(false, null, this.ex.setupHint);
    this.diag.raw = Math.min(...Object.values(m.values));
    this.diag.posture = m.posture;

    if (!m.posture) {
      for (const key of Object.keys(m.values)) this.machine(key).disarm();
      return out(false, null, this.ex.setupHint);
    }
    this.lastValidAt = t;

    let event = null;
    const topCheck = this.det.topCheck ? () => TOP_CHECKS[this.det.topCheck](lm) : null;
    for (const [key, value] of Object.entries(m.values)) {
      const e = this.machine(key).feed(value, t, topCheck);
      if (e === 'rep') { this.reps += 1; event = 'rep'; }
      else if (e === 'partial') { this.partials += 1; event ??= 'partial'; }
    }
    const hint = event === 'partial' ? this.ex.partialHint
      : this.phase === 'waiting' ? this.ex.setupHint : null;
    return out(true, event, hint);
  }

  /** Calcule la ou les valeurs de l'image. null = personne de visible ; values null = référence pas encore apprise. */
  measure(lm, t, aspect) {
    const d = this.det;
    if (d.type === 'angle') return this.measureAngle(lm, aspect);
    if (d.type === 'height') return this.measureHeight(lm, t);
    if (d.type === 'stature') return this.measureStature(lm, t);
    throw new Error(`Détecteur inconnu : ${d.type}`);
  }

  measureAngle(lm, aspect) {
    const d = this.det;
    const sides = Object.entries(SIDES)
      .map(([name, side]) => ({ name, side, score: sideScore(lm, side, d.joint) }))
      .sort((a, b) => b.score - a.score);
    const visible = sides.filter((s) => s.score >= this.minVisibility);
    this.diag.side = sides[0].name;
    this.diag.score = sides[0].score;
    if (!visible.length) return null;

    const value = (s) => {
      const [a, b, c] = d.joint.map((j) => lm[s.side[j]]);
      const angle = angleAt(a, b, c, aspect);
      return d.invert ? 180 - angle : angle;
    };
    let values;
    if (d.sides === 'each') {
      values = Object.fromEntries(visible.map((s) => [s.name, value(s)]));
      this.diag.side = visible.map((s) => s.name).join('+');
    } else if (d.sides === 'min') {
      values = { main: Math.min(...visible.map(value)) };
    } else {
      values = { main: value(visible[0]) };
    }
    if (Object.values(values).some(Number.isNaN)) return null;
    const posture = (POSTURES[d.posture ?? 'none'])(lm, visible[0].side, aspect);
    return { values, posture };
  }

  /**
   * Pompes, dips : hauteur verticale des épaules au-dessus des poignets, en % de la hauteur bras
   * tendus. Moyenne des côtés visibles (de face : les deux ; de profil : le côté proche).
   * La référence n'est apprise que sur une position de départ immobile (~0,4 s) : en s'installant,
   * les mains pendent loin sous les épaules et fausseraient la mesure. On garde le maximum des
   * 10 dernières secondes (sans nouvelle position immobile, la référence précédente reste).
   */
  measureHeight(lm, t) {
    const sides = Object.values(SIDES)
      .map((s) => ({ s, score: Math.min(visibility(lm[s.shoulder]), visibility(lm[s.wrist])) }))
      .filter((x) => x.score >= this.minVisibility);
    if (!sides.length) return null;
    const avg = (key) => sides.reduce((sum, x) => sum + lm[x.s[key]].y, 0) / sides.length;
    const shoulderY = avg('shoulder'), wristY = avg('wrist'), hipY = avg('hip');
    const height = wristY - shoulderY; // > 0 : épaules au-dessus des mains
    this.diag.side = sides.length === 2 ? 'deux' : (sides[0].s === SIDES.left ? 'left' : 'right');
    this.diag.score = Math.min(...sides.map((x) => x.score));

    // Position de départ bras tendus.
    //  - plank : hanches pas beaucoup plus bas que les épaules (debout, elles sont presque au niveau des mains) ;
    //  - upright (dips) : buste droit, hanches nettement sous les épaules.
    // Le seuil strict sert à apprendre la référence ; pendant la série on tolère plus de marge
    // (pompes sur poignées : hanches un peu plus basses vues du sol), sinon la remontée n'est
    // jamais validée et chaque pompe passe pour incomplète.
    const ratio = (hipY - shoulderY) / height;
    const upright = this.det.posture === 'upright';
    const inPosition = (margin) => height > 0.05 && (upright ? ratio > 0.4 / margin : ratio < 0.6 * margin);
    const start = inPosition(1);
    const stable = this.still.push(t, [shoulderY, wristY]);
    this.learnRef(start && stable, height, t);
    if (!this.ref) return { values: null, posture: false };
    const value = (100 * Math.max(0, height)) / this.ref;
    // En bas du mouvement la silhouette change : on n'exige la position de départ que près du haut.
    return { values: { main: value }, posture: height > -0.05 && (inPosition(1.5) || value < this.det.extended) };
  }

  /** Burpees : hauteur du corps (nez → point visible le plus bas), en % de la hauteur debout. */
  measureStature(lm, t) {
    const nose = lm[LM.nose];
    const lows = [LM.leftAnkle, LM.rightAnkle, LM.leftHeel, LM.rightHeel, LM.leftFoot, LM.rightFoot, LM.leftKnee, LM.rightKnee]
      .map((i) => lm[i]).filter((p) => p && visibility(p) >= this.minVisibility);
    this.diag.score = visibility(nose);
    if (visibility(nose) < this.minVisibility || !lows.length) return null;
    const height = Math.max(...lows.map((p) => p.y)) - nose.y;
    const shoulderY = (lm[LM.leftShoulder].y + lm[LM.rightShoulder].y) / 2;
    const hipY = (lm[LM.leftHip].y + lm[LM.rightHip].y) / 2;
    const upright = hipY - shoulderY > 0.15 && nose.y < shoulderY;
    const stable = this.still.push(t, [nose.y, shoulderY]);
    this.learnRef(upright && stable, height, t);
    if (!this.ref) return { values: null, posture: false };
    return { values: { main: (100 * Math.max(0, height)) / this.ref }, posture: true };
  }

  learnRef(ok, height, t) {
    if (ok) this.tops.push({ t, height });
    this.tops = this.tops.filter((x) => t - x.t <= 10000);
    if (this.tops.length) this.ref = Math.max(...this.tops.map((x) => x.height));
  }

  /** Maintien (gainage, chaise) : on compte les secondes passées dans la bonne position. */
  updateHold(lm, t, aspect, out, lostHint) {
    const ok = this.holdCheck(lm, t, aspect);
    this.diag.posture = ok;
    if (ok === null) { this.lastHoldT = null; return out(false, null, lostHint()); }
    let event = null;
    if (ok) {
      this.lastValidAt = t;
      if (this.lastHoldT !== null) {
        const before = Math.floor(this.heldMs / 1000);
        this.heldMs += Math.min(250, t - this.lastHoldT); // une image perdue ne fait pas sauter le chrono
        this.reps = Math.floor(this.heldMs / 1000);
        if (this.reps > before) event = 'tick';
      }
      this.lastHoldT = t;
      this.holdPhase = 'holding';
    } else {
      this.lastHoldT = null;
      if (this.holdPhase === 'holding') this.holdPhase = 'paused';
    }
    this.diag.raw = this.heldMs / 1000;
    return out(ok, event, ok ? null : this.ex.setupHint);
  }

  /** true / false = position tenue ou non ; null = personne de visible. */
  holdCheck(lm, t, aspect) {
    const pick = pickSide(lm, ['shoulder', 'hip']);
    this.diag.side = pick.name;
    this.diag.score = pick.score;
    if (pick.score < this.minVisibility) return null;
    const s = lm[pick.side.shoulder], h = lm[pick.side.hip];
    const stable = this.still.push(t, [s.y, h.y]);
    const check = this.det.check;
    if (check === 'still') return stable;
    if (check === 'wallSit') {
      const knee = pickSide(lm, ['hip', 'knee', 'ankle']);
      if (knee.score < this.minVisibility) return null;
      const angle = angleAt(lm[knee.side.hip], lm[knee.side.knee], lm[knee.side.ankle], aspect);
      return stable && angle >= 65 && angle <= 120 && h.y > s.y + 0.05;
    }
    // plank : de profil, buste proche de l'horizontale ; de face, la planche bras tendus des pompes.
    const side = torsoTilt(lm, pick.side, aspect) < 35;
    const sh = (lm[LM.leftShoulder].y + lm[LM.rightShoulder].y) / 2;
    const wr = (lm[LM.leftWrist].y + lm[LM.rightWrist].y) / 2;
    const hp = (lm[LM.leftHip].y + lm[LM.rightHip].y) / 2;
    const front = wr - sh > 0.05 && hp - sh < 0.6 * (wr - sh);
    return stable && (side || front);
  }
}
