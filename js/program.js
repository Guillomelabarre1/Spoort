// Programmes de séance : une suite d'étapes { exercise, target } avec un repos entre chaque.
// `target` = nombre de répétitions, ou secondes pour un exercice de maintien (gainage, chaise).
// Pur (sans DOM), testé sous Node.

export const REST_DEFAULT = 30;
export const LIMITS = { reps: [1, 500], hold: [5, 3600], rest: [0, 600], steps: 30 };

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

/** Nettoie un programme : exercices connus, objectifs dans les bornes, 30 étapes max. */
export function normalizeProgram(p, exercises) {
  const steps = (Array.isArray(p?.steps) ? p.steps : [])
    .filter((s) => exercises[s?.exercise])
    .slice(0, LIMITS.steps)
    .map((s) => {
      const hold = exercises[s.exercise].kind === 'hold';
      return { exercise: s.exercise, target: clamp(s.target, hold ? LIMITS.hold : LIMITS.reps) };
    });
  return {
    ...(p?.id ? { id: p.id } : {}),
    name: String(p?.name ?? '').trim().slice(0, 40) || 'Mon programme',
    rest: clamp(p?.rest ?? REST_DEFAULT, LIMITS.rest),
    steps,
  };
}

/** Résumé : nombre d'exercices, total de répétitions / secondes tenues, durée estimée (minutes). */
export function summarize(p, exercises) {
  let reps = 0, hold = 0;
  for (const s of p.steps) {
    if (exercises[s.exercise]?.kind === 'hold') hold += s.target;
    else reps += s.target;
  }
  // ~2,5 s par répétition + temps tenu + repos + ~10 s de mise en place par exercice.
  const seconds = reps * 2.5 + hold + p.rest * Math.max(0, p.steps.length - 1) + 10 * p.steps.length;
  return { count: p.steps.length, reps, hold, minutes: Math.max(1, Math.round(seconds / 60)) };
}

/** Déroulé d'un programme pendant la séance. */
export class ProgramRun {
  constructor(program) {
    this.program = program;
    this.index = 0;
    this.results = []; // { exercise, target, done, partials, seconds, skipped }
  }

  get step() { return this.program.steps[this.index] ?? null; }
  get nextStep() { return this.program.steps[this.index + 1] ?? null; }
  get isLast() { return this.index >= this.program.steps.length - 1; }
  get finished() { return this.index >= this.program.steps.length; }

  /** Termine l'étape en cours (objectif atteint ou passée) et avance. Renvoie le résultat. */
  complete({ done, partials = 0, seconds = 0 }) {
    const step = this.step;
    if (!step) return null;
    const result = { exercise: step.exercise, target: step.target, done, partials, seconds: Math.round(seconds), skipped: done < step.target };
    this.results.push(result);
    this.index += 1;
    return result;
  }

  /** Bilan : étapes réussies, total de répétitions (hors maintiens). */
  report(exercises) {
    const completed = this.results.filter((r) => !r.skipped).length;
    const reps = this.results.filter((r) => exercises[r.exercise]?.kind !== 'hold').reduce((s, r) => s + r.done, 0);
    return { completed, total: this.program.steps.length, reps };
  }
}
