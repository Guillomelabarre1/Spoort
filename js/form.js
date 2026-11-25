// Bilan de posture écrit, en fin d'exercice : les répétitions étaient-elles bonnes, et quoi ajuster
// pour mieux travailler le muscle. Pur (sans DOM), testé sous Node.
//
// Le compteur fournit pour chaque répétition (ou incomplète) l'amplitude atteinte (`low`), le haut
// de départ (`high`) et le rythme (`ms`, `downMs`), dans l'unité de son détecteur. On ajoute ici des
// mesures prises sur les points du corps : alignement épaules-hanches-chevilles (pompes, gainage,
// vu de profil), buste penché et genoux qui rentrent (squats), angle des genoux (chaise).

import { LM, angleAt } from './counter.js';

const SIDES = [
  { shoulder: LM.leftShoulder, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle },
  { shoulder: LM.rightShoulder, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle },
];
const vis = (p) => p?.visibility ?? 1;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const bestSide = (lm, keys, min = 0.5) => {
  const scored = SIDES.map((s) => ({ s, score: Math.min(...keys.map((k) => vis(lm[s[k]]))) })).sort((a, b) => b.score - a.score);
  return scored[0].score >= min ? scored[0].s : null;
};

/** Alignement du corps vu de profil : angle épaule-hanche-cheville, et sens (hanches basses ou hautes). */
export function bodyLine(lm, aspect = 1) {
  const s = bestSide(lm, ['shoulder', 'hip', 'ankle']);
  if (!s) return null;
  const sh = lm[s.shoulder], hp = lm[s.hip], an = lm[s.ankle];
  const dx = (an.x - sh.x) * aspect, dy = an.y - sh.y;
  // De profil et allongé : corps étalé à l'horizontale, hanches entre épaules et chevilles.
  if (Math.abs(dx) < 0.25 || Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  const t = (hp.x - sh.x) / (an.x - sh.x);
  if (t < 0.25 || t > 0.8) return null;
  const angle = angleAt(sh, hp, an, aspect);
  if (!(angle > 130)) return null; // silhouette mal détectée : on ne juge pas
  const lineY = sh.y + (an.y - sh.y) * t;
  return { angle, sag: hp.y > lineY };
}

/** Inclinaison du buste par rapport à la verticale (0 = droit). Vu de face, reste proche de 0. */
export function torsoLean(lm, aspect = 1) {
  const s = bestSide(lm, ['shoulder', 'hip']);
  if (!s) return null;
  const sh = lm[s.shoulder], hp = lm[s.hip];
  return Math.atan2(Math.abs(sh.x - hp.x) * aspect, Math.abs(hp.y - sh.y)) * 180 / Math.PI;
}

/** Écart des genoux / écart des chevilles, vu de face (< 0,75 : les genoux rentrent). */
export function kneeRatio(lm, aspect = 1) {
  const pts = [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];
  if (pts.some((i) => vis(lm[i]) < 0.5)) return null;
  const w = (a, b) => Math.abs(lm[a].x - lm[b].x) * aspect;
  if (w(LM.leftHip, LM.rightHip) < 0.06) return null; // de profil : rien à mesurer
  const ankles = w(LM.leftAnkle, LM.rightAnkle);
  return ankles > 0.04 ? w(LM.leftKnee, LM.rightKnee) / ankles : null;
}

export function kneeAngle(lm, aspect = 1) {
  const s = bestSide(lm, ['hip', 'knee', 'ankle']);
  return s ? angleAt(lm[s.hip], lm[s.knee], lm[s.ankle], aspect) : null;
}

// ---------- Messages par exercice ----------
const PUSH = ['pushup', 'pushup_wide', 'pushup_diamond'];
const DEPTH = {
  pushup: 'Descends la poitrine plus près du sol (à un poing) : les pectoraux travaillent alors sur toute leur longueur.',
  pike_pushup: 'Descends la tête plus près du sol, entre les mains : les épaules travaillent sur toute l\'amplitude.',
  dips: 'Descends jusqu\'à avoir les coudes à 90° : triceps et pectoraux travaillent davantage.',
  pullup: 'Monte jusqu\'à passer le menton au-dessus de la barre pour finir le travail du dos et des biceps.',
  squat: 'Descends jusqu\'aux cuisses parallèles au sol : fessiers et quadriceps travaillent beaucoup plus.',
  lunge: 'Descends jusqu\'à frôler le sol avec le genou arrière, genou avant à 90°.',
  glute_bridge: 'Monte les hanches jusqu\'à aligner épaules, hanches et genoux, et serre les fessiers 1 s en haut.',
  situp: 'Remonte le buste jusqu\'aux genoux pour engager tous les abdominaux.',
  leg_raise: 'Monte les jambes jusqu\'à la verticale pour bien engager le bas des abdos.',
  mountain_climber: 'Ramène le genou jusque sous la poitrine à chaque fois.',
  jumping_jack: 'Monte les bras jusqu\'au-dessus de la tête.',
  high_knees: 'Monte les genoux jusqu\'à hauteur de hanche.',
  burpee: 'Descends jusqu\'au sol, poitrine posée, à chaque burpee.',
};
DEPTH.pushup_wide = DEPTH.pushup_diamond = DEPTH.pushup;
DEPTH.chinup = DEPTH.pullup;
DEPTH.jump_squat = DEPTH.squat;

const LOCKOUT = {
  pushup: 'Tends complètement les bras en haut de chaque pompe.',
  dips: 'Tends complètement les bras en haut de chaque dip.',
  pullup: 'Redescends bras tendus entre chaque traction : les demi-répétitions travaillent moins le dos.',
  squat: 'Redresse-toi complètement en haut, hanches et genoux tendus.',
  lunge: 'Redresse-toi complètement entre chaque fente.',
  situp: 'Redescends le dos jusqu\'au sol entre chaque répétition.',
  leg_raise: 'Redescends les jambes près du sol (sans les poser) pour garder la tension.',
  glute_bridge: 'Redescends les fesses jusqu\'au sol entre chaque répétition.',
  burpee: 'Redresse-toi complètement (ou saute) en haut de chaque burpee.',
};
for (const id of [...PUSH, 'pike_pushup']) LOCKOUT[id] = LOCKOUT.pushup;
LOCKOUT.chinup = LOCKOUT.pullup;
LOCKOUT.jump_squat = LOCKOUT.squat;

// Exercices où « descendre » est la phase excentrique (celle qu'on contrôle en ralentissant).
const ECCENTRIC_DOWN = new Set([...PUSH, 'pike_pushup', 'dips', 'squat', 'lunge']);

/** Accumule les répétitions d'un exercice (sur une ou plusieurs séries) et rédige le bilan. */
export class FormCoach {
  constructor(ex) {
    this.ex = ex;
    this.det = ex.detector;
    this.hold = ex.kind === 'hold';
    this.reps = [];    // { low, high, ms, downMs, partial, line, lean, knees }
    this.buffer = [];  // images de la répétition en cours
    this.holdFrames = []; // { line, knee }
    this.pauses = 0;
    this.wasHolding = false;
  }

  /** Une image analysée : `r` = sortie de RepCounter.update. */
  frame(lm, aspect, r) {
    if (!lm) return;
    if (this.hold) return this.holdFrame(lm, aspect, r);
    if (r.valid && r.angle !== null) {
      const f = { v: r.angle };
      if (PUSH.includes(this.ex.id) || this.ex.id === 'dips') f.line = PUSH.includes(this.ex.id) ? bodyLine(lm, aspect) : null;
      if (this.ex.id === 'squat' || this.ex.id === 'jump_squat') { f.lean = torsoLean(lm, aspect); f.knees = kneeRatio(lm, aspect); }
      this.buffer.push(f);
    }
    if (r.rep) {
      const frames = this.buffer;
      this.buffer = [];
      const bottom = frames.reduce((a, b) => (b.v < (a?.v ?? Infinity) ? b : a), null);
      const lines = frames.map((f) => f.line).filter(Boolean);
      const worst = lines.reduce((a, b) => (b.angle < (a?.angle ?? Infinity) ? b : a), null);
      this.reps.push({ ...r.rep, line: worst, lean: bottom?.lean ?? null, knees: bottom?.knees ?? null });
    }
  }

  holdFrame(lm, aspect, r) {
    if (r.posture === true) {
      this.wasHolding = true;
      this.holdFrames.push({ line: this.det.check === 'plank' ? bodyLine(lm, aspect) : null, knee: this.det.check === 'wallSit' ? kneeAngle(lm, aspect) : null });
    } else if (r.posture === false && this.wasHolding) {
      this.wasHolding = false;
      this.pauses += 1;
    }
  }

  /** Bilan : { verdict: 'good' | 'ok' | 'work' | 'none', title, items: [{ kind: 'tip' | 'good' | 'info', text }] }. */
  report() {
    return this.hold ? this.holdReport() : this.repReport();
  }

  repReport() {
    const all = this.reps;
    const full = all.filter((r) => !r.partial);
    if (all.length < 3) return { verdict: 'none', title: 'Pas assez de répétitions pour juger la posture.', items: [] };
    const { extended, flexed } = this.det;
    const range = Math.max(1, extended - flexed);
    const id = this.ex.id;
    const tips = [], goods = [], infos = [];

    // Amplitude : répétitions incomplètes, ou validées de justesse.
    const partialRate = (all.length - full.length) / all.length;
    const lows = full.map((r) => r.low).filter(Number.isFinite);
    const avgLow = avg(lows);
    const depthText = DEPTH[id] ?? `${this.ex.partialHint ?? 'Fais le mouvement en entier'} : sur toute l'amplitude, le muscle travaille davantage.`;
    if (partialRate >= 0.2) {
      tips.push({ w: 3, text: `${all.length - full.length} répétition${all.length - full.length > 1 ? 's' : ''} sur ${all.length} incomplète${all.length - full.length > 1 ? 's' : ''}. ${depthText}` });
    } else if (avgLow !== null && avgLow > flexed - 0.1 * range) {
      tips.push({ w: 2, text: `Tes répétitions passent de justesse. ${depthText}` });
    } else if (avgLow !== null) {
      goods.push('Amplitude complète sur tes répétitions.');
    }

    // Retour complet en position de départ.
    const highs = full.map((r) => r.high).filter(Number.isFinite);
    const avgHigh = avg(highs);
    if (avgHigh !== null && avgHigh < extended + 0.1 * range) {
      tips.push({ w: 2, text: LOCKOUT[id] ?? 'Reviens complètement en position de départ entre chaque répétition.' });
    }

    // Fin de série : amplitude qui se dégrade.
    if (lows.length >= 8) {
      const third = Math.floor(lows.length / 3);
      const first = avg(lows.slice(0, third)), last = avg(lows.slice(-third));
      if (last - first > 0.15 * range) tips.push({ w: 2, text: 'Ton amplitude baisse en fin de série (fatigue) : mieux vaut quelques répétitions de moins, mais complètes.' });
    }

    // Rythme : pas pour le cardio ni les mouvements explosifs ou alternés.
    const tempoMatters = this.ex.category !== 'cardio' && !this.det.minRepMs && this.det.sides !== 'each' && id !== 'mountain_climber';
    const durations = full.map((r) => r.ms).filter((x) => x > 0);
    const avgMs = avg(durations);
    if (tempoMatters && avgMs !== null && durations.length >= 3) {
      const downs = full.filter((r) => r.ms > 0 && r.downMs !== null).map((r) => r.downMs / r.ms);
      if (avgMs < 1300) {
        tips.push({ w: 1, text: `Rythme rapide (${(avgMs / 1000).toFixed(1).replace('.', ',')} s par répétition). Ralentis : ~2 s pour descendre, 1 s pour remonter. Plus de temps sous tension, plus de travail musculaire.` });
      } else if (ECCENTRIC_DOWN.has(id) && downs.length >= 3 && avg(downs) < 0.3) {
        tips.push({ w: 1, text: 'Tu te laisses tomber : contrôle la descente, elle construit autant le muscle que la montée.' });
      } else {
        goods.push(`Rythme contrôlé (${(avgMs / 1000).toFixed(1).replace('.', ',')} s par répétition).`);
      }
    }

    // Alignement du corps (pompes, vues de profil).
    if (PUSH.includes(id)) {
      const lines = full.map((r) => r.line).filter(Boolean);
      if (lines.length >= Math.max(3, full.length / 2)) {
        const bad = lines.filter((l) => l.angle < 160);
        if (bad.length >= lines.length / 2) {
          const sag = bad.filter((l) => l.sag).length >= bad.length / 2;
          tips.push({ w: 3, text: sag
            ? 'Tes hanches s\'affaissent : serre les abdos et les fessiers pour garder le corps droit des épaules aux chevilles (ça protège le bas du dos).'
            : 'Hanches trop hautes : aligne épaules, hanches et chevilles pour que les pectoraux fassent le travail.' });
        } else goods.push('Corps bien gainé, droit des épaules aux chevilles.');
      } else {
        infos.push('Pour juger l\'alignement de ton corps, filme-toi de profil la prochaine fois.');
      }
    }

    // Squats : buste et genoux, mesurés en bas du mouvement.
    if (id === 'squat' || id === 'jump_squat') {
      const leans = full.map((r) => r.lean).filter((x) => x !== null);
      if (leans.length >= 3 && avg(leans) > 50) tips.push({ w: 2, text: 'Ton buste penche beaucoup vers l\'avant : garde la poitrine haute et pousse les fesses en arrière, le poids sur les talons.' });
      const knees = full.map((r) => r.knees).filter((x) => x !== null);
      if (knees.length >= 3) {
        if (knees.filter((k) => k < 0.75).length >= knees.length * 0.4) tips.push({ w: 3, text: 'Tes genoux rentrent vers l\'intérieur en bas : pousse-les vers l\'extérieur, dans l\'axe des pieds. Les fessiers travaillent mieux et les genoux sont protégés.' });
        else goods.push('Genoux bien dans l\'axe des pieds.');
      }
    }

    return this.compose(tips, goods, infos, `${full.length} bonne${full.length > 1 ? 's' : ''} répétition${full.length > 1 ? 's' : ''} sur ${all.length}`);
  }

  holdReport() {
    const frames = this.holdFrames;
    if (frames.length < 30) return { verdict: 'none', title: 'Pas assez de temps tenu pour juger la posture.', items: [] };
    const tips = [], goods = [], infos = [];
    if (this.det.check === 'plank') {
      const lines = frames.map((f) => f.line).filter(Boolean);
      if (lines.length >= frames.length / 3) {
        const bad = lines.filter((l) => l.angle < 165);
        if (bad.length >= lines.length / 2) {
          const sag = bad.filter((l) => l.sag).length >= bad.length / 2;
          tips.push({ w: 3, text: sag
            ? 'Tes hanches descendent : rentre le nombril et serre les fessiers pour garder le corps droit, sans creuser le dos.'
            : 'Hanches trop hautes : redescends-les dans l\'alignement épaules-chevilles, les abdos travaillent beaucoup plus.' });
        } else goods.push('Corps bien aligné des épaules aux chevilles.');
      } else infos.push('Pour juger l\'alignement de ton corps, filme-toi de profil la prochaine fois.');
    }
    if (this.det.check === 'wallSit') {
      const knees = frames.map((f) => f.knee).filter((x) => x !== null);
      const a = avg(knees);
      if (a !== null && a > 105) tips.push({ w: 2, text: 'Descends un peu plus : cuisses parallèles au sol, genoux à 90°.' });
      else if (a !== null && a < 75) tips.push({ w: 1, text: 'Tu es un peu trop bas : remonte jusqu\'aux genoux à 90°, au-dessus des chevilles.' });
      else if (a !== null) goods.push('Genoux bien à 90°.');
    }
    if (this.pauses >= 2) tips.push({ w: 2, text: `Tu as perdu la position ${this.pauses} fois : mieux vaut un temps plus court mais tenu d'une traite.` });
    else goods.push('Position tenue sans interruption.');
    return this.compose(tips, goods, infos, null);
  }

  compose(tips, goods, infos, detail) {
    const weight = tips.reduce((s, t) => s + t.w, 0);
    const verdict = weight === 0 ? 'good' : weight <= 2 ? 'ok' : 'work';
    const title = { good: 'Bonnes répétitions, rien à corriger 👍', ok: 'Bien, un point à ajuster', work: 'À améliorer' }[verdict];
    tips.sort((a, b) => b.w - a.w);
    const items = [
      ...tips.slice(0, 3).map((t) => ({ kind: 'tip', text: t.text })),
      ...goods.slice(0, tips.length ? 1 : 3).map((text) => ({ kind: 'good', text })),
      ...infos.slice(0, 1).map((text) => ({ kind: 'info', text })),
    ];
    return { verdict, title: this.hold && verdict === 'good' ? 'Belle position, rien à corriger 👍' : title, detail, items };
  }
}
