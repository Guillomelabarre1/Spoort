// Profils : page « Qui s'entraîne ? », code PIN, photo de profil, création et suppression.

import { askPin, chooseNewPin } from './pinpad.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// Couleur stable par prénom quand il n'y a pas de photo.
const COLORS = ['#a3e635', '#38bdf8', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c'];
export function colorFor(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Pastille de profil : photo, ou initiale sur fond coloré. */
export function avatar(p, cls = '') {
  const a = el('span', `avatar ${cls}`.trim());
  const name = p?.name ?? '?';
  if (p?.avatar) {
    const img = el('img');
    img.src = p.avatar;
    img.alt = '';
    a.append(img);
  } else {
    a.textContent = (name.trim()[0] ?? '?').toUpperCase();
    a.style.background = colorFor(name);
  }
  return a;
}

/** Remplace le contenu d'un conteneur par la pastille du profil. */
export function fillAvatar(container, p) {
  container.replaceWith(Object.assign(avatar(p, container.className.replace('avatar', '').trim()), { id: container.id }));
}

/**
 * Photo choisie → carré recadré au centre, 256 px, JPEG (~20-40 Ko). La photo d'origine ne quitte
 * jamais le téléphone ; l'orientation EXIF est appliquée par le navigateur.
 */
export async function photoToAvatar(file, size = 256) {
  if (!file?.type.startsWith('image/')) throw new Error('Ce fichier n\'est pas une image.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  let quality = 0.85, url = canvas.toDataURL('image/jpeg', quality);
  while (url.length > 200 * 1024 && quality > 0.4) url = canvas.toDataURL('image/jpeg', (quality -= 0.15));
  return url;
}

let ctx = null; // { store, showError, openSheet, closeSheets, onPicked }
let newPhoto = null;

export function renderLogin() {
  if (!ctx) return;
  const grid = $('#login-grid');
  grid.innerHTML = '';
  for (const p of ctx.store.profiles) {
    const b = el('button', 'login-profile');
    b.append(avatar(p, 'xl'), el('span', null, p.name));
    b.addEventListener('click', () => pick(p, b));
    grid.append(b);
  }
  const add = el('button', 'login-profile login-add');
  const plus = el('span', 'avatar xl add', '+');
  add.append(plus, el('span', null, 'Ajouter'));
  add.addEventListener('click', openNewProfile);
  grid.append(add);
  $('#login-empty').hidden = ctx.store.profiles.length > 0;
}

const verifyWith = (id) => async (pin) => {
  try {
    await ctx.store.unlock(id, pin);
    return true;
  } catch (err) {
    return { error: err.status === 401 || err.status === 429 ? err.message : `Vérification impossible (${err.message})`, retryAfter: err.retryAfter };
  }
};

/** Choix d'un profil sur la page d'accueil : code demandé si besoin, puis ouverture. */
async function pick(p, button) {
  const { store } = ctx;
  if (store.needsPin(p.id)) {
    const ok = await askPin({ title: p.name, subtitle: 'Saisis ton code', avatarEl: avatar(p, 'xl'), verify: verifyWith(p.id) });
    if (!ok) return;
  }
  button?.classList.add('picked');
  await store.select(p.id);
  // Ancien profil sans code : on en crée un tout de suite.
  if (!store.hasPin(p.id)) {
    const pin = await chooseNewPin({ title: 'Protège ton profil', avatarEl: avatar(p, 'xl') });
    if (!pin) { store.signOut(); return; }
    try { await store.setPin(pin); } catch (err) { ctx.showError(`Code non enregistré : ${err.message}`); store.signOut(); return; }
    ctx.showError('Code enregistré ✔︎');
  }
  ctx.onPicked();
}

function setPreview(box, p) {
  box.innerHTML = '';
  box.append(avatar(p, 'xl'));
}

function openNewProfile() {
  newPhoto = null;
  $('#np-form').reset();
  setPreview($('#np-preview'), { name: '?' });
  ctx.openSheet('#sheet-newprofile');
}

/** Photo du profil actif dans la fiche « Mon profil ». */
export function refreshProfilePhoto() {
  const p = ctx.store.profile;
  setPreview($('#pf-preview'), { name: p.name ?? ctx.store.user?.name ?? '?', avatar: p.avatar });
  $('#pf-photo-remove').hidden = !p.avatar;
  $('#pf-switch').hidden = !ctx.store.server;
  $('#pf-pin').hidden = !ctx.store.server;
  $('#pf-delete').hidden = !ctx.store.server;
}

export function bindProfiles(helpers) {
  ctx = helpers;
  const { store } = ctx;

  $('#np-photo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      newPhoto = await photoToAvatar(f);
      setPreview($('#np-preview'), { name: $('#np-name').value, avatar: newPhoto });
    } catch (err) { ctx.showError(err.message); }
  });
  $('#np-name').addEventListener('input', () => { if (!newPhoto) setPreview($('#np-preview'), { name: $('#np-name').value || '?' }); });
  $('#np-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#np-name').value.trim();
    if (!name) return;
    const pin = await chooseNewPin({ title: `Code de ${name}`, avatarEl: avatar({ name, avatar: newPhoto }, 'xl') });
    if (!pin) return;
    try {
      await store.createProfile(name, newPhoto, pin);
      ctx.closeSheets();
      ctx.onPicked();
    } catch (err) {
      ctx.showError(err.status === 409 ? 'Nombre maximum de profils atteint.' : `Création impossible : ${err.message}`);
    }
  });

  $('#pf-photo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      store.setProfile({ avatar: await photoToAvatar(f) });
      refreshProfilePhoto();
      ctx.onChange();
    } catch (err) { ctx.showError(err.message); }
  });
  $('#pf-photo-remove').addEventListener('click', () => {
    store.setProfile({ avatar: null });
    refreshProfilePhoto();
    ctx.onChange();
  });
  $('#pf-switch').addEventListener('click', () => { ctx.closeSheets(); store.signOut(); });
  $('#pf-pin').addEventListener('click', async () => {
    const p = store.profile;
    const pin = await chooseNewPin({ title: 'Nouveau code', avatarEl: avatar({ name: p.name, avatar: p.avatar }, 'xl') });
    if (!pin) return;
    try {
      await store.setPin(pin);
      ctx.showError('Code changé ✔︎ Les autres appareils devront le saisir à nouveau.');
    } catch (err) { ctx.showError(`Code non changé : ${err.message}`); }
  });
  $('#pf-delete').addEventListener('click', async () => {
    const name = store.profile.name ?? 'ce profil';
    if (!confirm(`Supprimer le profil « ${name} » et toutes ses données (séances, mesures, programmes) ? Pense à exporter avant si tu veux les garder.`)) return;
    try {
      await store.deleteProfile(store.profileId);
      ctx.closeSheets();
    } catch (err) { ctx.showError(`Suppression impossible : ${err.message}`); }
  });
}
