// Programmes de séance : une suite d'étapes { exercise, target, timed? } avec un repos entre chaque.
// `target` = nombre de répétitions ; secondes pour un maintien (gainage, chaise) ou pour une étape
// chronométrée (`timed` : « le plus de répétitions possible en 30 s »).
// Deux types :
//   sets  : la liste est faite `rounds` fois (1 par défaut) ;
//   amrap : la liste tourne en boucle pendant `duration` secondes, score = tours + répétitions.
// Pur (sans DOM), testé sous Node.

export const REST_DEFAULT = 30;
export const LIMITS = { reps: [1, 500], hold: [5, 3600], rest: [0, 600], steps: 30, rounds: [1, 20], duration: [60, 7200] };

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

/** L'étape se mesure en secondes (maintien, ou étape chronométrée). */
export const isTimedStep = (s, exercises) => exercises[s.exercise]?.kind === 'hold' || !!s.timed;

/** Nettoie un programme : exercices connus, objectifs dans les bornes, 30 étapes max. */
export function normalizeProgram(p, exercises) {
  const steps = (Array.isArray(p?.steps) ? p.steps : [])
    .filter((s) => exercises[s?.exercise])
    .slice(0, LIMITS.steps)
    .map((s) => {
      const hold = exercises[s.exercise].kind === 'hold';
      const timed = !hold && !!s.timed;
      return { exercise: s.exercise, target: clamp(s.target, hold || timed ? LIMITS.hold : LIMITS.reps), ...(timed ? { timed: true } : {}) };
    });
  const amrap = p?.mode === 'amrap';
  return {
    ...(p?.id ? { id: p.id } : {}),
    name: String(p?.name ?? '').trim().slice(0, 40) || 'Mon programme',
    mode: amrap ? 'amrap' : 'sets',
    rest: clamp(p?.rest ?? (amrap ? 0 : REST_DEFAULT), LIMITS.rest),
    rounds: amrap ? 1 : clamp(p?.rounds ?? 1, LIMITS.rounds),
    ...(amrap ? { duration: clamp(p?.duration ?? 1200, LIMITS.duration) } : {}),
    ...(p?.source ? { source: { name: String(p.source.name ?? '').slice(0, 80), url: String(p.source.url ?? '') } } : {}),
    steps,
  };
}

/** Résumé : nombre d'exercices, total de répétitions / secondes par tour et en tout, durée estimée (minutes). */
export function summarize(p, exercises) {
  let reps = 0, hold = 0;
  for (const s of p.steps) {
    if (isTimedStep(s, exercises)) hold += s.target;
    else reps += s.target;
  }
  const rounds = p.mode === 'amrap' ? 1 : p.rounds ?? 1;
  const n = p.steps.length * rounds;
  // ~2,5 s par répétition + temps tenu + repos + ~10 s de mise en place par exercice.
  const seconds = p.mode === 'amrap' ? p.duration
    : (reps * 2.5 + hold) * rounds + p.rest * Math.max(0, n - 1) + 10 * n;
  return { count: p.steps.length, reps: reps * rounds, hold: hold * rounds, perRound: reps, rounds, amrap: p.mode === 'amrap', minutes: Math.max(1, Math.round(seconds / 60)) };
}

/** Déroulé d'un programme pendant la séance. */
export class ProgramRun {
  constructor(program) {
    this.program = program;
    this.amrap = program.mode === 'amrap';
    this.rounds = this.amrap ? Infinity : program.rounds ?? 1;
    this.index = 0;
    this.results = []; // { exercise, target, done, partials, seconds, skipped, slot, round }
  }

  get size() { return this.program.steps.length; }
  get length() { return this.size * this.rounds; }
  /** Tour en cours (0 = premier). */
  get round() { return Math.floor(this.index / this.size); }
  /** Position dans le tour (0 = premier exercice). */
  get slot() { return this.index % this.size; }
  stepAt(i) { return i < this.length ? this.program.steps[i % this.size] : null; }
  get step() { return this.stepAt(this.index); }
  get nextStep() { return this.stepAt(this.index + 1); }
  get isLast() { return this.index >= this.length - 1; }
  get finished() { return this.index >= this.length; }

  /** Termine l'étape en cours (objectif atteint, temps écoulé ou passée) et avance. Renvoie le résultat. */
  complete({ done, partials = 0, seconds = 0, timeUp = false }) {
    const step = this.step;
    if (!step) return null;
    // Étape chronométrée d'un exercice à répétitions : réussie si le temps a été tenu jusqu'au bout.
    const skipped = step.timed ? !timeUp : done < step.target;
    const result = { exercise: step.exercise, target: step.target, done, partials, seconds: Math.round(seconds), skipped, slot: this.slot, round: this.round, ...(step.timed ? { timed: true } : {}) };
    this.results.push(result);
    this.index += 1;
    return result;
  }

  /**
   * Bilan : étapes réussies, total de répétitions (hors maintiens).
   * AMRAP : tours complets + répétitions faites dans le tour entamé.
   */
  report(exercises) {
    const completed = this.results.filter((r) => !r.skipped).length;
    const counted = (r) => exercises[r.exercise]?.kind !== 'hold';
    const reps = this.results.filter(counted).reduce((s, r) => s + r.done, 0);
    const out = { completed, total: this.amrap ? this.results.length : this.length, reps };
    if (this.amrap) {
      // Un tour compte quand tous ses exercices sont terminés ; le reste fait les « + reps ».
      let rounds = 0, extra = 0;
      for (let r = 0; ; r++) {
        const inRound = this.results.filter((x) => x.round === r);
        if (!inRound.length) break;
        if (inRound.length === this.size && inRound.every((x) => !x.skipped)) rounds += 1;
        else extra += inRound.filter(counted).reduce((s, x) => s + x.done, 0);
      }
      Object.assign(out, { rounds, extra });
    }
    return out;
  }

  /** Totaux par exercice du programme (ordre des étapes), pour le bilan des séances à plusieurs tours. */
  perSlot() {
    return this.program.steps.map((step, slot) => {
      const rs = this.results.filter((r) => r.slot === slot);
      return { step, done: rs.reduce((s, r) => s + r.done, 0), times: rs.filter((r) => !r.skipped).length, attempts: rs.length };
    });
  }
}
