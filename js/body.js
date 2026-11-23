// Mensurations : liste des mesures, calculs (IMC, masse grasse) et dimensions du mannequin 3D.
// Pur (sans dépendance), testé sous Node.

/** Mesures proposées, en cm sauf le poids (kg). `def` : valeurs par défaut du mannequin selon le sexe. */
export const MEASURES = [
  { id: 'weight', label: 'Poids', unit: 'kg', step: 0.1, def: { m: 75, f: 60 } },
  { id: 'neck', label: 'Cou', unit: 'cm', step: 0.5, def: { m: 38, f: 32 } },
  { id: 'shoulders', label: 'Épaules', unit: 'cm', step: 0.5, def: { m: 115, f: 100 } },
  { id: 'chest', label: 'Poitrine', unit: 'cm', step: 0.5, def: { m: 98, f: 88 } },
  { id: 'waist', label: 'Taille', unit: 'cm', step: 0.5, def: { m: 84, f: 70 } },
  { id: 'hips', label: 'Hanches', unit: 'cm', step: 0.5, def: { m: 97, f: 97 } },
  { id: 'arm', label: 'Bras', unit: 'cm', step: 0.5, def: { m: 32, f: 27 } },
  { id: 'thigh', label: 'Cuisse', unit: 'cm', step: 0.5, def: { m: 55, f: 56 } },
  { id: 'calf', label: 'Mollet', unit: 'cm', step: 0.5, def: { m: 37, f: 35 } },
];
export const MEASURE = Object.fromEntries(MEASURES.map((m) => [m.id, m]));
export const DEFAULT_HEIGHT = { m: 176, f: 164 };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Valeurs connues à une date : pour chaque mesure, la dernière saisie jusqu'à `until` inclus. */
export function valuesAt(measurements, until = Infinity) {
  const out = {};
  const sorted = [...measurements].filter((m) => !m.deleted).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const entry of sorted) {
    if (Date.parse(entry.date) > until) break;
    for (const { id } of MEASURES) if (num(entry[id])) out[id] = entry[id];
  }
  return out;
}

/** Série d'une mesure dans le temps : [{ date, value }]. */
export function series(measurements, id) {
  return measurements
    .filter((m) => !m.deleted && num(m[id]))
    .map((m) => ({ date: new Date(m.date), value: m[id] }))
    .sort((a, b) => a.date - b.date);
}

export function bmi(weightKg, heightCm) {
  if (!num(weightKg) || !num(heightCm)) return null;
  return weightKg / (heightCm / 100) ** 2;
}

/**
 * Masse grasse estimée, méthode de la marine américaine (U.S. Navy), mesures en cm.
 * Homme : cou, taille, taille du corps. Femme : cou, taille, hanches, taille du corps.
 * Estimation (± 3-4 points), utile surtout pour suivre une tendance.
 */
export function bodyFatNavy(sex, heightCm, { neck, waist, hips } = {}) {
  if (!num(heightCm) || !num(neck) || !num(waist)) return null;
  let bf;
  if (sex === 'f') {
    if (!num(hips) || waist + hips - neck <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.221 * Math.log10(heightCm)) - 450;
  } else {
    if (waist - neck <= 0) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(heightCm)) - 450;
  }
  return Number.isFinite(bf) && bf > 2 && bf < 70 ? bf : null;
}

/** Demi-grand axe a d'une ellipse de périmètre C dont le petit axe vaut k·a (formule de Ramanujan). */
export function semiAxis(circumference, k) {
  const factor = Math.PI * (3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k)));
  return circumference / factor;
}

/**
 * Dimensions du mannequin (en mètres) à partir des mesures connues (complétées par des valeurs
 * par défaut selon le sexe). Le tronc est une ellipse (profondeur = 72 % de la largeur), les
 * membres des cercles. Les hauteurs suivent des proportions moyennes du corps humain.
 */
export function bodyDims(values = {}, profile = {}) {
  const sex = profile.sex === 'f' ? 'f' : 'm';
  const H = (num(profile.heightCm) ?? DEFAULT_HEIGHT[sex]) / 100;
  const v = (id) => (num(values[id]) ?? MEASURE[id].def[sex]) / 100;
  const k = 0.72;
  const r = (c) => c / (2 * Math.PI);
  return {
    sex, height: H, depth: k,
    y: {
      ankle: 0.04 * H, calf: 0.2 * H, knee: 0.285 * H, thigh: 0.44 * H, crotch: 0.47 * H,
      hips: 0.51 * H, waist: 0.6 * H, chest: 0.71 * H, shoulders: 0.805 * H, neck: 0.84 * H,
      head: 0.925 * H, elbow: 0.62 * H, wrist: 0.47 * H,
    },
    torso: {
      hips: semiAxis(v('hips'), k), waist: semiAxis(v('waist'), k), chest: semiAxis(v('chest'), k),
      // Le tour d'épaules passe par les deltoïdes : ellipse plus plate.
      shoulders: semiAxis(v('shoulders'), 0.5),
    },
    neck: r(v('neck')),
    head: 0.062 * H,
    arm: { upper: r(v('arm')), fore: r(v('arm')) * 0.82, wrist: r(v('arm')) * 0.55 },
    leg: { thigh: r(v('thigh')), knee: r(v('thigh')) * 0.62, calf: r(v('calf')), ankle: r(v('calf')) * 0.55 },
  };
}
