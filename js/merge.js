// Fusion des données d'un profil entre appareils (utilisée par l'app ET par le serveur).
//
// Document d'un profil : { profile, history[], measurements[], custom[], programs[] }.
// Chaque élément de liste a un `id` et un `updatedAt` (ms) ; une suppression est un élément
// { id, deleted: true, updatedAt } (« pierre tombale ») pour qu'elle se propage aux autres appareils.
// Règle : pour un même id, la version la plus récente gagne. Rien n'est jamais perdu en hors-ligne :
// deux appareils qui ajoutent chacun des séances retrouvent l'union des deux.

export const LISTS = ['history', 'measurements', 'custom', 'programs'];

export const emptyDoc = () => ({ profile: null, history: [], measurements: [], custom: [], programs: [] });

/** Identifiant stable d'une ancienne séance (avant les ids) : date + exercice. */
export const legacyId = (h) => `h_${new Date(h.date).getTime().toString(36)}_${h.exercise}`;

export function newId(prefix = 'x') {
  const rnd = globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${rnd.replace(/-/g, '').slice(0, 16)}`;
}

/** Complète un élément ancien (sans id / updatedAt). */
function normalizeItem(item, list) {
  if (!item || typeof item !== 'object') return null;
  const out = { ...item };
  if (!out.id) {
    if (list === 'history' && out.date && out.exercise) out.id = legacyId(out);
    else return null;
  }
  if (!Number.isFinite(out.updatedAt)) out.updatedAt = Date.parse(out.date) || 0;
  return out;
}

export function normalizeDoc(doc) {
  const d = { ...emptyDoc(), ...(doc && typeof doc === 'object' ? doc : {}) };
  for (const list of LISTS) d[list] = (Array.isArray(d[list]) ? d[list] : []).map((x) => normalizeItem(x, list)).filter(Boolean);
  if (d.profile && typeof d.profile !== 'object') d.profile = null;
  return d;
}

function mergeList(a, b) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const cur = map.get(item.id);
    if (!cur || item.updatedAt > cur.updatedAt || (item.updatedAt === cur.updatedAt && item.deleted && !cur.deleted)) map.set(item.id, item);
  }
  return [...map.values()];
}

/** Fusionne deux documents ; le résultat est trié (séances et mesures par date). */
export function mergeDocs(a, b) {
  const x = normalizeDoc(a), y = normalizeDoc(b);
  const out = emptyDoc();
  const pa = x.profile, pb = y.profile;
  out.profile = !pa ? pb : !pb ? pa : (pb.updatedAt ?? 0) > (pa.updatedAt ?? 0) ? pb : pa;
  for (const list of LISTS) out[list] = mergeList(x[list], y[list]);
  const byDate = (p, q) => (Date.parse(p.date) || 0) - (Date.parse(q.date) || 0);
  out.history.sort(byDate);
  out.measurements.sort(byDate);
  return out;
}

/** Éléments visibles (sans les suppressions). */
export const live = (list) => list.filter((x) => !x.deleted);

/** Marque un élément comme supprimé. */
export const tombstone = (item, now = Date.now()) => ({ id: item.id, deleted: true, updatedAt: now, date: item.date });
