// Tableau de bord pour ordinateur : statistiques de chaque profil, comparaison entre profils,
// et gestion (suppression de séances, mesures, programmes ; export CSV).
// Lit et écrit les mêmes données que l'app (API /api/profiles), fusionnées par le serveur.

import { allExercises, MUSCLES } from './exercises.js';
import { buckets, byExercise, activeDays, currentStreak, bestSession, heatLevel, startOfDay, dayKey, isHold, muscleVolume, totals } from './stats.js';
import { MEASURES, series, valuesAt, bodyFatNavy, bmi } from './body.js';
import { normalizeDoc, live, tombstone } from './merge.js';
import { muscleMapSVG } from './musclemap.js';
import { avatar } from './profileui.js';
import { askPin } from './pinpad.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ns = 'http://www.w3.org/2000/svg';
const DAY = 86400000;
const fmtTime = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const fmtNum = (v, d = 1) => (v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: d }));
const fmtDay = (d, o = { day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('fr-FR', o);

const state = { profiles: [], docs: new Map(), current: null, period: '30', exercise: 'all', histLimit: 50 };

// Jetons d'accès (obtenus avec le code PIN), partagés avec l'app sur ce navigateur.
const TOKENS = 'repcounter.tokens';
const tokens = (() => { try { return JSON.parse(localStorage.getItem(TOKENS)) ?? {}; } catch { return {}; } })();
const saveTokens = () => localStorage.setItem(TOKENS, JSON.stringify(tokens));

async function api(path, opts = {}, token = null) {
  const res = await fetch(path, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Profile-Token': token } : {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status, retryAfter: body.retryAfter ?? 0 });
  }
  return res.json();
}

/** Charge les données d'un profil si ce navigateur y a accès ; sinon le profil reste verrouillé. */
async function loadDoc(id) {
  try {
    state.docs.set(id, normalizeDoc(await api(`api/profiles/${id}/data`, {}, tokens[id])));
    return true;
  } catch (err) {
    if (err.status !== 401) throw err;
    delete tokens[id];
    saveTokens();
    state.docs.delete(id);
    return false;
  }
}

async function unlockProfile(p) {
  const ok = await askPin({
    title: p.name,
    subtitle: 'Code du profil',
    avatarEl: avatar(p, 'xl'),
    verify: async (pin) => {
      try {
        const { token } = await api(`api/profiles/${p.id}/unlock`, { method: 'POST', body: JSON.stringify({ pin }) });
        tokens[p.id] = token;
        saveTokens();
        return true;
      } catch (err) { return { error: err.message, retryAfter: err.retryAfter }; }
    },
  });
  if (!ok) return false;
  return loadDoc(p.id);
}

async function select(p) {
  if (!state.docs.has(p.id) && !(await unlockProfile(p))) return;
  state.current = p.id;
  state.histLimit = 50;
  $('#dash-main').hidden = false;
  $('#dash-empty').hidden = true;
  render();
}

function toast(msg) {
  const t = $('#error');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}

function showTip(e, text) {
  const tip = $('#tooltip');
  const r = e.currentTarget.getBoundingClientRect();
  tip.textContent = text;
  tip.style.left = `${Math.min(innerWidth - 110, Math.max(110, r.left + r.width / 2))}px`;
  tip.style.top = `${r.top - 6}px`;
  tip.hidden = false;
}
const hideTip = () => { $('#tooltip').hidden = true; };
const tipOn = (node, text) => {
  node.addEventListener('pointerenter', (e) => showTip(e, text));
  node.addEventListener('pointerleave', hideTip);
};

// ---------- Chargement ----------
async function load() {
  try {
    const me = await api('api/me');
    if (!me.sync) return empty('Le tableau de bord a besoin du serveur', 'Ouvre-le à l\'adresse de ton VPS (derrière Pangolin) : les profils et leurs données y sont stockés.');
    state.profiles = await api('api/profiles');
    if (!state.profiles.length) return empty('Aucun profil pour l\'instant', 'Crée un profil dans l\'app, puis reviens ici.');
    await Promise.all(state.profiles.map((p) => loadDoc(p.id)));
    const wanted = new URLSearchParams(location.search).get('profil') ?? localStorage.getItem('repcounter.activeProfile');
    state.current = state.docs.has(wanted) ? wanted : state.profiles.find((p) => state.docs.has(p.id))?.id ?? null;
    renderProfiles();
    if (!state.current) return empty('Profils verrouillés', 'Choisis un profil en haut et saisis son code pour voir ses statistiques.');
    $('#dash-main').hidden = false;
    render();
  } catch (err) {
    empty('Impossible de charger les données', err.message);
  }
}

function empty(title, text) {
  const box = $('#dash-empty');
  box.innerHTML = '';
  box.append(el('h2', null, title), el('p', null, text));
  box.hidden = false;
}

/** Enregistre une modification (suppression…) du profil affiché ; le serveur fusionne. */
async function saveDoc(mutate, message) {
  const id = state.current;
  const doc = state.docs.get(id);
  mutate(doc);
  try {
    state.docs.set(id, normalizeDoc(await api(`api/profiles/${id}/data`, { method: 'PUT', body: JSON.stringify(doc) }, tokens[id])));
    toast(message);
  } catch (err) {
    toast(`Non enregistré : ${err.message}`);
  }
  render();
}

// ---------- Rendu ----------
function render() {
  const doc = state.docs.get(state.current);
  const exercises = allExercises(live(doc.custom));
  const all = live(doc.history);
  const now = new Date();
  const from = state.period === 'all'
    ? (all.length ? startOfDay(all[0].date) : startOfDay(now, -29))
    : startOfDay(now, 1 - Number(state.period));
  const inPeriod = all.filter((h) => new Date(h.date) >= from && (state.exercise === 'all' || h.exercise === state.exercise));

  renderProfiles();
  renderExerciseFilter(all, exercises);
  renderKpis(inPeriod, all, from, now, exercises);
  renderVolume(inPeriod, from, now);
  renderByExercise(inPeriod, exercises);
  renderMuscles(all.filter((h) => new Date(h.date) >= from), exercises, from, now);
  renderHeat(all, now);
  renderBody(doc);
  renderCompare(now);
  renderHistory(all, exercises);
  renderPrograms(doc, exercises);
  renderMeasures(doc);
}

function renderProfiles() {
  const nav = $('#dash-profiles');
  nav.innerHTML = '';
  for (const p of state.profiles) {
    const doc = state.docs.get(p.id);
    const prof = { ...p, ...(doc?.profile ?? {}) };
    const b = el('button', p.id === state.current ? 'on' : '');
    b.append(avatar(prof), el('span', null, doc ? prof.name : `🔒 ${prof.name}`));
    b.title = doc ? '' : 'Verrouillé : cliquer pour saisir le code';
    b.addEventListener('click', () => select(p));
    nav.append(b);
  }
  if (Object.keys(tokens).length) {
    const lock = el('button', 'dash-lock', 'Tout verrouiller');
    lock.title = 'Oublier les codes sur cet ordinateur';
    lock.addEventListener('click', lockAll);
    nav.append(lock);
  }
}

function renderExerciseFilter(all, exercises) {
  const sel = $('#dash-exercise');
  const done = [...new Set(all.map((h) => h.exercise))].filter((id) => exercises[id]);
  if (state.exercise !== 'all' && !done.includes(state.exercise)) state.exercise = 'all';
  sel.innerHTML = '';
  for (const id of ['all', ...done]) {
    const o = el('option', null, id === 'all' ? 'Tous les exercices' : exercises[id].name);
    o.value = id;
    o.selected = id === state.exercise;
    sel.append(o);
  }
}

function kpi(label, value, sub) {
  const d = el('div', 'kpi');
  d.append(el('small', null, label), el('strong', null, value), el('em', null, sub ?? ''));
  return d;
}

function renderKpis(list, all, from, now, exercises) {
  const box = $('#dash-kpis');
  box.innerHTML = '';
  const holdOnly = state.exercise !== 'all' && exercises[state.exercise]?.kind === 'hold';
  const reps = list.filter((h) => !isHold(h)).reduce((s, h) => s + h.reps, 0);
  const hold = list.filter(isHold).reduce((s, h) => s + h.reps, 0);
  const days = Math.max(1, Math.round((startOfDay(now) - from) / DAY) + 1);
  const active = list.reduce((s, h) => s + (h.seconds || 0), 0);
  const best = bestSession(all, state.exercise);
  // Comparaison avec la période précédente de même durée (sauf « Tout »).
  let sub = '';
  if (state.period !== 'all') {
    const prev = totals(all, state.exercise, Number(state.period), now, Number(state.period));
    const diff = reps - prev.reps;
    if (prev.reps || reps) sub = `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} vs période précédente`;
  }
  box.append(
    holdOnly ? kpi('Temps tenu', fmtTime(hold)) : kpi('Répétitions', reps.toLocaleString('fr-FR'), sub),
    kpi('Séances', String(list.length), `${(list.length / days * 7).toFixed(1).replace('.', ',')} par semaine`),
    kpi('Jours actifs', `${activeDays(list)}`, `sur ${days} jours`),
    kpi('Temps actif', fmtTime(active), hold && !holdOnly ? `dont ${fmtTime(hold)} de maintien` : 'chronométré par l\'app'),
    kpi('Série actuelle', `${currentStreak(all, now, state.exercise)} j`, 'jours d\'affilée'),
    kpi('Record en une séance', best ? (isHold(best) ? fmtTime(best.reps) : String(best.reps)) : '—', best ? `${exercises[best.exercise]?.name ?? ''} · ${fmtDay(best.date)}` : ''),
  );
}

/** Barres : volume par jour (7 et 30 jours), par semaine (3 mois, 1 an) ou par mois (tout). */
function renderVolume(list, from, now) {
  const span = (now - from) / DAY;
  const unit = span <= 31 ? 'day' : span <= 400 ? 'week' : 'month';
  const data = buckets(list, from, now, unit);
  const holdOnly = list.length && list.every(isHold);
  const val = (b) => (holdOnly ? b.holdSeconds : b.reps);
  $('#vol-title').textContent = holdOnly ? 'Temps tenu' : 'Répétitions';
  $('#vol-sub').textContent = { day: 'par jour', week: 'par semaine', month: 'par mois' }[unit];

  const box = $('#vol-chart');
  box.innerHTML = '';
  const max = Math.max(0, ...data.map(val));
  if (!max) { box.append(el('p', 'empty', 'Aucune séance sur cette période.')); return; }
  const W = 800, H = 240, top = 20, bottom = 26, left = 40;
  // Graduations « rondes » (1, 2 ou 5 × 10ⁿ), environ 4 lignes.
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw));
  const nice = Math.ceil(max / step) * step;
  const slot = (W - left) / data.length, bw = Math.min(24, slot * 0.7);
  const y = (v) => top + (H - top - bottom) * (1 - v / nice);
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${$('#vol-title').textContent} ${$('#vol-sub').textContent}, maximum ${max}`);
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
  for (let v = 0; v <= nice; v += step) {
    add('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: 'grid' });
    add('text', { x: left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, holdOnly ? fmtTime(v) : v);
  }
  const labelEvery = Math.ceil(data.length / 12);
  const maxIdx = data.findIndex((b) => val(b) === max);
  data.forEach((b, i) => {
    const cx = left + slot * i + slot / 2, x = cx - bw / 2, v = val(b);
    const label = unit === 'month' ? fmtDay(b.start, { month: 'short', year: '2-digit' }) : fmtDay(b.start);
    const hit = add('rect', { x: left + slot * i, y: top, width: slot, height: H - top - bottom, class: 'hit' });
    if (v) {
      const h = y(0) - y(v), r = Math.min(4, h);
      add('path', { class: 'bar', d: `M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z` });
    }
    if (i === maxIdx) add('text', { x: cx, y: y(v) - 6, 'text-anchor': 'middle', class: 'val' }, holdOnly ? fmtTime(v) : v);
    if ((data.length - 1 - i) % labelEvery === 0) add('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, label);
    const prefix = unit === 'week' ? `Semaine du ${label}` : label;
    tipOn(hit, `${prefix} : ${holdOnly ? fmtTime(v) : `${v} rép.`} · ${b.sessions} séance${b.sessions > 1 ? 's' : ''}`);
  });
  box.append(svg);
}

function renderByExercise(list, exercises) {
  const ul = $('#by-exercise');
  ul.innerHTML = '';
  const rows = byExercise(list).filter((r) => exercises[r.exercise]);
  const repRows = rows.filter((r) => !r.hold), holdRows = rows.filter((r) => r.hold);
  const max = Math.max(1, ...repRows.map((r) => r.reps));
  const maxH = Math.max(1, ...holdRows.map((r) => r.reps));
  for (const r of [...repRows, ...holdRows].slice(0, 10)) {
    const li = el('li');
    const track = el('span', 'track');
    const fill = el('span', 'fill');
    fill.style.width = `${(100 * r.reps) / (r.hold ? maxH : max)}%`;
    track.append(fill);
    li.append(el('span', null, exercises[r.exercise].name), track, el('b', null, r.hold ? fmtTime(r.reps) : r.reps));
    tipOn(li, `${exercises[r.exercise].name} : ${r.sessions} séance${r.sessions > 1 ? 's' : ''}, record ${r.hold ? fmtTime(r.best) : r.best}`);
    ul.append(li);
  }
  if (!ul.children.length) ul.append(el('li', 'empty', 'Rien sur cette période.'));
}

function renderMuscles(list, exercises, from, now) {
  const box = $('#dash-muscles');
  if (!box.firstChild) box.innerHTML = muscleMapSVG();
  const days = Math.round((startOfDay(now) - from) / DAY) + 1;
  const vol = muscleVolume(list, exercises, days, now);
  const max = Math.max(0, ...Object.values(vol));
  for (const part of box.querySelectorAll('[data-muscle]')) {
    const id = part.dataset.muscle, v = Math.round(vol[id] ?? 0);
    const lv = heatLevel(v, max);
    part.setAttribute('class', lv ? `h${lv}` : '');
    part.onpointerenter = (e) => showTip(e, `${MUSCLES[id]} : ${v ? `${v} rép. équivalentes` : 'pas travaillé'}`);
    part.onpointerleave = hideTip;
  }
}

function renderHeat(all, now) {
  const box = $('#dash-heat');
  box.innerHTML = '';
  const monday = startOfDay(now, -((now.getDay() + 6) % 7) - 7 * 51);
  const perDay = new Map();
  for (const h of all) perDay.set(dayKey(h.date), (perDay.get(dayKey(h.date)) ?? 0) + 1);
  const max = Math.max(0, ...perDay.values());
  for (let i = 0; i < 7 * 52; i++) {
    const date = startOfDay(monday, i);
    const cell = el('i');
    if (date > now) { cell.className = 'future'; box.append(cell); continue; }
    const n = perDay.get(dayKey(date)) ?? 0;
    const lv = heatLevel(n, max);
    if (lv) cell.className = `h${lv}`;
    tipOn(cell, `${fmtDay(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} : ${n} séance${n > 1 ? 's' : ''}`);
    box.append(cell);
  }
}

/** Courbe d'une mesure, avec la valeur la plus proche au survol. */
function lineChart(pts, unit) {
  const W = 260, H = 70, pad = 6;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark-svg');
  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const t0 = pts[0].date.getTime(), t1 = pts.at(-1).date.getTime();
  const x = (p) => (pts.length === 1 ? W - pad - 4 : pad + ((W - 2 * pad - 4) * (p.date.getTime() - t0)) / (t1 - t0 || 1));
  const y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
  const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  if (pts.length > 1) {
    add('path', { d: `${line} L${x(pts.at(-1)).toFixed(1)},${H} L${x(pts[0]).toFixed(1)},${H} Z`, class: 'spark-area' });
    add('path', { d: line, class: 'spark-line' });
  }
  add('circle', { cx: x(pts.at(-1)), cy: y(pts.at(-1).value), r: 4, class: 'spark-dot' });
  const hit = add('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a));
    const tip = $('#tooltip');
    tip.textContent = `${fmtDay(p.date, { day: 'numeric', month: 'short', year: 'numeric' })} : ${fmtNum(p.value)} ${unit}`;
    tip.style.left = `${r.left + (x(p) / W) * r.width}px`;
    tip.style.top = `${r.top + (y(p.value) / H) * r.height - 8}px`;
    tip.hidden = false;
  });
  hit.addEventListener('pointerleave', hideTip);
  return svg;
}

function renderBody(doc) {
  const box = $('#dash-body');
  box.innerHTML = '';
  const ms = live(doc.measurements);
  const p = doc.profile ?? {};
  const cur = valuesAt(ms);
  const fat = bodyFatNavy(p.sex, p.heightCm, cur);
  const b = bmi(cur.weight, p.heightCm);
  $('#body-sub').textContent = ms.length
    ? [`${ms.length} mesure${ms.length > 1 ? 's' : ''}`, fat ? `masse grasse estimée ${fmtNum(fat)} %` : null, b ? `IMC ${fmtNum(b)}` : null].filter(Boolean).join(' · ')
    : '';
  for (const m of MEASURES) {
    const pts = series(ms, m.id);
    if (!pts.length) continue;
    const card = el('div', 'spark');
    const head = el('div', 'spark-head');
    head.append(el('span', null, m.label), el('strong', null, `${fmtNum(pts.at(-1).value)} ${m.unit}`));
    const diff = pts.at(-1).value - pts[0].value;
    card.append(head, lineChart(pts, m.unit), el('small', 'muted', pts.length > 1 ? `${diff >= 0 ? '+' : '−'}${fmtNum(Math.abs(diff))} ${m.unit} depuis le ${fmtDay(pts[0].date)}` : `le ${fmtDay(pts[0].date)}`));
    box.append(card);
  }
  if (!box.children.length) box.append(el('p', 'empty', 'Aucune mensuration pour ce profil (onglet Corps de l\'app).'));
}

function renderCompare(now) {
  const t = $('#dash-compare');
  t.innerHTML = '';
  const head = el('tr');
  for (const [txt, cls] of [['Profil'], ['Répétitions', 'num'], ['Séances', 'num'], ['Jours actifs', 'num'], ['Série', 'num'], ['Dernière séance', 'num']]) head.append(el('th', cls, txt));
  t.append(head);
  const from = startOfDay(now, -29);
  for (const p of state.profiles) {
    const doc = state.docs.get(p.id);
    if (!doc) {
      const tr = el('tr');
      const td = el('td');
      const w = el('span', 'who');
      w.append(avatar(p), el('span', null, p.name));
      td.append(w);
      const info = el('td', 'muted', '🔒 Verrouillé : cliquer pour saisir le code');
      info.colSpan = 5;
      tr.append(td, info);
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => select(p));
      t.append(tr);
      continue;
    }
    const all = live(doc.history);
    const recent = all.filter((h) => new Date(h.date) >= from);
    const tr = el('tr', p.id === state.current ? 'me' : '');
    const who = el('td');
    const w = el('span', 'who');
    w.append(avatar({ ...p, ...(doc.profile ?? {}) }), el('span', null, doc.profile?.name ?? p.name));
    who.append(w);
    const last = all.at(-1);
    tr.append(who,
      el('td', 'num', recent.filter((h) => !isHold(h)).reduce((s, h) => s + h.reps, 0).toLocaleString('fr-FR')),
      el('td', 'num', String(recent.length)),
      el('td', 'num', String(activeDays(recent))),
      el('td', 'num', `${currentStreak(all, now)} j`),
      el('td', 'num', last ? fmtDay(last.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'));
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => { select(p); scrollTo({ top: 0, behavior: 'smooth' }); });
    t.append(tr);
  }
}

function renderHistory(all, exercises) {
  const t = $('#dash-history');
  t.innerHTML = '';
  const list = (state.exercise === 'all' ? all : all.filter((h) => h.exercise === state.exercise)).slice().reverse();
  $('#hist-sub').textContent = `${list.length} séance${list.length > 1 ? 's' : ''}`;
  const head = el('tr');
  for (const [txt, cls] of [['Date'], ['Exercice'], ['Résultat', 'num'], ['Durée', 'num'], ['Origine'], ['', 'num']]) head.append(el('th', cls, txt));
  t.append(head);
  for (const h of list.slice(0, state.histLimit)) {
    const tr = el('tr');
    const del = el('button', 'del', 'Supprimer');
    del.addEventListener('click', () => {
      if (!confirm('Supprimer cette séance ?')) return;
      saveDoc((doc) => { doc.history = doc.history.map((x) => (x.id === h.id ? tombstone(x) : x)); }, 'Séance supprimée');
    });
    const delTd = el('td', 'num');
    delTd.append(del);
    tr.append(
      el('td', null, new Date(h.date).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
      el('td', null, exercises[h.exercise]?.name ?? 'Exercice supprimé'),
      el('td', 'num', isHold(h) ? fmtTime(h.reps) : `${h.reps} rép.`),
      el('td', 'num', h.seconds ? fmtTime(h.seconds) : '—'),
      el('td', null, h.source === 'manual' ? 'saisie' : h.program ? `programme « ${h.program} »` : 'caméra'),
      delTd,
    );
    t.append(tr);
  }
  if (!list.length) { const tr = el('tr'); const td = el('td', 'empty', 'Aucune séance.'); td.colSpan = 6; tr.append(td); t.append(tr); }
  $('#hist-more').hidden = list.length <= state.histLimit;
}

function renderPrograms(doc, exercises) {
  const ul = $('#dash-programs');
  ul.innerHTML = '';
  for (const p of live(doc.programs)) {
    const li = el('li');
    const what = el('span', 'what');
    what.append(el('span', null, p.name), el('small', null, p.steps.map((s) => `${exercises[s.exercise]?.name ?? '?'} ${exercises[s.exercise]?.kind === 'hold' ? fmtTime(s.target) : `×${s.target}`}`).join(' · ')));
    const del = el('button', 'del', 'Supprimer');
    del.addEventListener('click', () => {
      if (!confirm(`Supprimer le programme « ${p.name} » ?`)) return;
      saveDoc((d) => { d.programs = d.programs.map((x) => (x.id === p.id ? tombstone(x) : x)); }, 'Programme supprimé');
    });
    li.append(what, del);
    ul.append(li);
  }
  if (!ul.children.length) ul.append(el('li', 'empty', 'Aucun programme.'));
}

function renderMeasures(doc) {
  const ul = $('#dash-measures');
  ul.innerHTML = '';
  for (const m of live(doc.measurements).slice().reverse().slice(0, 12)) {
    const li = el('li');
    const what = el('span', 'what');
    what.append(el('span', null, fmtDay(m.date, { day: 'numeric', month: 'long', year: 'numeric' })), el('small', null, MEASURES.filter((x) => m[x.id]).map((x) => `${x.label} ${fmtNum(m[x.id])}`).join(' · ')));
    const del = el('button', 'del', 'Supprimer');
    del.addEventListener('click', () => {
      if (!confirm('Supprimer cette mesure ?')) return;
      saveDoc((d) => { d.measurements = d.measurements.map((x) => (x.id === m.id ? tombstone(x) : x)); }, 'Mesure supprimée');
    });
    li.append(what, del);
    ul.append(li);
  }
  if (!ul.children.length) ul.append(el('li', 'empty', 'Aucune mesure.'));
}

/** Export CSV (séparateur « ; », lisible par Excel / Numbers en français). */
function exportCsv() {
  const doc = state.docs.get(state.current);
  const exercises = allExercises(live(doc.custom));
  const rows = [['date', 'exercice', 'type', 'repetitions_ou_secondes', 'duree_s', 'incompletes', 'origine', 'programme']];
  for (const h of live(doc.history)) {
    rows.push([new Date(h.date).toISOString(), exercises[h.exercise]?.name ?? h.exercise, isHold(h) ? 'maintien' : 'répétitions', h.reps, h.seconds ?? '', h.partials ?? 0, h.source ?? '', h.program ?? '']);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a');
  a.href = url;
  a.download = `repcounter-${(doc.profile?.name ?? 'profil').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${dayKey(new Date())}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Oublie les accès sur cet ordinateur (et prévient le serveur). */
async function lockAll() {
  await Promise.all(Object.entries(tokens).map(([id, t]) => api(`api/profiles/${id}/lock`, { method: 'POST' }, t).catch(() => {})));
  for (const id of Object.keys(tokens)) delete tokens[id];
  saveTokens();
  state.docs.clear();
  state.current = null;
  $('#dash-main').hidden = true;
  renderProfiles();
  empty('Profils verrouillés', 'Choisis un profil en haut et saisis son code pour voir ses statistiques.');
}

// ---------- Événements ----------
$('#dash-period').addEventListener('change', (e) => { state.period = e.target.value; render(); });
$('#dash-exercise').addEventListener('change', (e) => { state.exercise = e.target.value; render(); });
$('#dash-csv').addEventListener('click', exportCsv);
$('#hist-more').addEventListener('click', () => { state.histLimit += 100; render(); });
addEventListener('scroll', hideTip, { passive: true });
// Données à jour quand on revient sur l'onglet (séance faite entre-temps sur le téléphone).
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !state.current) return;
  try {
    await Promise.all([...state.docs.keys()].map((id) => loadDoc(id)));
    if (state.current && !state.docs.has(state.current)) return lockAll();
    render();
  } catch { /* hors ligne */ }
});

load();
