import { RepCounter } from './counter.js';
import { Voice } from './voice.js';
import { CATEGORIES, MUSCLES, PRESETS, allExercises, makeCustom } from './exercises.js';
import { lastDays, totals, currentStreak, bestSession, pace, heatLevel, startOfDay, dayKey, filterEx, isHold, muscleVolume } from './stats.js';
import { muscleMapSVG } from './musclemap.js';
import { Store } from './store.js';
import { renderBodyTab, openProfile, bindBody } from './bodyui.js';
import { ProgramRun } from './program.js';
import { renderPrograms, bindPrograms } from './programui.js';
import { bindProfiles, renderLogin, avatar } from './profileui.js';

const $ = (sel) => document.querySelector(sel);
const SETTINGS_KEY = 'repcounter.settings';
const COUNTDOWN_S = 5;

const voice = new Voice();
const params = new URLSearchParams(location.search);
const testVideo = params.get('video'); // ?video=chemin.mp4 : remplace la caméra (pour tester)

// ---------- Données locales ----------
const defaults = { exercise: 'pushup', mode: 'free', target: 20, duration: 60, facing: 'user', model: 'lite', voice: true, debug: false };
const settings = { ...defaults, ...readJSON(SETTINGS_KEY, {}) };
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
const store = new Store();
const loadHistory = () => store.history;
let exercises = allExercises(store.custom);
if (!exercises[settings.exercise]) settings.exercise = 'pushup';

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const fmtDay = (d, opts) => new Date(d).toLocaleDateString('fr-FR', opts);
const exName = (id) => exercises[id]?.name ?? 'Exercice supprimé';
const isHoldEx = (id) => exercises[id]?.kind === 'hold';
/** Valeur d'une séance : « 25 » répétitions, ou « 1:05 » pour un maintien. */
const fmtValue = (h) => (isHold(h) ? fmtTime(h.reps) : String(h.reps));

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  const u = document.createElementNS(ns, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((e) => e.classList.toggle('active', e.id === id));
}

function showError(msg) {
  const e = $('#error');
  e.textContent = msg;
  e.hidden = false;
  clearTimeout(showError.t);
  showError.t = setTimeout(() => { e.hidden = true; }, 6000);
}

// ---------- Onglet Séance ----------
let statsEx = 'all';

function renderAll() {
  exercises = allExercises(store.custom);
  const history = loadHistory();
  const now = new Date();

  $('#today').textContent = fmtDay(now, { weekday: 'long', day: 'numeric', month: 'long' });
  const streak = currentStreak(history, now);
  $('#streak').textContent = streak;
  $('#streak-chip').classList.toggle('hot', streak > 0);

  // Semaine du lundi au dimanche (toute séance compte, maintiens compris).
  const monday = startOfDay(now, -((now.getDay() + 6) % 7));
  const trained = new Map();
  for (const h of history) trained.set(dayKey(h.date), (trained.get(dayKey(h.date)) ?? 0) + 1);
  const week = $('#week');
  week.innerHTML = '';
  ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((letter, i) => {
    const date = startOfDay(monday, i);
    const n = trained.get(dayKey(date)) ?? 0;
    const day = el('div', 'day');
    day.classList.toggle('done', n > 0);
    day.classList.toggle('today', dayKey(date) === dayKey(now));
    day.title = n ? `${n} séance${n > 1 ? 's' : ''}` : '';
    day.append(el('span', null, letter), el('i', null, String(date.getDate())));
    week.append(day);
  });

  renderPrograms();
  renderExercisePicker(history);
  renderStats(history, now);
  renderCustomList();
  renderBodyTab(store);
  renderSyncStatus();
}

function renderExercisePicker(history) {
  const box = $('#exercise-groups');
  box.innerHTML = '';
  for (const [cat, label] of Object.entries(CATEGORIES)) {
    const list = Object.values(exercises).filter((e) => e.category === cat);
    if (!list.length) continue;
    box.append(el('h3', 'group-title', label));
    const grid = el('div', 'ex-grid');
    for (const ex of list) {
      const done = history.filter((h) => h.exercise === ex.id);
      const best = done.length ? done.reduce((a, b) => (b.reps > a.reps ? b : a)) : null;
      const label = el('label', 'exercise');
      const input = el('input');
      Object.assign(input, { type: 'radio', name: 'exercise', value: ex.id, checked: ex.id === settings.exercise });
      const card = el('span', 'ex-card');
      const ic = icon(ex.icon);
      ic.setAttribute('class', 'ex-icon');
      const text = el('span', 'ex-text');
      text.append(el('strong', null, ex.name), el('small', null, best ? `Record ${fmtValue(best)}` : ex.kind === 'hold' ? 'Maintien' : '—'));
      card.append(ic, text);
      label.append(input, card);
      grid.append(label);
    }
    box.append(grid);
  }
}

function bindSettings() {
  const radios = (name) => document.querySelectorAll(`input[name=${name}]`);
  for (const r of radios('mode')) r.checked = r.value === settings.mode;
  $('#facing').value = settings.facing;
  $('#model').value = settings.model;
  $('#voice').checked = settings.voice;
  $('#debug').checked = settings.debug;

  const refresh = () => {
    const ex = exercises[settings.exercise];
    $('#exercise-tip').textContent = `📱 ${ex.tip}`;
    const hold = ex.kind === 'hold';
    $('#target-value').textContent = hold ? fmtTime(settings.target) : settings.target;
    $('#target-row').querySelector('small').textContent = hold ? 'à tenir' : 'répétitions';
    $('#duration-value').textContent = fmtTime(settings.duration);
    $('#target-row').hidden = settings.mode !== 'reps';
    $('#duration-row').hidden = settings.mode !== 'time';
  };
  refresh();
  bindSettings.refresh = refresh;

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'exercise') settings.exercise = t.value;
    else if (t.name === 'mode') settings.mode = t.value;
    else if (t.id === 'facing' || t.id === 'model') settings[t.id] = t.value;
    else if (t.id === 'voice' || t.id === 'debug') settings[t.id] = t.checked;
    else return;
    saveSettings();
    refresh();
  });

  for (const btn of document.querySelectorAll('[data-step]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.step, delta = Number(btn.dataset.delta);
      const [min, max] = key === 'target' ? [5, 3600] : [15, 3600];
      settings[key] = Math.min(max, Math.max(min, settings[key] + delta));
      saveSettings();
      refresh();
    });
  }
}

// ---------- Onglet Stats ----------
function renderStats(history, now) {
  // Filtres : « Tout » + les exercices déjà pratiqués.
  const done = [...new Set(history.map((h) => h.exercise))].filter((id) => exercises[id]);
  if (statsEx !== 'all' && !done.includes(statsEx)) statsEx = 'all';
  const filter = $('#stats-filter');
  filter.innerHTML = '';
  for (const id of ['all', ...done]) {
    const b = el('button', id === statsEx ? 'on' : '', id === 'all' ? 'Tout' : exName(id));
    b.dataset.ex = id;
    filter.append(b);
  }

  const ex = statsEx;
  const hold = ex !== 'all' && isHoldEx(ex);
  const unit = (v) => (hold ? fmtTime(v) : String(v));
  const w = totals(history, ex, 7, now), prev = totals(history, ex, 7, now, 7), m = totals(history, ex, 30, now);
  document.querySelectorAll('.kpi small')[0].textContent = hold ? 'Temps · 7 jours' : 'Reps · 7 jours';
  document.querySelectorAll('.kpi small')[1].textContent = hold ? 'Temps · 30 jours' : 'Reps · 30 jours';
  $('#k-week').textContent = unit(w.reps);
  const delta = w.reps - prev.reps;
  const kd = $('#k-week-delta');
  kd.textContent = prev.reps || w.reps ? `${delta >= 0 ? '▲' : '▼'} ${unit(Math.abs(delta))} vs sem. passée` : '';
  kd.className = delta > 0 ? 'up' : '';
  $('#k-month').textContent = unit(m.reps);
  $('#k-month-sessions').textContent = `${m.sessions} séance${m.sessions > 1 ? 's' : ''}`;
  $('#k-streak').textContent = currentStreak(history, now, ex);
  const best = bestSession(history, ex);
  $('#k-best').textContent = best ? fmtValue(best) : '—';
  $('#k-best-when').textContent = best ? `${ex === 'all' ? exName(best.exercise).toLowerCase() + ' · ' : ''}${fmtDay(best.date, { day: 'numeric', month: 'short' })}` : '';

  $('#muscle-panel').hidden = ex !== 'all';
  if (ex === 'all') renderMuscles(history, now);
  $('#chart-title').textContent = hold ? 'Secondes par jour' : 'Répétitions par jour';
  renderDayChart(lastDays(history, 14, ex, now), hold);
  renderHeatmap(history, now);
  renderRecords(history);
  renderHistoryList(history, ex);
}

function renderMuscles(history, now) {
  const box = $('#muscle-map');
  if (!box.firstChild) {
    box.innerHTML = muscleMapSVG();
    for (const part of box.querySelectorAll('[data-muscle]')) {
      const show = (e) => showTip(e, part.dataset.tip ?? MUSCLES[part.dataset.muscle]);
      part.addEventListener('pointerenter', show);
      part.addEventListener('pointerdown', show);
      part.addEventListener('pointerleave', hideTip);
    }
  }
  const vol = muscleVolume(history, exercises, 7, now);
  const max = Math.max(0, ...Object.values(vol));
  for (const part of box.querySelectorAll('[data-muscle]')) {
    const id = part.dataset.muscle, v = Math.round(vol[id] ?? 0);
    const lv = heatLevel(v, max);
    part.setAttribute('class', lv ? `h${lv}` : '');
    part.dataset.tip = `${MUSCLES[id]} : ${v ? `${v} rép. équivalentes` : 'pas travaillé'}`;
  }

  // Classement des muscles les plus travaillés.
  const ranking = $('#muscle-ranking');
  ranking.innerHTML = '';
  const sorted = Object.entries(vol).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
  for (const [id, v] of sorted.slice(0, 6)) {
    const li = el('li');
    const track = el('span', 'track');
    const fill = el('span', 'fill');
    fill.style.width = `${(100 * v) / max}%`;
    track.append(fill);
    li.append(el('span', null, MUSCLES[id]), track, el('b', null, Math.round(v)));
    ranking.append(li);
  }
  const idle = Object.keys(MUSCLES).filter((id) => !(vol[id] >= 1));
  const p = $('#muscle-idle');
  p.innerHTML = '';
  if (!sorted.length) p.textContent = 'Aucune séance ces 7 derniers jours.';
  else if (idle.length) p.append('À travailler : ', el('strong', null, idle.map((id) => MUSCLES[id].toLowerCase()).join(', ')));
  else p.textContent = 'Tous les groupes musculaires ont été travaillés cette semaine 💪';
}

/** Barres : valeur par jour. Survol / toucher → infobulle. */
function renderDayChart(days, hold) {
  const box = $('#chart-days');
  const W = 320, H = 160, top = 18, bottom = 22, left = 28, n = days.length;
  const max = Math.max(...days.map((d) => d.reps));
  if (!max) { box.innerHTML = '<p class="empty">Rien sur cette période.</p>'; return; }
  const nice = max <= 10 ? 10 : Math.ceil(max / 10) * 10; // graduations entières
  const slot = (W - left) / n, bw = Math.min(14, slot - 4);
  const y = (v) => top + (H - top - bottom) * (1 - v / nice);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${hold ? 'Secondes' : 'Répétitions'} par jour, maximum ${max}`);
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
  for (const v of [0, nice / 2, nice]) {
    add('line', { x1: left, x2: W, y1: y(v), y2: y(v), class: 'grid' });
    add('text', { x: left - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'axis' }, v);
  }
  const maxIdx = days.findIndex((d) => d.reps === max);
  days.forEach((d, i) => {
    const cx = left + slot * i + slot / 2, x = cx - bw / 2, h = Math.max(0, y(0) - y(d.reps));
    if (d.reps) {
      const r = Math.min(4, h);
      // Bout arrondi (4 px) côté valeur, carré sur la ligne de base.
      add('path', { class: 'bar', d: `M${x},${y(0)} V${y(d.reps) + r} Q${x},${y(d.reps)} ${x + r},${y(d.reps)} H${x + bw - r} Q${x + bw},${y(d.reps)} ${x + bw},${y(d.reps) + r} V${y(0)} Z` });
    }
    if (i === maxIdx) add('text', { x: cx, y: y(d.reps) - 5, 'text-anchor': 'middle', class: 'val' }, hold ? fmtTime(d.reps) : d.reps);
    if (i % 2 === (n - 1) % 2) add('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, d.date.getDate());
    const hit = add('rect', { x: left + slot * i, y: 0, width: slot, height: H, class: 'hit' });
    const label = `${fmtDay(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} : ${hold ? fmtTime(d.reps) : `${d.reps} rép.`}`;
    hit.addEventListener('pointerenter', (e) => showTip(e, label));
    hit.addEventListener('pointerdown', (e) => showTip(e, label));
    hit.addEventListener('pointerleave', hideTip);
  });
  box.innerHTML = '';
  box.append(svg);
}

/** Calendrier de régularité : nombre de séances par jour (tous exercices). */
function renderHeatmap(history, now) {
  const box = $('#heatmap');
  box.innerHTML = '';
  const monday = startOfDay(now, -((now.getDay() + 6) % 7) - 7 * 11);
  const perDay = new Map();
  for (const h of history) perDay.set(dayKey(h.date), (perDay.get(dayKey(h.date)) ?? 0) + 1);
  const max = Math.max(0, ...perDay.values());
  for (let i = 0; i < 7 * 12; i++) {
    const date = startOfDay(monday, i);
    const cell = el('i');
    if (date > now) { cell.className = 'future'; box.append(cell); continue; }
    const n = perDay.get(dayKey(date)) ?? 0;
    const lv = heatLevel(n, max);
    if (lv) cell.className = `h${lv}`;
    const label = `${fmtDay(date, { weekday: 'short', day: 'numeric', month: 'short' })} : ${n} séance${n > 1 ? 's' : ''}`;
    cell.addEventListener('pointerenter', (e) => showTip(e, label));
    cell.addEventListener('pointerdown', (e) => showTip(e, label));
    cell.addEventListener('pointerleave', hideTip);
    box.append(cell);
  }
}

function renderRecords(history) {
  const rec = $('#records');
  rec.innerHTML = '';
  for (const id of [...new Set(history.map((h) => h.exercise))]) {
    if (!exercises[id]) continue;
    const list = history.filter((h) => h.exercise === id);
    const b = list.reduce((a, c) => (c.reps > a.reps ? c : a));
    const hold = isHold(b);
    const total = list.reduce((s, h) => s + h.reps, 0);
    const bestPace = hold ? 0 : Math.max(0, ...list.map((h) => pace(h.reps, h.seconds) ?? 0));
    const li = el('li');
    const what = el('span', 'what');
    what.append(el('span', null, exName(id)),
      el('small', null, hold ? `${fmtTime(total)} au total` : `${total} au total${bestPace ? ` · ${bestPace.toFixed(0)} reps/min max` : ''}`));
    li.append(icon(exercises[id].icon), what, el('strong', null, fmtValue(b)));
    rec.append(li);
  }
  if (!rec.children.length) rec.append(el('li', 'empty', 'Fais ta première séance pour voir tes records.'));
}

function renderHistoryList(history, ex) {
  const list = $('#history');
  const items = (ex === 'all' ? history : history.filter((h) => h.exercise === ex)).slice(-30).reverse();
  list.innerHTML = '';
  if (!items.length) list.append(el('li', 'empty', 'Aucune séance pour l\'instant.'));
  for (const h of items) {
    const li = el('li');
    const what = el('span', 'what');
    const p = isHold(h) ? null : pace(h.reps, h.seconds);
    const parts = [
      fmtDay(h.date, { weekday: 'short', day: 'numeric', month: 'short' }),
      h.source === 'manual' ? 'saisie manuelle' : new Date(h.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    ];
    if (h.source !== 'manual' && !isHold(h)) parts.push(fmtTime(h.seconds));
    if (p) parts.push(`${p.toFixed(0)}/min`);
    what.append(el('span', null, exName(h.exercise)), el('small', null, parts.join(' · ')));
    li.append(icon(exercises[h.exercise]?.icon ?? 'custom'), what, el('strong', null, fmtValue(h)));
    list.append(li);
  }
  $('#clear-history').hidden = !history.length;
}

function showTip(e, text) {
  const tip = $('#tooltip');
  const r = e.currentTarget.getBoundingClientRect();
  tip.textContent = text;
  tip.style.left = `${Math.min(innerWidth - 90, Math.max(90, r.left + r.width / 2))}px`;
  tip.style.top = `${r.top - 6}px`;
  tip.hidden = false;
  clearTimeout(showTip.t);
  if (e.type === 'pointerdown') showTip.t = setTimeout(hideTip, 1800);
}
function hideTip() { $('#tooltip').hidden = true; }

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  hideTip();
  scrollTo(0, 0);
  if (name === 'body') renderBodyTab(store);
}

// ---------- Fiches (saisie manuelle, création d'exercice) ----------
function openSheet(id) { $(id).hidden = false; }
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; }); }

function groupedOptions(select, selected) {
  select.innerHTML = '';
  for (const [cat, label] of Object.entries(CATEGORIES)) {
    const list = Object.values(exercises).filter((e) => e.category === cat);
    if (!list.length) continue;
    const g = el('optgroup');
    g.label = label;
    for (const ex of list) {
      const o = el('option', null, ex.name);
      o.value = ex.id;
      o.selected = ex.id === selected;
      g.append(o);
    }
    select.append(g);
  }
}

const manual = { value: 10 };
function refreshManual() {
  const hold = isHoldEx($('#manual-exercise').value);
  $('#manual-value').textContent = hold ? fmtTime(manual.value) : manual.value;
  $('#manual-unit').textContent = hold ? 'tenu' : 'répétitions';
}
function openManual() {
  groupedOptions($('#manual-exercise'), settings.exercise);
  manual.value = isHoldEx(settings.exercise) ? 30 : 10;
  $('#manual-date').value = dayKey(new Date());
  $('#manual-date').max = dayKey(new Date());
  refreshManual();
  openSheet('#sheet-manual');
}
function saveManual(e) {
  e.preventDefault();
  const id = $('#manual-exercise').value;
  const [y, m, d] = $('#manual-date').value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) date.setTime(today.getTime());
  store.addSession({ date: date.toISOString(), exercise: id, kind: exercises[id].kind, reps: manual.value, partials: 0, seconds: isHoldEx(id) ? manual.value : 0, source: 'manual' });
  closeSheets();
  renderAll();
  showError(`${exName(id)} : ${isHoldEx(id) ? fmtTime(manual.value) : `${manual.value} rép.`} enregistré ✔︎`);
}

const customMuscles = {}; // muscle → 'primary' | 'secondary'
function openCustom() {
  $('#custom-form').reset();
  for (const k of Object.keys(customMuscles)) delete customMuscles[k];
  const sel = $('#custom-preset');
  sel.innerHTML = '';
  for (const [key, p] of Object.entries(PRESETS)) {
    const o = el('option', null, p.label);
    o.value = key;
    sel.append(o);
  }
  const chips = $('#custom-muscles');
  chips.innerHTML = '';
  for (const [id, label] of Object.entries(MUSCLES)) {
    const b = el('button', null, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      customMuscles[id] = { undefined: 'primary', primary: 'secondary', secondary: undefined }[customMuscles[id]];
      if (!customMuscles[id]) delete customMuscles[id];
      b.className = customMuscles[id] ? `${customMuscles[id]}-m` : '';
    });
    chips.append(b);
  }
  openSheet('#sheet-custom');
}
function saveCustom(e) {
  e.preventDefault();
  const primary = Object.keys(customMuscles).filter((m) => customMuscles[m] === 'primary');
  if (!primary.length) { showError('Choisis au moins un muscle principal.'); return; }
  const def = { name: $('#custom-name').value, preset: $('#custom-preset').value, primary, secondary: Object.keys(customMuscles).filter((m) => customMuscles[m] === 'secondary') };
  const ex = makeCustom(def);
  store.addCustom({ ...def, id: ex.id });
  settings.exercise = ex.id;
  saveSettings();
  closeSheets();
  renderAll();
  bindSettings.refresh();
  showError(`« ${ex.name} » ajouté à tes exercices ✔︎`);
}

function renderCustomList() {
  const list = $('#custom-list');
  list.innerHTML = '';
  for (const def of store.custom) {
    const ex = exercises[def.id];
    if (!ex) continue;
    const li = el('li');
    const what = el('span', 'what');
    what.append(el('span', null, ex.name), el('small', null, `${PRESETS[ex.preset]?.label ?? ''} · ${ex.muscles.primary.map((m) => MUSCLES[m]).join(', ')}`));
    const del = el('button', 'del');
    del.setAttribute('aria-label', `Supprimer ${ex.name}`);
    del.append(icon('trash'));
    del.addEventListener('click', () => {
      if (!confirm(`Supprimer « ${ex.name} » ? Les séances déjà faites restent dans l'historique.`)) return;
      store.deleteCustom(def.id);
      if (settings.exercise === def.id) { settings.exercise = 'pushup'; saveSettings(); }
      renderAll();
      bindSettings.refresh();
    });
    li.append(icon('custom'), what, del);
    list.append(li);
  }
  if (!list.children.length) list.append(el('li', 'empty', 'Aucun exercice personnalisé pour l\'instant.'));
}

// ---------- Profil et synchronisation ----------
function renderSyncStatus() {
  const p = store.profile;
  $('#profile-name').textContent = p.name || store.user?.name || 'Mon profil';
  const details = [p.sex === 'f' ? 'Femme' : p.sex === 'm' ? 'Homme' : null, p.heightCm ? `${p.heightCm} cm` : null, p.birthYear ? `${new Date().getFullYear() - p.birthYear} ans` : null].filter(Boolean);
  $('#profile-details').textContent = details.length ? details.join(' · ') : 'Touche pour compléter (utile pour les mensurations)';
  const st = $('#sync-status');
  const when = store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null;
  st.className = `sync ${store.status}`;
  st.textContent = {
    local: 'Données sur ce téléphone uniquement',
    syncing: 'Synchronisation…',
    synced: `Synchronisé avec le serveur${when ? ` à ${when}` : ''} ✓`,
    offline: 'Hors ligne : synchronisation au retour du réseau',
  }[store.status];
  const me = { name: $('#profile-name').textContent, avatar: p.avatar };
  $('#avatar').replaceWith(Object.assign(avatar(me), { id: 'avatar' }));
  $('#who-avatar').replaceWith(Object.assign(avatar(me, 'sm'), { id: 'who-avatar' }));
  $('#who-btn').hidden = !(store.server && store.profileId);
  $('#dash-link').hidden = !store.server;
}

// ---------- Sauvegarde ----------
function exportData() {
  const data = { ...store.exportBackup(), settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `repcounter-${dayKey(new Date())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'repcounter' || !Array.isArray(data.history)) throw new Error('fichier non reconnu');
    const valid = (h) => h && typeof h.exercise === 'string' && Number.isFinite(h.reps) && !Number.isNaN(new Date(h.date).getTime());
    const validM = (m) => m && !Number.isNaN(new Date(m.date).getTime());
    const added = store.importBackup({
      profile: data.profile,
      history: data.history.filter(valid),
      measurements: (Array.isArray(data.measurements) ? data.measurements : []).filter(validM),
      custom: (Array.isArray(data.custom) ? data.custom : []).filter((c) => c?.id && c?.name),
    });
    renderAll();
    showError(`Import terminé : ${added.length} séance${added.length > 1 ? 's' : ''} ajoutée${added.length > 1 ? 's' : ''} ✔︎`);
  } catch (err) {
    showError(`Import impossible : ${err.message}`);
  }
}

// ---------- Détection de pose (MediaPipe, chargé à la demande) ----------
let landmarker = null;
let landmarkerModel = null;
let mp = null;

async function getLandmarker(model) {
  if (landmarker && landmarkerModel === model) return landmarker;
  mp ??= await import('../vendor/vision_bundle.mjs');
  const fileset = await mp.FilesetResolver.forVisionTasks(new URL('../vendor/wasm', import.meta.url).href);
  const create = (delegate) => mp.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL(`../vendor/pose_landmarker_${model}.task`, import.meta.url).href, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    // Seuils plus bas que le défaut (0,5) : en pompe de face, le corps est en partie caché et le
    // suivi décroche trop vite. Le compteur filtre ensuite lui-même les points peu visibles.
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
  });
  landmarker?.close();
  try {
    landmarker = await create('GPU');
  } catch (err) {
    console.warn('GPU indisponible, passage au CPU', err);
    landmarker = await create('CPU');
  }
  landmarkerModel = model;
  return landmarker;
}

// ---------- Séance ----------
const video = $('#video');
const canvas = $('#overlay');
const ctx = canvas.getContext('2d');
let session = null;

async function startCamera() {
  if (testVideo) {
    video.srcObject = null;
    video.src = testVideo;
    video.loop = true;
    await video.play();
    return null;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext
      ? 'Ce navigateur ne donne pas accès à la caméra.'
      : 'La caméra exige une connexion HTTPS (ou localhost). Voir le README pour l\'auto-hébergement.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: settings.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

async function requestWakeLock() {
  try { return await navigator.wakeLock?.request('screen'); } catch { return null; }
}

const RING = 2 * Math.PI * 54;
function setRing(fraction) {
  $('#ring-fg').style.strokeDashoffset = String(RING * (1 - Math.min(1, Math.max(0, fraction))));
}

function setPoseState(ok) {
  if (session && session.poseOk === ok) return;
  if (session) session.poseOk = ok;
  const chip = $('#pose-state');
  chip.className = `pose-chip ${ok ? 'ok' : 'wait'}`;
  chip.textContent = ok ? (session?.hold ? 'Position tenue ✓' : 'En position ✓') : 'Mise en place';
}

/** Objectif de l'étape en cours : programme, ou mode « Objectif » d'un exercice seul. */
const targetOf = () => (session.run ? session.run.step?.target ?? null : settings.mode === 'reps' ? settings.target : null);
const timed = () => !session.run && settings.mode === 'time';
const fmtStep = (s) => (isHoldEx(s.exercise) ? fmtTime(s.target) : `× ${s.target}`);
const spokenStep = (s) => `${exName(s.exercise)}, ${s.target} ${isHoldEx(s.exercise) ? 'secondes' : 'répétitions'}`;
let lastProgram = null; // pour « Recommencer »

function setExercise(ex) {
  session.ex = ex;
  session.hold = ex.kind === 'hold';
  session.counter = new RepCounter(ex);
}

/** Affiche l'exercice en cours (nom, compteur, objectif, étape du programme). */
function showStep() {
  const { ex, hold, run } = session;
  $('#hud-exercise').textContent = ex.name;
  $('#count').textContent = hold ? '0:00' : '0';
  $('#count').className = hold ? 'time' : '';
  const target = targetOf();
  $('#count-target').textContent = target ? `sur ${hold ? fmtTime(target) : target}` : hold ? 'tenu' : '';
  $('#ring').toggleAttribute('hidden', !target && !timed()); // SVG : pas de propriété .hidden
  setRing(timed() ? 1 : 0);
  $('#hud-step').hidden = !run;
  $('#skip').hidden = !run;
  $('#next-up').hidden = !run;
  if (run) {
    $('#hud-step').textContent = `Étape ${run.index + 1}/${run.program.steps.length}`;
    const n = run.nextStep;
    $('#next-up').textContent = n ? `Ensuite : ${exName(n.exercise)} ${fmtStep(n)}` : 'Dernier exercice 💪';
  }
  $('#hint').textContent = '';
  session.lastHint = '';
  session.poseOk = null;
  setPoseState(false);
}

async function startWorkout(program = null) {
  if (!program?.steps) program = null; // appelé depuis un clic : l'argument est l'événement
  voice.enabled = settings.voice;
  voice.unlock(); // doit se faire pendant le clic (iOS)

  const run = program ? new ProgramRun(program) : null;
  lastProgram = program;
  showScreen('workout');
  $('#loading').hidden = false;
  $('#loading-text').textContent = 'Démarrage de la caméra…';
  $('#rest').hidden = true;
  $('#workout').classList.remove('resting');
  $('#debug-info').hidden = !settings.debug;
  $('#workout').classList.toggle('mirrored', settings.facing === 'user' && !testVideo);

  session = {
    run,
    stream: null,
    wakeLock: null,
    raf: 0,
    lastVideoTime: -1,
    countdownEnd: 0,
    startedAt: 0,      // début de la séance (après le premier compte à rebours)
    stepStartedAt: 0,  // début de l'exercice en cours
    restEnd: 0,
    state: 'loading',  // loading → countdown → active → (rest → countdown → active …) → done
    lastSpokenHintAt: 0,
    lastHint: '',
    poseOk: null,
    announced: new Set(),
    diag: settings.debug ? { frames: [], startedAt: Date.now() } : null,
  };
  setExercise(exercises[run ? run.step.exercise : settings.exercise]);
  showStep();
  $('#hud-timer').textContent = timed() ? fmtTime(settings.duration) : '0:00';

  try {
    session.stream = await startCamera();
    $('#loading-text').textContent = 'Chargement du modèle de détection…';
    await getLandmarker(settings.model);
  } catch (err) {
    console.error(err);
    stopMedia();
    showScreen('app');
    showError(err?.name === 'NotAllowedError'
      ? 'Accès à la caméra refusé. Autorise-le dans les réglages du navigateur.'
      : `Impossible de démarrer : ${err.message ?? err}`);
    session = null;
    return;
  }

  session.videoW = video.videoWidth;
  session.videoH = video.videoHeight;
  session.wakeLock = await requestWakeLock();
  $('#loading').hidden = true;
  session.state = 'countdown';
  session.countdownEnd = performance.now() + COUNTDOWN_S * 1000;
  voice.say(run
    ? `Programme ${program.name}. Premier exercice : ${spokenStep(run.step)}. ${session.ex.setupHint}.`
    : `${session.ex.setupHint}.`, { interrupt: true });
  loop();
}

function draw(landmarks) {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const du = new mp.DrawingUtils(ctx);
  const scale = canvas.width / 640;
  du.drawConnectors(landmarks, mp.PoseLandmarker.POSE_CONNECTIONS, { color: 'rgba(255,255,255,0.7)', lineWidth: 4 * scale });
  du.drawLandmarks(landmarks, { color: '#a3e635', fillColor: '#a3e635', radius: 3 * scale, lineWidth: 1 });
}

function setHint(text) {
  if (text === session.lastHint) return;
  session.lastHint = text ?? '';
  $('#hint').textContent = session.lastHint;
}

function bump(cls) {
  const e = $('#count');
  e.classList.remove('bump', 'miss');
  void e.offsetWidth; // relance l'animation
  e.classList.add(cls);
  setTimeout(() => e.classList.remove(cls), 250);
}

function loop() {
  if (!session || session.state === 'done') return;
  session.raf = requestAnimationFrame(loop);
  const now = performance.now();

  // Détection uniquement quand une nouvelle image vidéo est disponible.
  let landmarks = null;
  let fresh = false;
  if (video.readyState >= 2 && video.currentTime !== session.lastVideoTime) {
    session.lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, now);
    landmarks = result.landmarks?.[0] ?? null;
    fresh = true;
    draw(landmarks);
    if (session.diag && session.diag.frames.length < 30 * 180) {
      session.diag.frames.push({
        t: Math.round(now),
        s: session.state,
        lm: landmarks ? landmarks.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4), +(p.z ?? 0).toFixed(4), +(p.visibility ?? 0).toFixed(3)]) : null,
      });
    }
  }

  if (session.startedAt) updateTimer((now - session.startedAt) / 1000);
  if (!session || session.state === 'done') return;

  if (session.state === 'rest') {
    const left = Math.ceil((session.restEnd - now) / 1000);
    $('#rest-time').textContent = fmtTime(Math.max(0, left));
    if (left === 10 && !session.announced.has('rest10')) {
      session.announced.add('rest10');
      voice.say('10 secondes');
    }
    if (left <= 0) endRest(now);
    return;
  }

  if (session.state === 'countdown') {
    const left = Math.ceil((session.countdownEnd - now) / 1000);
    const cd = $('#countdown');
    if (left > 0) {
      cd.hidden = false;
      cd.innerHTML = `${left}<small></small>`;
      cd.querySelector('small').textContent = session.run ? `${session.ex.name} ${fmtStep(session.run.step)} · ${session.ex.setupHint}` : session.ex.setupHint;
      if (left <= 3 && !session.announced.has(`cd${left}`)) {
        session.announced.add(`cd${left}`);
        voice.say(String(left), { interrupt: true });
      }
      return;
    }
    cd.hidden = true;
    voice.say('Go !', { interrupt: true });
    voice.beep(1046, 180);
    session.state = 'active';
    if (!session.startedAt) session.startedAt = now;
    session.stepStartedAt = now;
    return;
  }

  if (session.state === 'active' && fresh) handleResult(session.counter.update(landmarks, now, video.videoWidth / video.videoHeight), now);
}

function goalReached() {
  if (session.run) { voice.beep(880, 120); stepDone(performance.now()); return; }
  voice.say('Objectif atteint, bravo !');
  finishWorkout('Objectif atteint !');
}

function handleResult(r, now) {
  const lastFrame = session.diag?.frames.at(-1);
  if (lastFrame) lastFrame.r = { a: r.angle && +r.angle.toFixed(1), raw: r.raw && +r.raw.toFixed(1), ph: r.phase, v: r.valid, po: r.posture, sd: r.side, sc: r.score && +r.score.toFixed(2), ev: r.event, reps: r.reps };
  setPoseState(r.valid);
  const target = targetOf();

  if (session.hold) {
    if (r.event === 'tick') {
      $('#count').textContent = fmtTime(r.reps);
      if (target) setRing(r.reps / target);
      if (r.reps % 10 === 0 && !(target && r.reps >= target)) voice.say(r.reps < 60 ? `${r.reps} secondes` : fmtTime(r.reps).replace(':', ' minute ').replace(' minute 00', ' minute'));
      if (target && r.reps >= target) { goalReached(); return; }
    }
  } else if (r.event === 'rep') {
    $('#count').textContent = r.reps;
    if (target) setRing(r.reps / target);
    bump('bump');
    voice.say(String(r.reps));
    if (target && r.reps >= target) { goalReached(); return; }
  } else if (r.event === 'partial') {
    bump('miss');
    voice.beep(330, 160);
  }

  setHint(r.hint);
  // Répète une consigne vocalement si elle dure, sans saturer (toutes les 6 s max).
  if (r.hint && now - session.lastSpokenHintAt > 6000 && (r.event === 'partial' || !r.valid)) {
    session.lastSpokenHintAt = now;
    voice.say(r.hint, { interrupt: true });
  }

  if (settings.debug) {
    const d = session.ex.detector;
    const unit = d.type === 'angle' ? '°' : d.type === 'hold' ? ' s' : ' %';
    $('#debug-info').textContent =
      `${d.type} ${r.angle?.toFixed(0) ?? r.raw?.toFixed?.(0) ?? '—'}${unit} · ${r.phase} · côté ${r.side ?? '—'} (${r.score?.toFixed(2) ?? '—'}) · posture ${r.posture === null ? '—' : r.posture ? 'OK' : 'NON'} · incomplètes ${session.counter.partials}`;
  }
}

/** Enregistre l'exercice en cours du programme (même incomplet) et passe à l'étape suivante. */
function recordStep(now) {
  const { counter, run, ex } = session;
  const seconds = session.state === 'active' && session.stepStartedAt ? (now - session.stepStartedAt) / 1000 : 0;
  run.complete({ done: counter.reps, partials: counter.partials, seconds });
  if (counter.reps > 0) {
    store.addSession({ date: new Date().toISOString(), exercise: ex.id, kind: ex.kind, reps: counter.reps, partials: counter.partials, seconds: Math.round(seconds), source: 'camera', program: run.program.name });
  }
}

function stepDone(now) {
  recordStep(now);
  const { run } = session;
  if (run.finished) {
    voice.say('Programme terminé, bravo !', { interrupt: true });
    finishWorkout('Programme terminé !');
    return;
  }
  setExercise(exercises[run.step.exercise]);
  if (run.program.rest > 0) {
    session.state = 'rest';
    session.restEnd = now + run.program.rest * 1000;
    session.announced.delete('rest10');
    $('#rest-time').textContent = fmtTime(run.program.rest);
    $('#rest-next').textContent = `Prochain : ${exName(run.step.exercise)} ${fmtStep(run.step)}`;
    $('#rest').hidden = false;
    $('#workout').classList.add('resting');
    voice.say(`Repos. Prochain exercice : ${spokenStep(run.step)}.`, { interrupt: true });
  } else {
    beginStepCountdown(now);
  }
}

function endRest(now) {
  $('#rest').hidden = true;
  $('#workout').classList.remove('resting');
  beginStepCountdown(now);
}

/** Court compte à rebours (3 s) avant chaque exercice suivant du programme. */
function beginStepCountdown(now) {
  showStep();
  for (const k of ['cd1', 'cd2', 'cd3']) session.announced.delete(k);
  session.state = 'countdown';
  session.countdownEnd = now + 3000;
  if (!session.run.program.rest) voice.say(spokenStep(session.run.step), { interrupt: true });
}

function updateTimer(elapsed) {
  if (timed()) {
    const left = settings.duration - elapsed;
    $('#hud-timer').textContent = fmtTime(Math.ceil(left));
    setRing(left / settings.duration);
    for (const [at, msg] of [[30, '30 secondes'], [10, '10 secondes']]) {
      if (settings.duration > at + 5 && left <= at && !session.announced.has(`t${at}`)) {
        session.announced.add(`t${at}`);
        voice.say(msg, { interrupt: true });
      }
    }
    if (left <= 0) {
      const c = session.counter.reps;
      voice.say(session.hold ? `Temps écoulé. ${c} secondes tenues.` : `Temps écoulé. ${c} répétitions.`, { interrupt: true });
      finishWorkout('Temps écoulé !');
    }
  } else {
    $('#hud-timer').textContent = fmtTime(elapsed);
  }
}

function stopMedia() {
  if (!session) return;
  cancelAnimationFrame(session.raf);
  session.stream?.getTracks().forEach((t) => t.stop());
  session.wakeLock?.release?.().catch(() => {});
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
}

function finishWorkout(title = 'Bravo !') {
  if (!session || session.state === 'done') return;
  const now = performance.now();
  if (session.run) return finishProgram(title, now);
  const wasActive = session.state === 'active';
  const seconds = wasActive ? (now - session.startedAt) / 1000 : 0;
  const { reps, partials } = session.counter;
  const { ex, hold } = session;
  session.state = 'done';
  stopMedia();
  if (session.diag?.frames.length) sendDiagnostic(session);
  $('#countdown').hidden = true;
  $('#sum-steps').hidden = true;

  const previous = store.history.filter((h) => h.exercise === ex.id);
  const prevBest = previous.length ? previous.reduce((a, b) => (b.reps > a.reps ? b : a)) : null;
  if (wasActive && reps > 0) {
    store.addSession({ date: new Date().toISOString(), exercise: ex.id, kind: ex.kind, reps, partials, seconds: Math.round(seconds), source: 'camera' });
  }

  const v = (n) => (hold ? fmtTime(n) : String(n));
  const isRecord = reps > 0 && previous.length > 0 && reps > prevBest.reps;
  const last = previous.at(-1);
  $('#summary-exercise').textContent = ex.name;
  $('#summary-title').textContent = reps === 0 ? 'Séance terminée' : isRecord ? 'Record battu !' : title;
  $('#sum-record').hidden = !isRecord;
  $('#sum-reps').textContent = v(reps);
  $('#sum-reps').nextElementSibling.textContent = hold ? 'tenu' : 'répétitions';
  $('#sum-time').textContent = fmtTime(seconds);
  const p = hold ? null : pace(reps, seconds);
  $('#sum-pace').textContent = p ? p.toFixed(0) : '—';
  $('#sum-partials').textContent = partials;
  const diff = last ? reps - last.reps : 0;
  $('#sum-compare').textContent = reps === 0
    ? (hold ? 'Position non détectée. Vérifie le placement du téléphone.' : 'Aucune répétition détectée. Vérifie le placement du téléphone.')
    : !last ? 'Première séance enregistrée 🎉'
    : `${diff >= 0 ? '+' : '−'}${v(Math.abs(diff))} par rapport à la dernière fois (${v(last.reps)}) · record ${v(Math.max(prevBest.reps, reps))}`;
  session = null;
  renderAll();
  showScreen('summary');
}

/** Fin d'un programme (terminé ou arrêté) : bilan étape par étape. */
function finishProgram(title, now) {
  const { run } = session;
  if (!run.finished && session.state === 'active' && session.counter.reps > 0) recordStep(now);
  const seconds = session.startedAt ? (now - session.startedAt) / 1000 : 0;
  session.state = 'done';
  stopMedia();
  if (session.diag?.frames.length) sendDiagnostic(session);
  $('#countdown').hidden = true;
  $('#rest').hidden = true;
  $('#workout').classList.remove('resting');

  const rep = run.report(exercises);
  const all = rep.completed === rep.total;
  $('#summary-exercise').textContent = run.program.name;
  $('#summary-title').textContent = all ? title : 'Programme arrêté';
  $('#sum-record').hidden = true;
  $('#sum-reps').textContent = rep.reps;
  $('#sum-reps').nextElementSibling.textContent = 'répétitions au total';
  $('#sum-time').textContent = fmtTime(seconds);
  const p = pace(rep.reps, seconds);
  $('#sum-pace').textContent = p ? p.toFixed(0) : '—';
  $('#sum-partials').textContent = run.results.reduce((s, r) => s + r.partials, 0);
  $('#sum-compare').textContent = `${rep.completed}/${rep.total} exercice${rep.total > 1 ? 's' : ''} réussi${rep.total > 1 ? 's' : ''}`;

  const list = $('#sum-steps');
  list.innerHTML = '';
  run.program.steps.forEach((step, i) => {
    const r = run.results[i];
    const li = el('li');
    const what = el('span', 'what');
    const hold = isHoldEx(step.exercise);
    const v = (n) => (hold ? fmtTime(n) : String(n));
    what.append(el('span', null, exName(step.exercise)), el('small', null, r ? (r.seconds ? `${fmtTime(r.seconds)}` : 'passé') : 'non fait'));
    const score = el('strong', r && !r.skipped ? 'ok' : 'ko', r ? `${v(r.done)}/${v(step.target)}${r.skipped ? '' : ' ✓'}` : `${v(0)}/${v(step.target)}`);
    li.append(icon(exercises[step.exercise]?.icon ?? 'custom'), what, score);
    list.append(li);
  });
  list.hidden = false;
  session = null;
  renderAll();
  showScreen('summary');
}

// ---------- Diagnostic (option « Infos de détection ») ----------
async function sendDiagnostic(sess) {
  const ex = sess.ex;
  const payload = {
    version: 2,
    date: new Date(sess.diag.startedAt).toISOString(),
    userAgent: navigator.userAgent,
    exercise: ex.id,
    exerciseDef: ex.custom ? ex : undefined,
    detector: ex.detector,
    settings: { ...settings },
    video: { width: video.videoWidth || sess.videoW, height: video.videoHeight || sess.videoH },
    screen: { width: innerWidth, height: innerHeight, orientation: screen.orientation?.type ?? null },
    result: { reps: sess.counter.reps, partials: sess.counter.partials },
    frames: sess.diag.frames,
  };
  try {
    const res = await fetch('api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) showError('Diagnostic envoyé ✔︎');
    else if (res.status !== 404) showError(`Diagnostic non envoyé (HTTP ${res.status})`);
  } catch (err) {
    console.warn('Diagnostic non envoyé', err);
  }
}

// ---------- Démarrage ----------
bindBody(store, { showError, openSheet, closeSheets, onChange: () => renderAll() });
bindPrograms({ store, exercises: () => exercises, openSheet, closeSheets, showError, onChange: () => renderAll(), onLaunch: (p) => startWorkout(p) });
renderAll();
bindSettings();
bindProfiles({ store, showError, openSheet, closeSheets, onChange: () => renderAll(), onPicked: () => { showScreen('app'); showTab('train'); renderAll(); } });
store.addEventListener('choose', () => { if (session) return; closeSheets(); renderLogin(); showScreen('login'); });
store.addEventListener('locked', () => {
  if (session) return;
  closeSheets();
  renderLogin();
  showScreen('login');
  showError('Code modifié ou accès expiré : saisis ton code à nouveau.');
});
store.addEventListener('profiles', () => { if ($('#login').classList.contains('active')) renderLogin(); });
// Profil pas encore choisi sur ce téléphone : la page de choix s'affiche tout de suite (liste en cache).
if (!localStorage.getItem('repcounter.activeProfile') && store.profiles.length) { renderLogin(); showScreen('login'); }
$('#who-btn').addEventListener('click', () => store.signOut());
store.addEventListener('status', renderSyncStatus);
store.addEventListener('change', () => { if (!session) renderAll(); });
store.init();
addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden && !session) store.sync(); });
$('#profile-card').addEventListener('click', () => { openProfile(store); refreshProfilePhoto(); });

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});
$('#stats-filter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-ex]');
  if (!b) return;
  statsEx = b.dataset.ex;
  renderStats(loadHistory(), new Date());
});
addEventListener('scroll', hideTip, { passive: true });

$('#start').addEventListener('click', () => startWorkout());
$('#stop').addEventListener('click', () => { voice.stop(); finishWorkout(); });
$('#stop-x').addEventListener('click', () => { voice.stop(); finishWorkout(); });
$('#back').addEventListener('click', () => showScreen('app'));
$('#again').addEventListener('click', () => startWorkout(lastProgram));
$('#skip').addEventListener('click', () => {
  if (session?.run && (session.state === 'active' || session.state === 'countdown')) { $('#countdown').hidden = true; stepDone(performance.now()); }
});
$('#rest-skip').addEventListener('click', () => { if (session?.state === 'rest') endRest(performance.now()); });
$('#clear-history').addEventListener('click', () => {
  if (confirm('Effacer tout l\'historique ? Pense à l\'exporter avant si tu veux le garder.')) {
    store.clearHistory();
    renderAll();
  }
});

$('#open-manual').addEventListener('click', openManual);
$('#manual-exercise').addEventListener('change', () => { manual.value = isHoldEx($('#manual-exercise').value) ? 30 : 10; refreshManual(); });
for (const b of document.querySelectorAll('[data-manual-step]')) {
  b.addEventListener('click', () => {
    const step = (isHoldEx($('#manual-exercise').value) ? 5 : 1) * Number(b.dataset.manualStep);
    manual.value = Math.min(3600, Math.max(1, manual.value + step));
    refreshManual();
  });
}
$('#manual-form').addEventListener('submit', saveManual);
$('#open-custom').addEventListener('click', openCustom);
$('#custom-form').addEventListener('submit', saveCustom);
for (const s of document.querySelectorAll('.sheet')) {
  s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-close]')) closeSheets(); });
}
$('#export').addEventListener('click', exportData);
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ''; });

// Si l'app passe en arrière-plan pendant une séance, on la termine proprement (iOS coupe la caméra).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && session.state !== 'loading') finishWorkout();
});

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker non enregistré', err));
}
