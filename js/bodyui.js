// Onglet « Corps » : profil, saisie des mensurations, indicateurs, courbes et mannequin 3D.

import { MEASURES, MEASURE, valuesAt, series, bmi, bodyFatNavy } from './body.js';
import { dayKey } from './stats.js';
import { refreshProfilePhoto } from './profileui.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtNum = (v, d = 1) => (v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => new Date(d).toLocaleDateString('fr-FR', opts);
const DAY = 86400000;

// Conseils de mesure, affichés dans la fiche de saisie.
const HOW = {
  weight: 'le matin, à jeun',
  neck: 'sous la pomme d\'Adam',
  shoulders: 'au plus large, bras le long du corps',
  chest: 'au niveau des tétons, poumons vides',
  waist: 'au niveau du nombril, ventre relâché',
  hips: 'au plus large des fesses',
  arm: 'au plus gros du biceps, bras détendu',
  thigh: 'au plus gros, sous le pli fessier',
  calf: 'au plus gros du mollet',
};

let ctx = null;          // { store, showError, openSheet, closeSheets, onChange }
let view = null;         // vue 3D (créée à la première ouverture de l'onglet)
let viewLoading = null;
let compare = 'first';   // none | first | 30

function compareBase(measurements) {
  if (compare === 'none' || measurements.length < 2) return null;
  if (compare === 'first') {
    const first = Date.parse(measurements[0].date);
    return { values: valuesAt(measurements, first), label: `1re mesure (${fmtDate(first)})` };
  }
  const until = Date.now() - 30 * DAY;
  const values = valuesAt(measurements, until);
  return Object.keys(values).length ? { values, label: 'il y a 30 jours' } : null;
}

export function renderBodyTab(store) {
  if (!ctx) return;
  const profile = store.profile;
  const ms = store.measurements;
  const current = valuesAt(ms);
  const base = compareBase(ms);

  $('#body-who').textContent = profile.name ? `Profil de ${profile.name}` : 'Mensurations';
  $('#profile-missing').hidden = Boolean(profile.sex && profile.heightCm);
  $('#body-empty').hidden = ms.length > 0;
  for (const b of document.querySelectorAll('#compare-filter button')) b.classList.toggle('on', b.dataset.cmp === compare);
  $('#legend-ghost').hidden = !base;
  $('#cmp-label').textContent = base ? base.label : '';

  renderKpis(profile, current, base?.values ?? null);
  renderCharts(ms);
  renderList(ms);

  // La 3D n'est créée que si l'onglet est visible (WebGL coûte cher).
  if ($('#tab-body').classList.contains('active')) {
    ensureView().then((v) => v?.update(current, base?.values ?? null, profile));
  }
}

function ensureView() {
  if (view) return Promise.resolve(view);
  viewLoading ??= import('./body3d.js')
    .then(({ createBodyView }) => createBodyView($('#body3d')))
    .then((v) => { view = v; $('#body3d').classList.add('ready'); return v; })
    .catch((err) => {
      console.error(err);
      $('#body3d').classList.add('failed');
      $('#body3d').textContent = 'Affichage 3D indisponible sur cet appareil.';
      return null;
    });
  return viewLoading;
}

function kpi(label, value, sub, up) {
  const d = el('div', 'kpi');
  const em = el('em', up ? 'up' : '', sub ?? '');
  d.append(el('small', null, label), el('strong', null, value), em);
  return d;
}

function delta(now, before, unit, d = 1) {
  if (now == null || before == null) return null;
  const diff = now - before;
  if (Math.abs(diff) < 0.05) return `= ${unit === '%' ? 'stable' : 'inchangé'}`;
  return `${diff > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(diff), d)} ${unit}`;
}

function renderKpis(profile, cur, before) {
  const box = $('#body-kpis');
  box.innerHTML = '';
  const fat = bodyFatNavy(profile.sex, profile.heightCm, cur);
  const fatBefore = before ? bodyFatNavy(profile.sex, profile.heightCm, before) : null;
  const b = bmi(cur.weight, profile.heightCm);
  box.append(
    kpi('Poids', cur.weight ? `${fmtNum(cur.weight)} kg` : '—', delta(cur.weight, before?.weight, 'kg')),
    kpi('Masse grasse (estim.)', fat ? `${fmtNum(fat)} %` : '—', fat ? delta(fat, fatBefore, 'pts') ?? 'méthode U.S. Navy' : profile.sex === 'f' ? 'cou, taille, hanches' : 'cou + tour de taille'),
    kpi('IMC', b ? fmtNum(b) : '—', b ? (b < 18.5 ? 'insuffisance pondérale' : b < 25 ? 'corpulence normale' : b < 30 ? 'surpoids' : 'obésité') + ' (indicatif)' : 'poids + taille du profil'),
    kpi('Tour de taille', cur.waist ? `${fmtNum(cur.waist)} cm` : '—', delta(cur.waist, before?.waist, 'cm')),
  );
}

/** Petites courbes (une par mesure), valeur actuelle et évolution depuis la première mesure. */
function renderCharts(ms) {
  const box = $('#body-charts');
  box.innerHTML = '';
  for (const m of MEASURES) {
    const pts = series(ms, m.id);
    if (!pts.length) continue;
    const card = el('div', 'spark');
    const last = pts.at(-1).value, first = pts[0].value;
    const head = el('div', 'spark-head');
    head.append(el('span', null, m.label), el('strong', null, `${fmtNum(last)} ${m.unit}`));
    card.append(head, sparkline(pts, m), el('small', 'muted', pts.length > 1 ? `${last - first >= 0 ? '+' : '−'}${fmtNum(Math.abs(last - first))} ${m.unit} depuis le ${fmtDate(pts[0].date)}` : `le ${fmtDate(pts[0].date)}`));
    box.append(card);
  }
  if (!box.children.length) box.append(el('p', 'empty', 'Les courbes apparaîtront après ta première mesure.'));
}

function sparkline(pts, m) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 160, H = 48, pad = 5;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${m.label} : ${pts.map((p) => `${fmtDate(p.date)} ${fmtNum(p.value)} ${m.unit}`).join(', ')}`);
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
  const end = pts.at(-1);
  add('circle', { cx: x(end), cy: y(end.value), r: 4, class: 'spark-dot' });
  // Toucher / survoler : la valeur la plus proche.
  const hit = add('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a));
    const tip = $('#tooltip');
    tip.textContent = `${fmtDate(p.date)} : ${fmtNum(p.value)} ${m.unit}`;
    tip.style.left = `${Math.min(innerWidth - 90, Math.max(90, r.left + (x(p) / W) * r.width))}px`;
    tip.style.top = `${r.top + (y(p.value) / H) * r.height - 8}px`;
    tip.hidden = false;
    clearTimeout(show.t);
    show.t = setTimeout(() => { tip.hidden = true; }, 1800);
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { $('#tooltip').hidden = true; });
  return svg;
}

function renderList(ms) {
  const list = $('#measure-list');
  list.innerHTML = '';
  for (const m of [...ms].reverse().slice(0, 40)) {
    const li = el('li');
    const what = el('span', 'what');
    const parts = MEASURES.filter((x) => m[x.id]).map((x) => `${x.label} ${fmtNum(m[x.id])}`);
    what.append(el('span', null, fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })), el('small', null, parts.join(' · ')));
    const del = el('button', 'del', '✕');
    del.setAttribute('aria-label', 'Supprimer cette mesure');
    del.addEventListener('click', () => {
      if (!confirm('Supprimer cette mesure ?')) return;
      ctx.store.deleteMeasurement(m.id);
      ctx.onChange();
    });
    li.append(what, del);
    list.append(li);
  }
  if (!list.children.length) list.append(el('li', 'empty', 'Aucune mesure pour l\'instant.'));
}

// ---------- Fiches ----------
function openMeasure() {
  const { store } = ctx;
  const last = valuesAt(store.measurements);
  const grid = $('#measure-fields');
  grid.innerHTML = '';
  for (const m of MEASURES) {
    const label = el('label', 'mfield');
    const top = el('span', null, `${m.label} (${m.unit})`);
    const input = el('input');
    Object.assign(input, { type: 'number', inputMode: 'decimal', step: m.step, min: 1, max: m.id === 'weight' ? 400 : 300, name: m.id });
    input.placeholder = last[m.id] ? fmtNum(last[m.id]) : '';
    label.append(top, input, el('small', null, HOW[m.id]));
    grid.append(label);
  }
  $('#measure-date').value = dayKey(new Date());
  $('#measure-date').max = dayKey(new Date());
  ctx.openSheet('#sheet-measure');
}

function saveMeasure(e) {
  e.preventDefault();
  const entry = {};
  for (const m of MEASURES) {
    const raw = $(`#measure-fields input[name=${m.id}]`).value.replace(',', '.');
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v > 0) entry[m.id] = Math.round(v * 10) / 10;
  }
  if (!Object.keys(entry).length) { ctx.showError('Renseigne au moins une mesure.'); return; }
  const [y, mo, d] = $('#measure-date').value.split('-').map(Number);
  ctx.store.addMeasurement({ date: new Date(y, mo - 1, d, 12).toISOString(), ...entry });
  ctx.closeSheets();
  ctx.onChange();
  ctx.showError(`Mesures du ${fmtDate(new Date(y, mo - 1, d))} enregistrées ✔︎`);
}

export function openProfile(store) {
  const p = store.profile;
  $('#pf-name').value = p.name ?? store.user?.name ?? '';
  for (const r of document.querySelectorAll('input[name=pf-sex]')) r.checked = r.value === p.sex;
  $('#pf-height').value = p.heightCm ?? '';
  $('#pf-birth').value = p.birthYear ?? '';
  $('#pf-birth').max = new Date().getFullYear() - 10;
  refreshProfilePhoto();
  ctx.openSheet('#sheet-profile');
}

function saveProfile(e) {
  e.preventDefault();
  const height = parseInt($('#pf-height').value, 10);
  const birth = parseInt($('#pf-birth').value, 10);
  ctx.store.setProfile({
    name: $('#pf-name').value.trim().slice(0, 40) || null,
    sex: document.querySelector('input[name=pf-sex]:checked')?.value ?? null,
    heightCm: height >= 100 && height <= 250 ? height : null,
    birthYear: birth >= 1900 && birth <= new Date().getFullYear() ? birth : null,
  });
  ctx.closeSheets();
  ctx.onChange();
  ctx.showError('Profil enregistré ✔︎');
}

export function bindBody(store, helpers) {
  ctx = { store, ...helpers };
  $('#open-measure').addEventListener('click', openMeasure);
  $('#body-empty-add').addEventListener('click', openMeasure);
  $('#measure-form').addEventListener('submit', saveMeasure);
  $('#profile-form').addEventListener('submit', saveProfile);
  $('#fill-profile').addEventListener('click', () => openProfile(store));
  $('#compare-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cmp]');
    if (!b) return;
    compare = b.dataset.cmp;
    renderBodyTab(store);
  });
}

export { MEASURE };
