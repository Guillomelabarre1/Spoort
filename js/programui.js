// Programmes de séance : cartes sur l'onglet Séance et éditeur (créer, modifier, ajuster avant de lancer).

import { CATEGORIES } from './exercises.js';
import { normalizeProgram, summarize, REST_DEFAULT, LIMITS } from './program.js';
import { LIBRARY } from './library.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

let ctx = null;   // { store, exercises(), openSheet, closeSheets, showError, onLaunch, onChange }
let draft = null; // programme en cours d'édition (copie)

const isHold = (id) => ctx.exercises()[id]?.kind === 'hold';
const fmtTarget = (s) => (isHold(s.exercise) ? fmtTime(s.target) : s.timed ? `${s.target} s` : `×${s.target}`);
/** « 3 exercices · ~12 min », « Max de tours · 20 min », « 10 tours · ~30 min ». */
const cardLine = (prog, sum) => (sum.amrap ? `Max de tours · ${sum.minutes} min`
  : `${sum.rounds > 1 ? `${sum.rounds} tours` : `${sum.count} exercice${sum.count > 1 ? 's' : ''}`} · ~${sum.minutes} min`);

function programCard(prog, extra) {
  const exercises = ctx.exercises();
  const sum = summarize(prog, exercises);
  const card = el('button', 'prog-card');
  card.type = 'button';
  card.append(
    el('strong', null, prog.name),
    el('small', null, extra ? `${extra} · ${cardLine(prog, sum)}` : cardLine(prog, sum)),
    el('span', 'prog-steps', prog.steps.slice(0, 3).map((s) => `${exercises[s.exercise].name} ${fmtTarget(s)}`).join(' · ') + (prog.steps.length > 3 ? ' …' : '')),
  );
  return card;
}

/** Séances toutes prêtes (js/library.js) : on les ouvre dans l'éditeur, comme un nouveau programme. */
function renderLibrary() {
  const box = $('#library-list');
  if (!box) return;
  box.innerHTML = '';
  for (const lib of LIBRARY) {
    const prog = normalizeProgram(lib, ctx.exercises());
    if (prog.steps.length !== lib.steps.length) continue; // exercice manquant
    const card = programCard(prog, lib.level);
    card.classList.add('lib-card');
    card.addEventListener('click', () => openEditor(lib, { library: true }));
    box.append(card);
  }
}
const defaultTarget = (id) => (isHold(id) ? 30 : 15);

export function renderPrograms() {
  if (!ctx) return;
  const exercises = ctx.exercises();
  const box = $('#program-list');
  box.innerHTML = '';
  for (const p of ctx.store.programs) {
    const card = programCard(normalizeProgram(p, exercises));
    card.addEventListener('click', () => openEditor(p));
    box.append(card);
  }
  const add = el('button', 'prog-card prog-new');
  add.append(el('strong', null, '+ Nouveau programme'), el('small', null, 'Enchaîne plusieurs exercices'));
  add.addEventListener('click', () => openEditor(null));
  box.append(add);
  renderLibrary();
}

function openEditor(program, { library = false } = {}) {
  const exercises = ctx.exercises();
  draft = program
    ? structuredClone(normalizeProgram(program, exercises))
    : normalizeProgram({ name: '', rest: REST_DEFAULT, steps: [{ exercise: 'pushup', target: 15 }, { exercise: 'squat', target: 20 }] }, exercises);
  if (!program) draft.name = '';
  if (library) delete draft.id; // copie : enregistrer crée un programme à soi
  $('#prog-title').textContent = library ? 'Séance toute prête' : program ? 'Avant de lancer' : 'Nouveau programme';
  $('#prog-name').value = draft.name;
  const src = $('#prog-source');
  src.innerHTML = '';
  const note = library ? program.note : '';
  if (note) src.append(el('span', null, note + ' '));
  if (draft.source?.url) {
    const a = el('a', null, `Source : ${draft.source.name}`);
    a.href = draft.source.url; a.target = '_blank'; a.rel = 'noopener';
    src.append(a);
  }
  src.hidden = !src.childNodes.length;
  $('#prog-delete').hidden = !draft.id;
  $('#prog-save').textContent = draft.id ? 'Enregistrer les modifications' : 'Enregistrer le programme';
  renderEditor();
  ctx.openSheet('#sheet-program');
}

function exerciseSelect(value) {
  const select = el('select');
  const exercises = ctx.exercises();
  for (const [cat, label] of Object.entries(CATEGORIES)) {
    const list = Object.values(exercises).filter((e) => e.category === cat);
    if (!list.length) continue;
    const g = el('optgroup');
    g.label = label;
    for (const ex of list) {
      const o = el('option', null, ex.name);
      o.value = ex.id;
      o.selected = ex.id === value;
      g.append(o);
    }
    select.append(g);
  }
  return select;
}

function renderEditor() {
  const list = $('#prog-steps');
  list.innerHTML = '';
  draft.steps.forEach((step, i) => {
    const li = el('li', 'step-row');
    const num = el('span', 'step-num', String(i + 1));
    const select = exerciseSelect(step.exercise);
    select.setAttribute('aria-label', `Exercice ${i + 1}`);
    select.addEventListener('change', () => {
      const wasHold = isHold(step.exercise);
      step.exercise = select.value;
      if (isHold(step.exercise)) delete step.timed;
      if (wasHold !== isHold(step.exercise)) step.target = defaultTarget(step.exercise);
      renderEditor();
    });

    // Objectif saisi au clavier (pavé numérique sur iPhone) : répétitions, ou secondes pour un maintien.
    const hold = isHold(step.exercise);
    const secs = hold || step.timed;
    const [lo, hi] = secs ? LIMITS.hold : LIMITS.reps;
    const stepper = el('label', 'target-input');
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.min = lo; input.max = hi;
    input.value = String(step.target);
    input.setAttribute('aria-label', hold ? `Secondes à tenir, exercice ${i + 1}` : step.timed ? `Durée en secondes, exercice ${i + 1}` : `Répétitions, exercice ${i + 1}`);
    input.addEventListener('focus', () => input.select());
    const commit = () => {
      const n = Math.round(Number(input.value));
      step.target = Number.isFinite(n) && input.value !== '' ? Math.min(hi, Math.max(lo, n)) : step.target;
      input.value = String(step.target);
      renderSummary();
    };
    // Mis à jour à chaque frappe : « Lancer » ou « Enregistrer » touché sans fermer le clavier prend la valeur.
    input.addEventListener('input', () => {
      const n = Math.round(Number(input.value));
      if (input.value !== '' && Number.isFinite(n)) step.target = Math.min(hi, Math.max(lo, n));
      renderSummary();
    });
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    stepper.append(input);
    if (hold) stepper.append(el('small', null, 's tenues'));
    else {
      // Exercice à répétitions : objectif en nombre, ou « le plus possible en X secondes ».
      const unit = el('button', 'unit-toggle', step.timed ? 's max' : 'reps');
      unit.type = 'button';
      unit.setAttribute('aria-label', step.timed ? 'Passer en nombre de répétitions' : 'Passer en durée (le plus possible)');
      unit.addEventListener('click', (e) => {
        e.preventDefault();
        step.timed = !step.timed;
        step.target = step.timed ? 30 : 15;
        if (!step.timed) delete step.timed;
        renderEditor();
      });
      stepper.append(unit);
    }

    const tools = el('div', 'step-tools');
    const mk = (label, aria, fn, disabled) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.disabled = disabled;
      b.addEventListener('click', fn);
      tools.append(b);
    };
    mk('↑', 'Monter', () => { [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; renderEditor(); }, i === 0);
    mk('↓', 'Descendre', () => { [draft.steps[i + 1], draft.steps[i]] = [draft.steps[i], draft.steps[i + 1]]; renderEditor(); }, i === draft.steps.length - 1);
    mk('✕', 'Retirer', () => { draft.steps.splice(i, 1); renderEditor(); }, draft.steps.length === 1);

    const line2 = el('div', 'step-line');
    line2.append(stepper, tools);
    const main = el('div', 'step-main');
    main.append(select, line2);
    li.append(num, main);
    list.append(li);
  });
  $('#prog-add').disabled = draft.steps.length >= LIMITS.steps;
  $('#prog-rest-value').textContent = draft.rest ? fmtTime(draft.rest) : 'aucun';
  const amrap = draft.mode === 'amrap';
  for (const r of document.querySelectorAll('input[name="prog-mode"]')) r.checked = r.value === draft.mode;
  $('#prog-rounds-row').hidden = amrap;
  $('#prog-duration-row').hidden = !amrap;
  if (document.activeElement !== $('#prog-rounds')) $('#prog-rounds').value = String(draft.rounds ?? 1);
  if (document.activeElement !== $('#prog-duration')) $('#prog-duration').value = String(Math.round((draft.duration ?? 1200) / 60));
  renderSummary();
}

function renderSummary() {
  const sum = summarize(draft, ctx.exercises());
  const parts = [`${sum.count} exercice${sum.count > 1 ? 's' : ''}`];
  if (sum.amrap) {
    if (sum.perRound) parts.push(`${sum.perRound} répétitions par tour`);
    parts.push(`le plus de tours possible en ${sum.minutes} min`);
  } else {
    if (sum.rounds > 1) parts.push(`${sum.rounds} tours`);
    if (sum.reps) parts.push(`${sum.reps} répétitions`);
    if (sum.hold) parts.push(`${fmtTime(sum.hold)} chronométrées`);
    parts.push(`~${sum.minutes} min`);
  }
  $('#prog-summary').textContent = parts.join(' · ');
}

function current() {
  draft.name = $('#prog-name').value;
  return normalizeProgram(draft, ctx.exercises());
}

export function bindPrograms(helpers) {
  ctx = helpers;
  for (const r of document.querySelectorAll('input[name="prog-mode"]')) {
    r.addEventListener('change', () => {
      draft.mode = r.value;
      if (draft.mode === 'amrap') { draft.duration ??= 1200; draft.rounds = 1; }
      renderEditor();
    });
  }
  const numberField = (sel, apply) => {
    const input = $(sel);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => { const n = Math.round(Number(input.value)); if (input.value !== '' && Number.isFinite(n)) { apply(n); renderSummary(); } });
    input.addEventListener('blur', () => renderEditor());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  };
  numberField('#prog-rounds', (n) => { draft.rounds = Math.min(LIMITS.rounds[1], Math.max(LIMITS.rounds[0], n)); });
  numberField('#prog-duration', (n) => { draft.duration = Math.min(LIMITS.duration[1], Math.max(LIMITS.duration[0], n * 60)); });
  $('#prog-add').addEventListener('click', () => {
    const last = draft.steps.at(-1);
    draft.steps.push(last ? { ...last } : { exercise: 'pushup', target: 15 });
    renderEditor();
    $('#prog-steps').lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  for (const b of document.querySelectorAll('[data-rest]')) {
    b.addEventListener('click', () => {
      draft.rest = Math.min(LIMITS.rest[1], Math.max(0, draft.rest + Number(b.dataset.rest)));
      renderEditor();
    });
  }
  $('#prog-save').addEventListener('click', () => {
    const p = current();
    draft.id = ctx.store.saveProgram(p);
    $('#prog-delete').hidden = false;
    $('#prog-title').textContent = 'Avant de lancer';
    $('#prog-save').textContent = 'Enregistrer les modifications';
    ctx.onChange();
    ctx.showError(`Programme « ${p.name} » enregistré ✔︎`);
  });
  $('#prog-delete').addEventListener('click', () => {
    if (!draft.id || !confirm(`Supprimer le programme « ${current().name} » ?`)) return;
    ctx.store.deleteProgram(draft.id);
    ctx.closeSheets();
    ctx.onChange();
  });
  $('#program-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = current();
    if (!p.steps.length) { ctx.showError('Ajoute au moins un exercice.'); return; }
    ctx.closeSheets();
    ctx.onLaunch(p); // lance avec les ajustements, enregistrés ou non
  });
}
