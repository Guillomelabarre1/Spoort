// Statistiques calculées à partir de l'historique local (sans dépendance, testable sous Node).
// Une entrée d'historique : { date: ISO, exercise: 'pushup'|'squat'|'pullup', reps, partials, seconds }.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** Clé de jour locale AAAA-MM-JJ. */
export function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Minuit local du jour donné, décalé de `offset` jours. */
export function startOfDay(d, offset = 0) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + offset);
  return x;
}

export const isHold = (h) => h.kind === 'hold';

/** Séances d'un exercice. Pour 'all', seulement les exercices à répétitions (les maintiens sont en secondes). */
export const filterEx = (history, ex = 'all') => (ex === 'all' ? history.filter((h) => !isHold(h)) : history.filter((h) => h.exercise === ex));

/** Map jour → total de répétitions. */
export function repsByDay(history, ex = 'all') {
  const map = new Map();
  for (const h of filterEx(history, ex)) map.set(dayKey(h.date), (map.get(dayKey(h.date)) ?? 0) + h.reps);
  return map;
}

/** Les `n` derniers jours (le plus ancien d'abord) : [{ date, key, reps }]. */
export function lastDays(history, n, ex = 'all', now = new Date()) {
  const byDay = repsByDay(history, ex);
  return Array.from({ length: n }, (_, i) => {
    const date = startOfDay(now, i - n + 1);
    const key = dayKey(date);
    return { date, key, reps: byDay.get(key) ?? 0 };
  });
}

/** Total de répétitions et de séances sur les `days` derniers jours, éventuellement décalé de `offset` jours. */
export function totals(history, ex = 'all', days = 7, now = new Date(), offset = 0) {
  const to = startOfDay(now, 1 - offset).getTime();
  const from = to - days * DAY;
  let reps = 0, sessions = 0;
  for (const h of filterEx(history, ex)) {
    const t = new Date(h.date).getTime();
    if (t >= from && t < to) { reps += h.reps; sessions += 1; }
  }
  return { reps, sessions };
}

/** Jours d'affilée avec au moins une séance, en finissant aujourd'hui (ou hier, si pas encore entraîné aujourd'hui). */
export function currentStreak(history, now = new Date(), ex = 'all') {
  // Toute séance compte pour la série, maintiens compris.
  const days = new Set((ex === 'all' ? history : filterEx(history, ex)).map((h) => dayKey(h.date)));
  let d = 0;
  let n = 0;
  if (!days.has(dayKey(now))) d = -1;
  while (days.has(dayKey(startOfDay(now, d)))) { n += 1; d -= 1; }
  return n;
}

/** Meilleure séance (le plus de répétitions). */
export function bestSession(history, ex = 'all') {
  let best = null;
  for (const h of filterEx(history, ex)) if (!best || h.reps > best.reps) best = h;
  return best;
}

/** Cadence en répétitions par minute (null si trop court pour être parlant). */
export function pace(reps, seconds) {
  return seconds >= 10 && reps > 0 ? (reps * 60) / seconds : null;
}

/** Niveau 0–4 d'une case de calendrier, relatif au meilleur jour de la période. */
export function heatLevel(reps, max) {
  if (!reps || !max) return 0;
  return Math.min(4, Math.max(1, Math.ceil((reps / max) * 4)));
}

/**
 * Volume par muscle sur les `days` derniers jours : chaque répétition compte 1 pour les muscles
 * principaux et 0,5 pour les secondaires ; pour les maintiens, 3 secondes valent 1 répétition.
 */
export function muscleVolume(history, exercises, days = 7, now = new Date()) {
  const from = startOfDay(now, 1 - days).getTime();
  const vol = {};
  for (const h of history) {
    if (new Date(h.date).getTime() < from) continue;
    const ex = exercises[h.exercise];
    if (!ex) continue;
    const units = isHold(h) ? h.reps / 3 : h.reps;
    for (const m of ex.muscles.primary) vol[m] = (vol[m] ?? 0) + units;
    for (const m of ex.muscles.secondary) vol[m] = (vol[m] ?? 0) + units * 0.5;
  }
  return vol;
}

/** Début de période (jour, semaine commençant le lundi, ou mois) contenant `d`. */
export function periodStart(d, unit) {
  const x = startOfDay(d);
  if (unit === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  if (unit === 'month') x.setDate(1);
  return x;
}

function nextPeriod(d, unit) {
  const x = new Date(d);
  if (unit === 'day') x.setDate(x.getDate() + 1);
  else if (unit === 'week') x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1);
  return x;
}

/**
 * Regroupe les séances par jour / semaine / mois entre `from` et `to` (inclus) :
 * [{ start, reps, holdSeconds, sessions, activeSeconds }]. Périodes vides incluses.
 */
export function buckets(history, from, to, unit = 'day') {
  const out = [];
  const index = new Map();
  for (let d = periodStart(from, unit); d <= to; d = nextPeriod(d, unit)) {
    index.set(d.getTime(), out.length);
    out.push({ start: new Date(d), reps: 0, holdSeconds: 0, sessions: 0, activeSeconds: 0 });
  }
  for (const h of history) {
    const t = new Date(h.date);
    if (t < from || t > to) continue;
    const b = out[index.get(periodStart(t, unit).getTime())];
    if (!b) continue;
    if (isHold(h)) b.holdSeconds += h.reps; else b.reps += h.reps;
    b.sessions += 1;
    b.activeSeconds += h.seconds || 0;
  }
  return out;
}

/** Totaux par exercice : [{ exercise, reps, sessions, best, hold }], triés par volume. */
export function byExercise(history) {
  const map = new Map();
  for (const h of history) {
    const e = map.get(h.exercise) ?? { exercise: h.exercise, reps: 0, sessions: 0, best: 0, hold: isHold(h) };
    e.reps += h.reps;
    e.sessions += 1;
    e.best = Math.max(e.best, h.reps);
    map.set(h.exercise, e);
  }
  return [...map.values()].sort((a, b) => b.reps - a.reps);
}

/** Nombre de jours différents avec au moins une séance. */
export const activeDays = (history) => new Set(history.map((h) => dayKey(h.date))).size;
