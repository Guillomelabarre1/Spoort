// Catalogue des exercices au poids du corps, muscles travaillés et réglages de détection.
// Données pures (aucune dépendance) : utilisées par le compteur, l'interface et les stats.
//
// Détecteurs (champ `detector`) :
//   angle   : angle d'une articulation (3 points). `sides` : 'best' (côté le mieux vu),
//             'min' (le plus fléchi des deux, ex. fentes alternées), 'each' (chaque côté compte
//             séparément, ex. montées de genoux). `invert` : valeur = 180 − angle (mouvement
//             qui part bras/jambes fléchis, ex. jumping jacks). Seuils dans l'espace de la valeur :
//             départ ≥ extended, descente ≤ flexed, amplitude incomplète si le minimum reste > partial.
//   height  : hauteur des épaules au-dessus des mains, en % de la hauteur bras tendus (pompes, dips).
//             Fonctionne de face comme de profil. `posture` : 'plank' (planche) ou 'upright' (buste droit).
//   stature : hauteur du corps (nez → point le plus bas), en % de la hauteur debout (burpees).
//   hold    : exercice de maintien, compte les secondes tenues. `check` : 'plank', 'wallSit', 'still'.

export const MUSCLES = {
  pecs: 'Pectoraux',
  shoulders: 'Épaules',
  triceps: 'Triceps',
  biceps: 'Biceps',
  forearms: 'Avant-bras',
  back: 'Dos',
  traps: 'Trapèzes',
  lowerback: 'Lombaires',
  abs: 'Abdominaux',
  obliques: 'Obliques',
  glutes: 'Fessiers',
  quads: 'Quadriceps',
  hamstrings: 'Ischio-jambiers',
  calves: 'Mollets',
};

export const CATEGORIES = {
  upper: 'Haut du corps',
  lower: 'Bas du corps',
  core: 'Abdos et gainage',
  cardio: 'Cardio',
  custom: 'Mes exercices',
};

const FRONT_FLOOR = 'Téléphone debout au sol, devant toi, à environ 1 m de tes mains.';
const SIDE_2M = 'Téléphone de profil, à 2–3 m, tout le corps dans le cadre.';
const FACE_2M = 'Téléphone face à toi, à 2–3 m, tout le corps dans le cadre.';

const pushupDetector = { type: 'height', posture: 'plank', extended: 80, flexed: 55, partial: 72 };

const LIST = [
  // ---------- Haut du corps ----------
  {
    id: 'pushup', name: 'Pompes', category: 'upper', icon: 'pushup',
    muscles: { primary: ['pecs', 'triceps', 'shoulders'], secondary: ['abs'] },
    tip: `${FRONT_FLOOR} Tiens la planche bras tendus 1 seconde pour démarrer.`,
    setupHint: 'Mets-toi en position de pompe face au téléphone, bras tendus',
    partialHint: 'Descends plus bas',
    detector: pushupDetector,
  },
  {
    id: 'pushup_wide', name: 'Pompes larges', category: 'upper', icon: 'pushup',
    muscles: { primary: ['pecs', 'shoulders'], secondary: ['triceps', 'abs'] },
    tip: `${FRONT_FLOOR} Mains plus écartées que les épaules.`,
    setupHint: 'Mets-toi en position de pompe, mains écartées, bras tendus',
    partialHint: 'Descends plus bas',
    detector: pushupDetector,
  },
  {
    id: 'pushup_diamond', name: 'Pompes diamant', category: 'upper', icon: 'pushup',
    muscles: { primary: ['triceps', 'pecs'], secondary: ['shoulders', 'abs'] },
    tip: `${FRONT_FLOOR} Mains rapprochées sous la poitrine.`,
    setupHint: 'Mets-toi en position de pompe, mains rapprochées, bras tendus',
    partialHint: 'Descends plus bas',
    detector: pushupDetector,
  },
  {
    id: 'pike_pushup', name: 'Pompes piquées', category: 'upper', icon: 'pike',
    muscles: { primary: ['shoulders', 'triceps'], secondary: ['pecs', 'traps'] },
    tip: `${FRONT_FLOOR} Hanches hautes, en V inversé.`,
    setupHint: 'Mets-toi en V inversé, hanches hautes, bras tendus',
    partialHint: 'Descends la tête plus bas',
    detector: pushupDetector,
  },
  {
    id: 'dips', name: 'Dips', category: 'upper', icon: 'dips',
    muscles: { primary: ['triceps', 'pecs'], secondary: ['shoulders'] },
    tip: `${FACE_2M} Sur deux chaises ou des barres parallèles.`,
    setupHint: 'Mets-toi en appui sur les mains, bras tendus, buste droit',
    partialHint: 'Descends plus bas',
    detector: { type: 'height', posture: 'upright', extended: 85, flexed: 62, partial: 75 },
  },
  {
    id: 'pullup', name: 'Tractions', category: 'upper', icon: 'pullup',
    muscles: { primary: ['back', 'biceps'], secondary: ['forearms', 'shoulders', 'traps'] },
    tip: `${FACE_2M} Bras et tête visibles.`,
    setupHint: 'Accroche-toi à la barre, bras et tête visibles',
    partialHint: 'Monte le menton au-dessus de la barre',
    detector: { type: 'angle', joint: ['shoulder', 'elbow', 'wrist'], sides: 'best', extended: 145, flexed: 85, partial: 115, posture: 'wristsAboveShoulders', topCheck: 'chinOverBar' },
  },
  {
    id: 'chinup', name: 'Tractions supination', category: 'upper', icon: 'pullup',
    muscles: { primary: ['biceps', 'back'], secondary: ['forearms', 'shoulders'] },
    tip: `${FACE_2M} Paumes vers toi, bras et tête visibles.`,
    setupHint: 'Accroche-toi à la barre paumes vers toi',
    partialHint: 'Monte le menton au-dessus de la barre',
    detector: { type: 'angle', joint: ['shoulder', 'elbow', 'wrist'], sides: 'best', extended: 145, flexed: 85, partial: 115, posture: 'wristsAboveShoulders', topCheck: 'chinOverBar' },
  },

  // ---------- Bas du corps ----------
  {
    id: 'squat', name: 'Squats', category: 'lower', icon: 'squat',
    muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings', 'lowerback'] },
    tip: `${SIDE_2M} De face, ça marche aussi.`,
    setupHint: 'Recule pour que tout ton corps soit visible',
    partialHint: 'Descends plus bas',
    detector: { type: 'angle', joint: ['hip', 'knee', 'ankle'], sides: 'best', extended: 160, flexed: 100, partial: 135 },
  },
  {
    id: 'jump_squat', name: 'Squats sautés', category: 'lower', icon: 'squat',
    muscles: { primary: ['quads', 'glutes'], secondary: ['calves', 'hamstrings'] },
    tip: SIDE_2M,
    setupHint: 'Recule pour que tout ton corps soit visible',
    partialHint: 'Descends plus bas',
    detector: { type: 'angle', joint: ['hip', 'knee', 'ankle'], sides: 'best', extended: 160, flexed: 105, partial: 135, minRepMs: 300 },
  },
  {
    id: 'lunge', name: 'Fentes alternées', category: 'lower', icon: 'lunge',
    muscles: { primary: ['quads', 'glutes'], secondary: ['hamstrings', 'calves'] },
    tip: SIDE_2M,
    setupHint: 'Recule pour que tout ton corps soit visible',
    partialHint: 'Descends le genou plus bas',
    detector: { type: 'angle', joint: ['hip', 'knee', 'ankle'], sides: 'min', extended: 160, flexed: 110, partial: 135 },
  },
  {
    id: 'glute_bridge', name: 'Pont fessier', category: 'lower', icon: 'bridge',
    muscles: { primary: ['glutes', 'hamstrings'], secondary: ['lowerback', 'abs'] },
    tip: 'Téléphone de profil, au sol, à 2 m. Allongé sur le dos, genoux pliés.',
    setupHint: 'Allonge-toi sur le dos, genoux pliés, de profil',
    partialHint: 'Monte les hanches plus haut',
    // Valeur = 180 − angle épaule-hanche-genou : hanches en bas ≈ 60, en haut (alignées) ≈ 10.
    detector: { type: 'angle', joint: ['shoulder', 'hip', 'knee'], sides: 'best', invert: true, extended: 45, flexed: 22, partial: 32, posture: 'lying' },
  },
  {
    id: 'wall_sit', name: 'Chaise', category: 'lower', icon: 'wallsit', kind: 'hold',
    muscles: { primary: ['quads', 'glutes'], secondary: ['calves'] },
    tip: `${SIDE_2M} Dos contre un mur, cuisses à l'horizontale.`,
    setupHint: 'Dos au mur, descends jusqu\'aux cuisses à l\'horizontale',
    detector: { type: 'hold', check: 'wallSit' },
  },

  // ---------- Abdos et gainage ----------
  {
    id: 'plank', name: 'Gainage', category: 'core', icon: 'plank', kind: 'hold',
    muscles: { primary: ['abs'], secondary: ['shoulders', 'obliques', 'lowerback', 'glutes'] },
    tip: 'Téléphone au sol, de face à environ 1 m de tes coudes, ou de profil à 2 m. Sur les avant-bras ou bras tendus.',
    setupHint: 'Mets-toi en planche, bien visible',
    detector: { type: 'hold', check: 'plank' },
  },
  {
    id: 'situp', name: 'Relevés de buste', category: 'core', icon: 'situp',
    muscles: { primary: ['abs'], secondary: ['obliques'] },
    tip: 'Téléphone de profil, au sol, à 2 m. Allongé, genoux pliés.',
    setupHint: 'Allonge-toi sur le dos, genoux pliés, de profil',
    partialHint: 'Remonte plus haut',
    detector: { type: 'angle', joint: ['shoulder', 'hip', 'knee'], sides: 'best', extended: 115, flexed: 75, partial: 95 },
  },
  {
    id: 'leg_raise', name: 'Relevés de jambes', category: 'core', icon: 'legraise',
    muscles: { primary: ['abs'], secondary: ['obliques', 'quads'] },
    tip: 'Téléphone de profil, au sol, à 2 m. Allongé sur le dos, jambes tendues.',
    setupHint: 'Allonge-toi sur le dos, jambes tendues, de profil',
    partialHint: 'Monte les jambes plus haut',
    detector: { type: 'angle', joint: ['shoulder', 'hip', 'ankle'], sides: 'best', extended: 150, flexed: 110, partial: 130, posture: 'lying' },
  },
  {
    id: 'mountain_climber', name: 'Mountain climbers', category: 'core', icon: 'climber',
    muscles: { primary: ['abs', 'shoulders'], secondary: ['quads', 'obliques'] },
    tip: 'Téléphone de profil, au sol, à 2 m. Chaque genou ramené compte pour 1.',
    setupHint: 'Mets-toi en planche bras tendus, de profil',
    partialHint: 'Ramène le genou plus près',
    detector: { type: 'angle', joint: ['shoulder', 'hip', 'knee'], sides: 'each', extended: 145, flexed: 105, partial: 125, minRepMs: 250 },
  },

  // ---------- Cardio ----------
  {
    id: 'jumping_jack', name: 'Jumping jacks', category: 'cardio', icon: 'jack',
    muscles: { primary: ['shoulders', 'calves'], secondary: ['glutes', 'quads'] },
    tip: FACE_2M,
    setupHint: 'Mets-toi face au téléphone, bras le long du corps',
    partialHint: 'Monte les bras plus haut',
    // Valeur = 180 − angle hanche-épaule-poignet : bras le long du corps ≈ 160, en l'air ≈ 20.
    detector: { type: 'angle', joint: ['hip', 'shoulder', 'wrist'], sides: 'best', invert: true, extended: 130, flexed: 60, partial: 95, minRepMs: 300 },
  },
  {
    id: 'high_knees', name: 'Montées de genoux', category: 'cardio', icon: 'knees',
    muscles: { primary: ['quads', 'abs'], secondary: ['calves', 'glutes'] },
    tip: `${SIDE_2M} Chaque genou levé compte pour 1.`,
    setupHint: 'Recule pour que tout ton corps soit visible',
    partialHint: 'Monte le genou plus haut',
    detector: { type: 'angle', joint: ['shoulder', 'hip', 'knee'], sides: 'each', extended: 155, flexed: 115, partial: 135, minRepMs: 250 },
  },
  {
    id: 'burpee', name: 'Burpees', category: 'cardio', icon: 'burpee',
    muscles: { primary: ['quads', 'pecs', 'shoulders'], secondary: ['abs', 'glutes', 'triceps'] },
    tip: `${SIDE_2M} Commence debout, immobile 1 seconde.`,
    setupHint: 'Recule pour que tout ton corps soit visible, debout',
    partialHint: 'Descends jusqu\'au sol',
    detector: { type: 'stature', extended: 80, flexed: 40, partial: 60 },
  },
];

/** Mouvements proposés pour un exercice personnalisé. */
export const PRESETS = {
  elbows: { label: 'Plier les coudes', detector: { type: 'angle', joint: ['shoulder', 'elbow', 'wrist'], sides: 'best', extended: 150, flexed: 95, partial: 125 } },
  pushup: { label: 'Monter / descendre en appui sur les mains', detector: pushupDetector },
  knees: { label: 'Plier les genoux', detector: { type: 'angle', joint: ['hip', 'knee', 'ankle'], sides: 'best', extended: 160, flexed: 100, partial: 135 } },
  knees_alt: { label: 'Plier un genou puis l\'autre', detector: { type: 'angle', joint: ['hip', 'knee', 'ankle'], sides: 'min', extended: 160, flexed: 110, partial: 135 } },
  hips: { label: 'Plier les hanches (buste ou jambes)', detector: { type: 'angle', joint: ['shoulder', 'hip', 'knee'], sides: 'best', extended: 140, flexed: 95, partial: 120 } },
  hips_alt: { label: 'Lever un genou puis l\'autre', detector: { type: 'angle', joint: ['shoulder', 'hip', 'knee'], sides: 'each', extended: 155, flexed: 115, partial: 135, minRepMs: 250 } },
  arms_up: { label: 'Lever les bras', detector: { type: 'angle', joint: ['hip', 'shoulder', 'wrist'], sides: 'best', invert: true, extended: 130, flexed: 60, partial: 95 } },
  stature: { label: 'Descendre au sol et se relever', detector: { type: 'stature', extended: 80, flexed: 40, partial: 60 } },
  hold: { label: 'Tenir une position (secondes)', kind: 'hold', detector: { type: 'hold', check: 'still' } },
};

export const CATALOG = Object.fromEntries(LIST.map((e) => [e.id, { kind: 'reps', ...e }]));

/** Construit un exercice personnalisé à partir de ce que l'utilisateur a saisi. */
export function makeCustom({ id, name, primary = [], secondary = [], preset = 'elbows' }) {
  const p = PRESETS[preset] ?? PRESETS.elbows;
  return {
    id: id ?? `custom_${Date.now().toString(36)}`,
    name: String(name).trim().slice(0, 40) || 'Exercice',
    category: 'custom',
    icon: 'custom',
    kind: p.kind ?? 'reps',
    custom: true,
    preset,
    muscles: { primary: primary.filter((m) => MUSCLES[m]), secondary: secondary.filter((m) => MUSCLES[m] && !primary.includes(m)) },
    tip: 'Place le téléphone pour que tout le mouvement soit visible, à 2–3 m.',
    setupHint: 'Mets-toi en position de départ, bien visible',
    partialHint: 'Fais le mouvement en entier',
    detector: p.detector,
  };
}

/** Catalogue + exercices personnalisés (liste de définitions sauvegardées). */
export function allExercises(customDefs = []) {
  const map = { ...CATALOG };
  for (const def of customDefs) {
    const ex = makeCustom(def);
    map[ex.id] = ex;
  }
  return map;
}
