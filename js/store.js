// Données du profil actif côté téléphone, avec synchronisation vers le serveur.
//
// - Tout est d'abord enregistré sur le téléphone (l'app marche hors ligne).
// - Si le serveur est joignable (connexion Pangolin), on choisit son profil sur la page
//   « Qui s'entraîne ? » ; chaque modification est envoyée, le serveur fusionne et renvoie la
//   version complète (les ajouts faits sur les autres appareils arrivent ainsi).
// - Le téléphone garde une copie par profil : passer d'un profil à l'autre ne mélange rien.

import { mergeDocs, normalizeDoc, live, tombstone, newId } from './merge.js';

const PREFIX = 'repcounter.doc:';
const ACTIVE = 'repcounter.activeProfile';
const PROFILES = 'repcounter.profiles';
const TOKENS = 'repcounter.tokens'; // jetons d'accès (obtenus avec le code PIN) par profil
const OLD_HISTORY = 'repcounter.history';
const OLD_CUSTOM = 'repcounter.custom';

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

async function api(path, opts = {}, timeout = 8000, token = null) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = { 'Content-Type': 'application/json', ...(token ? { 'X-Profile-Token': token } : {}) };
    const res = await fetch(path, { cache: 'no-store', signal: ctrl.signal, ...opts, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status, retryAfter: body.retryAfter ?? 0 });
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export class Store extends EventTarget {
  constructor() {
    super();
    this.server = false;                     // synchro disponible (connexion Pangolin)
    this.profiles = read(PROFILES) ?? [];    // liste en cache (fonctionne hors ligne)
    this.profileId = null;
    this.tokens = read(TOKENS) ?? {};
    this.status = 'local';                   // local | syncing | synced | offline
    this.lastSyncAt = null;
    this.key = `${PREFIX}local`;
    this.doc = this.loadLocal();
    this.timer = null;
  }

  /** Document « local » (sans serveur), en récupérant les données d'avant les profils. */
  loadLocal() {
    let doc = normalizeDoc(read(`${PREFIX}local`));
    const oldHistory = read(OLD_HISTORY), oldCustom = read(OLD_CUSTOM);
    if (Array.isArray(oldHistory) || Array.isArray(oldCustom)) {
      const now = Date.now();
      doc = mergeDocs(doc, { history: oldHistory ?? [], custom: (oldCustom ?? []).map((c) => ({ ...c, updatedAt: c.updatedAt ?? now })) });
      localStorage.setItem(`${PREFIX}local`, JSON.stringify(doc));
      localStorage.removeItem(OLD_HISTORY);
      localStorage.removeItem(OLD_CUSTOM);
    }
    return doc;
  }

  /**
   * Démarrage : le serveur est-il là ? Si oui, charge la liste des profils et reprend le profil
   * choisi sur ce téléphone, sinon émet « choose » (afficher la page de choix).
   */
  async init() {
    const active = localStorage.getItem(ACTIVE);
    try {
      const me = await api('api/me', {}, 5000);
      this.server = Boolean(me.sync);
    } catch {
      // Hors ligne : on continue avec le profil déjà choisi, s'il y en a un.
      this.server = Boolean(active && this.profiles.length);
    }
    if (!this.server) return this.setStatus('local');
    await this.refreshProfiles();
    if (active && this.profiles.some((p) => p.id === active) && !this.needsPin(active)) await this.select(active);
    else { localStorage.removeItem(ACTIVE); this.dispatchEvent(new Event('choose')); }
  }

  async refreshProfiles() {
    try {
      this.profiles = await api('api/profiles');
      localStorage.setItem(PROFILES, JSON.stringify(this.profiles));
    } catch { /* hors ligne : liste en cache */ }
    this.dispatchEvent(new Event('profiles'));
    return this.profiles;
  }

  saveTokens() { localStorage.setItem(TOKENS, JSON.stringify(this.tokens)); }

  /** Ce profil demande-t-il son code sur ce téléphone ? */
  needsPin(id) {
    return Boolean(this.profiles.find((p) => p.id === id)?.hasPin) && !this.tokens[id];
  }

  hasPin(id) {
    return Boolean(this.profiles.find((p) => p.id === id)?.hasPin);
  }

  /** Vérifie le code auprès du serveur ; garde le jeton d'accès. Erreur : { message, status, retryAfter }. */
  async unlock(id, pin) {
    const { token } = await api(`api/profiles/${id}/unlock`, { method: 'POST', body: JSON.stringify({ pin }) });
    this.tokens[id] = token;
    this.saveTokens();
  }

  /** Définit ou change le code du profil actif (les autres appareils devront le saisir à nouveau). */
  async setPin(pin) {
    const id = this.profileId;
    const { token } = await api(`api/profiles/${id}/pin`, { method: 'PUT', body: JSON.stringify({ pin }) }, 8000, this.tokens[id]);
    this.tokens[id] = token;
    this.saveTokens();
    const entry = this.profiles.find((p) => p.id === id);
    if (entry) { entry.hasPin = true; localStorage.setItem(PROFILES, JSON.stringify(this.profiles)); }
  }

  /** Active un profil sur ce téléphone et synchronise. */
  async select(id) {
    this.profileId = id;
    localStorage.setItem(ACTIVE, id);
    this.key = `${PREFIX}${id}`;
    let doc = normalizeDoc(read(this.key));
    // Une seule fois par téléphone : les données d'avant (sans profil) rejoignent le premier profil choisi.
    const local = normalizeDoc(read(`${PREFIX}local`));
    if (!localStorage.getItem(`${PREFIX}migrated`) && (local.history.length || local.measurements.length || local.custom.length || local.programs.length)) {
      doc = mergeDocs(doc, local);
      localStorage.setItem(`${PREFIX}migrated`, id);
    }
    this.doc = doc;
    localStorage.setItem(this.key, JSON.stringify(this.doc));
    this.dispatchEvent(new Event('change'));
    await this.sync();
  }

  /** Crée un profil sur le serveur puis l'active. */
  async createProfile(name, avatar = null, pin) {
    const { id, token } = await api('api/profiles', { method: 'POST', body: JSON.stringify({ name, avatar, pin }) });
    this.tokens[id] = token;
    this.saveTokens();
    await this.refreshProfiles();
    await this.select(id);
    return id;
  }

  async deleteProfile(id) {
    await api(`api/profiles/${id}/data`, { method: 'DELETE' }, 8000, this.tokens[id]);
    localStorage.removeItem(`${PREFIX}${id}`);
    delete this.tokens[id];
    this.saveTokens();
    if (this.profileId === id) {
      localStorage.removeItem(ACTIVE);
      this.profileId = null;
      this.dispatchEvent(new Event('choose'));
    }
    await this.refreshProfiles();
  }

  /**
   * Retour à la page de choix : le profil est reverrouillé sur ce téléphone (le code sera redemandé)
   * et sa copie locale effacée une fois tout envoyé au serveur — rien de perso ne reste en clair.
   */
  async signOut() {
    clearTimeout(this.timer);
    const id = this.profileId;
    localStorage.removeItem(ACTIVE);
    this.profileId = null;
    this.dispatchEvent(new Event('choose'));
    if (!id || !this.server) return;
    let synced = false;
    try {
      await api(`api/profiles/${id}/data`, { method: 'PUT', body: JSON.stringify(this.doc) }, 8000, this.tokens[id]);
      synced = true;
      if (this.hasPin(id)) await api(`api/profiles/${id}/lock`, { method: 'POST' }, 5000, this.tokens[id]);
    } catch { /* hors ligne : la copie locale est gardée pour ne rien perdre */ }
    if (this.hasPin(id)) { delete this.tokens[id]; this.saveTokens(); }
    if (synced && this.hasPin(id)) localStorage.removeItem(`${PREFIX}${id}`);
    if (!this.profileId) this.doc = normalizeDoc(null);
  }

  setStatus(s) {
    this.status = s;
    this.dispatchEvent(new Event('status'));
  }

  save(push = true) {
    localStorage.setItem(this.key, JSON.stringify(this.doc));
    if (push && this.server && this.profileId) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sync(), 800);
    }
  }

  /** Envoie le document ; le serveur renvoie la fusion avec ce qu'il a déjà. */
  async sync() {
    if (!this.server || !this.profileId) return;
    clearTimeout(this.timer);
    const id = this.profileId;
    this.setStatus('syncing');
    try {
      const merged = normalizeDoc(await api(`api/profiles/${id}/data`, { method: 'PUT', body: JSON.stringify(this.doc) }, 8000, this.tokens[id]));
      if (this.profileId !== id) return; // profil changé pendant l'envoi
      this.doc = mergeDocs(merged, this.doc); // garde ce qui a été modifié pendant l'envoi
      localStorage.setItem(this.key, JSON.stringify(this.doc));
      this.lastSyncAt = Date.now();
      this.setStatus('synced');
      this.dispatchEvent(new Event('change'));
    } catch (err) {
      if (err.status === 404) { // profil supprimé depuis un autre appareil
        localStorage.removeItem(this.key);
        localStorage.removeItem(ACTIVE);
        this.profileId = null;
        this.dispatchEvent(new Event('choose'));
        await this.refreshProfiles();
        return;
      }
      if (err.status === 401) { // code changé ailleurs, ou accès révoqué : on redemande le code
        delete this.tokens[id];
        this.saveTokens();
        await this.refreshProfiles();
        localStorage.removeItem(ACTIVE);
        this.profileId = null;
        this.dispatchEvent(new CustomEvent('locked', { detail: id }));
        return;
      }
      this.setStatus('offline');
    }
  }

  // ---------- Lecture ----------
  get history() { return live(this.doc.history); }
  get measurements() { return live(this.doc.measurements); }
  get custom() { return live(this.doc.custom); }
  get profile() { return this.doc.profile ?? {}; }
  get programs() { return live(this.doc.programs).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'fr')); }

  // ---------- Écriture ----------
  addSession(entry) {
    this.doc.history.push({ id: newId('s'), ...entry, updatedAt: Date.now() });
    this.doc.history.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    this.save();
  }

  clearHistory() {
    const now = Date.now();
    this.doc.history = this.doc.history.map((h) => (h.deleted ? h : tombstone(h, now)));
    this.save();
  }

  addMeasurement(entry) {
    this.doc.measurements.push({ id: newId('m'), ...entry, updatedAt: Date.now() });
    this.doc.measurements.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    this.save();
  }

  deleteMeasurement(id) {
    this.doc.measurements = this.doc.measurements.map((m) => (m.id === id ? tombstone(m) : m));
    this.save();
  }

  addCustom(def) {
    this.doc.custom.push({ ...def, updatedAt: Date.now() });
    this.save();
  }

  deleteCustom(id) {
    this.doc.custom = this.doc.custom.map((c) => (c.id === id ? tombstone(c) : c));
    this.save();
  }

  /** Crée ou met à jour un programme (même id = mise à jour). Renvoie son id. */
  saveProgram(program) {
    const id = program.id ?? newId('p');
    this.doc.programs = this.doc.programs.filter((p) => p.id !== id);
    this.doc.programs.push({ ...program, id, updatedAt: Date.now() });
    this.save();
    return id;
  }

  deleteProgram(id) {
    this.doc.programs = this.doc.programs.map((p) => (p.id === id ? tombstone(p) : p));
    this.save();
  }

  setProfile(patch) {
    this.doc.profile = { ...this.profile, ...patch, updatedAt: Date.now() };
    this.save();
    // Met à jour la liste (prénom / photo sur la page de choix) sans attendre le serveur.
    const entry = this.profiles.find((p) => p.id === this.profileId);
    if (entry) {
      Object.assign(entry, { name: this.doc.profile.name ?? entry.name, avatar: this.doc.profile.avatar ?? null });
      localStorage.setItem(PROFILES, JSON.stringify(this.profiles));
    }
  }

  /** Import d'une sauvegarde (fusion, sans doublon). Renvoie le nombre de séances ajoutées. */
  importBackup(data) {
    const before = this.history.length;
    const incoming = normalizeDoc({
      profile: null, // on ne remplace pas le profil actif par celui du fichier
      history: data.history ?? [],
      measurements: data.measurements ?? [],
      custom: data.custom ?? [],
      programs: data.programs ?? [],
    });
    this.doc = mergeDocs(this.doc, incoming);
    this.save();
    return this.history.length - before;
  }

  exportBackup() {
    return { app: 'repcounter', version: 2, exportedAt: new Date().toISOString(), ...this.doc };
  }
}
