import { RepCounter } from './counter.js';
import { Voice } from './voice.js';
import { CATEGORIES, MUSCLES, PRESETS, allExercises, makeCustom } from './exercises.js';
import { lastDays, totals, currentStreak, bestSession, pace, heatLevel, startOfDay, dayKey, filterEx, isHold, muscleVolume } from './stats.js';
import { muscleMapSVG } from './musclemap.js';

const $ = (sel) => document.querySelector(sel);
const SETTINGS_KEY = 'repcounter.settings';
const HISTORY_KEY = 'repcounter.history';
const CUSTOM_KEY = 'repcounter.custom';
const COUNTDOWN_S = 5;

const voice = new Voice();
const params = new URLSearchParams(location.search);
const testVideo = params.get('video'); // ?video=chemin.mp4 : remplace la caméra (pour tester)

// ---------- Données locales ----------
const defaults = { exercise: 'pushup', mode: 'free', target: 20, duration: 60, facing: 'user', model: 'lite', voice: true, debug: false };
const settings = { ...defaults, ...readJSON(SETTINGS_KEY, {}) };
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
const loadHistory = () => readJSON(HISTORY_KEY, []);
const saveHistory = (h) => localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-2000)));
const loadCustom = () => readJSON(CUSTOM_KEY, []);
let exercises = allExercises(loadCustom());
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
  exercises = allExercises(loadCustom());
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

  renderExercisePicker(history);
  renderStats(history, now);
  renderCustomList();
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
  const history = loadHistory();
  history.push({ date: date.toISOString(), exercise: id, kind: exercises[id].kind, reps: manual.value, partials: 0, seconds: isHoldEx(id) ? manual.value : 0, source: 'manual' });
  history.sort((a, b) => new Date(a.date) - new Date(b.date));
  saveHistory(history);
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
  const list = loadCustom();
  list.push({ ...def, id: ex.id });
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
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
  for (const def of loadCustom()) {
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
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(loadCustom().filter((d) => d.id !== def.id)));
      if (settings.exercise === def.id) { settings.exercise = 'pushup'; saveSettings(); }
      renderAll();
      bindSettings.refresh();
    });
    li.append(icon('custom'), what, del);
    list.append(li);
  }
  if (!list.children.length) list.append(el('li', 'empty', 'Aucun exercice personnalisé pour l\'instant.'));
}

// ---------- Sauvegarde ----------
function exportData() {
  const data = { app: 'repcounter', version: 1, exportedAt: new Date().toISOString(), history: loadHistory(), custom: loadCustom(), settings };
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
    const incoming = data.history.filter(valid);
    // Fusion : on ajoute les séances absentes (même date + même exercice = doublon).
    const history = loadHistory();
    const seen = new Set(history.map((h) => `${h.date}|${h.exercise}`));
    const added = incoming.filter((h) => !seen.has(`${h.date}|${h.exercise}`));
    history.push(...added);
    history.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveHistory(history);
    const custom = loadCustom();
    const ids = new Set(custom.map((c) => c.id));
    for (const c of Array.isArray(data.custom) ? data.custom : []) if (c?.id && c?.name && !ids.has(c.id)) custom.push(c);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
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

async function startWorkout() {
  voice.enabled = settings.voice;
  voice.unlock(); // doit se faire pendant le clic (iOS)

  const ex = exercises[settings.exercise];
  const hold = ex.kind === 'hold';
  showScreen('workout');
  $('#loading').hidden = false;
  $('#loading-text').textContent = 'Démarrage de la caméra…';
  $('#hud-exercise').textContent = ex.name;
  $('#count').textContent = hold ? '0:00' : '0';
  $('#count').className = hold ? 'time' : '';
  $('#hint').textContent = '';
  $('#debug-info').hidden = !settings.debug;
  $('#count-target').textContent = settings.mode === 'reps' ? `sur ${hold ? fmtTime(settings.target) : settings.target}` : hold ? 'tenu' : '';
  $('#hud-timer').textContent = settings.mode === 'time' ? fmtTime(settings.duration) : '0:00';
  $('#ring').toggleAttribute('hidden', settings.mode === 'free'); // SVG : pas de propriété .hidden
  setRing(settings.mode === 'time' ? 1 : 0);
  $('#workout').classList.toggle('mirrored', settings.facing === 'user' && !testVideo);

  session = {
    ex,
    hold,
    counter: new RepCounter(ex),
    stream: null,
    wakeLock: null,
    raf: 0,
    lastVideoTime: -1,
    countdownEnd: 0,
    startedAt: 0,
    state: 'loading', // loading → countdown → active → done
    lastSpokenHintAt: 0,
    lastHint: '',
    poseOk: null,
    announced: new Set(),
    diag: settings.debug ? { frames: [], startedAt: Date.now() } : null,
  };
  setPoseState(false);

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
  voice.say(`${ex.setupHint}.`, { interrupt: true });
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

  if (session.state === 'countdown') {
    const left = Math.ceil((session.countdownEnd - now) / 1000);
    const cd = $('#countdown');
    if (left > 0) {
      cd.hidden = false;
      cd.innerHTML = `${left}<small></small>`;
      cd.querySelector('small').textContent = session.ex.setupHint;
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
    session.startedAt = now;
  }

  const elapsed = (now - session.startedAt) / 1000;
  updateTimer(elapsed);
  if (!session || session.state !== 'active') return;
  if (fresh) handleResult(session.counter.update(landmarks, now, video.videoWidth / video.videoHeight), now);
}

function handleResult(r, now) {
  const lastFrame = session.diag?.frames.at(-1);
  if (lastFrame) lastFrame.r = { a: r.angle && +r.angle.toFixed(1), raw: r.raw && +r.raw.toFixed(1), ph: r.phase, v: r.valid, po: r.posture, sd: r.side, sc: r.score && +r.score.toFixed(2), ev: r.event, reps: r.reps };
  setPoseState(r.valid);

  if (session.hold) {
    if (r.event === 'tick') {
      $('#count').textContent = fmtTime(r.reps);
      if (settings.mode === 'reps') setRing(r.reps / settings.target);
      if (r.reps % 10 === 0) voice.say(r.reps < 60 ? `${r.reps} secondes` : fmtTime(r.reps).replace(':', ' minute ').replace(' minute 00', ' minute'));
      if (settings.mode === 'reps' && r.reps >= settings.target) {
        voice.say('Objectif atteint, bravo !');
        finishWorkout('Objectif atteint !');
        return;
      }
    }
  } else if (r.event === 'rep') {
    $('#count').textContent = r.reps;
    if (settings.mode === 'reps') setRing(r.reps / settings.target);
    bump('bump');
    voice.say(String(r.reps));
    if (settings.mode === 'reps' && r.reps >= settings.target) {
      voice.say('Objectif atteint, bravo !');
      finishWorkout('Objectif atteint !');
      return;
    }
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

function updateTimer(elapsed) {
  if (settings.mode === 'time') {
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
  const wasActive = session.state === 'active';
  const seconds = wasActive ? (performance.now() - session.startedAt) / 1000 : 0;
  const { reps, partials } = session.counter;
  const { ex, hold } = session;
  session.state = 'done';
  stopMedia();
  if (session.diag?.frames.length) sendDiagnostic(session);
  $('#countdown').hidden = true;

  const history = loadHistory();
  const previous = history.filter((h) => h.exercise === ex.id);
  const prevBest = previous.length ? previous.reduce((a, b) => (b.reps > a.reps ? b : a)) : null;
  if (wasActive && reps > 0) {
    history.push({ date: new Date().toISOString(), exercise: ex.id, kind: ex.kind, reps, partials, seconds: Math.round(seconds), source: 'camera' });
    saveHistory(history);
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
renderAll();
bindSettings();

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

$('#start').addEventListener('click', startWorkout);
$('#stop').addEventListener('click', () => { voice.stop(); finishWorkout(); });
$('#stop-x').addEventListener('click', () => { voice.stop(); finishWorkout(); });
$('#back').addEventListener('click', () => showScreen('app'));
$('#again').addEventListener('click', startWorkout);
$('#clear-history').addEventListener('click', () => {
  if (confirm('Effacer tout l\'historique ? Pense à l\'exporter avant si tu veux le garder.')) {
    localStorage.removeItem(HISTORY_KEY);
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
