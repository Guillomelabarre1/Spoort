// Programmes de séance : cartes sur l'onglet Séance et éditeur (créer, modifier, ajuster avant de lancer).

import { CATEGORIES } from './exercises.js';
import { normalizeProgram, summarize, REST_DEFAULT, LIMITS } from './program.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

let ctx = null;   // { store, exercises(), openSheet, closeSheets, showError, onLaunch, onChange }
let draft = null; // programme en cours d'édition (copie)

const isHold = (id) => ctx.exercises()[id]?.kind === 'hold';
const fmtTarget = (s) => (isHold(s.exercise) ? fmtTime(s.target) : `×${s.target}`);
const defaultTarget = (id) => (isHold(id) ? 30 : 15);

export function renderPrograms() {
  if (!ctx) return;
  const exercises = ctx.exercises();
  const box = $('#program-list');
  box.innerHTML = '';
  for (const p of ctx.store.programs) {
    const prog = normalizeProgram(p, exercises);
    const sum = summarize(prog, exercises);
    const card = el('button', 'prog-card');
    card.append(
      el('strong', null, prog.name),
      el('small', null, `${sum.count} exercice${sum.count > 1 ? 's' : ''} · ~${sum.minutes} min`),
      el('span', 'prog-steps', prog.steps.slice(0, 3).map((s) => `${exercises[s.exercise].name} ${fmtTarget(s)}`).join(' · ') + (prog.steps.length > 3 ? ' …' : '')),
    );
    card.addEventListener('click', () => openEditor(p));
    box.append(card);
  }
  const add = el('button', 'prog-card prog-new');
  add.append(el('strong', null, '+ Nouveau programme'), el('small', null, 'Enchaîne plusieurs exercices'));
  add.addEventListener('click', () => openEditor(null));
  box.append(add);
}

function openEditor(program) {
  const exercises = ctx.exercises();
  draft = program
    ? structuredClone(normalizeProgram(program, exercises))
    : { name: '', rest: REST_DEFAULT, steps: [{ exercise: 'pushup', target: 15 }, { exercise: 'squat', target: 20 }] };
  $('#prog-title').textContent = program ? 'Avant de lancer' : 'Nouveau programme';
  $('#prog-name').value = draft.name;
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
      if (wasHold !== isHold(step.exercise)) step.target = defaultTarget(step.exercise);
      renderEditor();
    });

    // Objectif saisi au clavier (pavé numérique sur iPhone) : répétitions, ou secondes pour un maintien.
    const hold = isHold(step.exercise);
    const [lo, hi] = hold ? LIMITS.hold : LIMITS.reps;
    const stepper = el('label', 'target-input');
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
    input.min = lo; input.max = hi;
    input.value = String(step.target);
    input.setAttribute('aria-label', hold ? `Secondes à tenir, exercice ${i + 1}` : `Répétitions, exercice ${i + 1}`);
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
    stepper.append(input, el('small', null, hold ? 's tenues' : 'reps'));

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
  renderSummary();
}

function renderSummary() {
  const sum = summarize(draft, ctx.exercises());
  const parts = [`${sum.count} exercice${sum.count > 1 ? 's' : ''}`];
  if (sum.reps) parts.push(`${sum.reps} répétitions`);
  if (sum.hold) parts.push(`${fmtTime(sum.hold)} de maintien`);
  parts.push(`~${sum.minutes} min`);
  $('#prog-summary').textContent = parts.join(' · ');
}

function current() {
  draft.name = $('#prog-name').value;
  return normalizeProgram(draft, ctx.exercises());
}

export function bindPrograms(helpers) {
  ctx = helpers;
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
