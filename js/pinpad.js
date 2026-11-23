// Pavé de code PIN (4 chiffres) : touches tactiles + clavier de l'ordinateur.
// askPin({ title, subtitle, verify }) → Promise<string | null>.
// `verify(pin)` (optionnel) : renvoie true si c'est bon, sinon { error, retryAfter } ; le pavé
// reste ouvert tant que ce n'est pas bon (ou que l'utilisateur n'a pas annulé).

const LEN = 4;
let open = null; // { resolve, verify, pin, busy, lockedUntil }

function build() {
  if (document.getElementById('pinpad')) return;
  const root = document.createElement('div');
  root.id = 'pinpad';
  root.className = 'pinpad';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="pin-box">
      <div class="pin-avatar" id="pin-avatar"></div>
      <h2 id="pin-title"></h2>
      <p id="pin-sub"></p>
      <div class="pin-dots" id="pin-dots" aria-live="polite">${'<i></i>'.repeat(LEN)}</div>
      <p class="pin-error" id="pin-error"></p>
      <div class="pin-keys">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <span></span><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Effacer">⌫</button>
      </div>
      <button type="button" class="link" id="pin-cancel">Annuler</button>
    </div>`;
  document.body.append(root);
  root.querySelector('.pin-keys').addEventListener('click', (e) => {
    const k = e.target.closest('button')?.dataset.k;
    if (k) press(k);
  });
  root.querySelector('#pin-cancel').addEventListener('click', () => close(null));
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Escape') close(null);
    else return;
    e.preventDefault();
  });
}

function dots() {
  const n = open?.pin.length ?? 0;
  document.querySelectorAll('#pin-dots i').forEach((d, i) => d.classList.toggle('on', i < n));
}

function setError(msg) {
  const el = document.getElementById('pin-error');
  el.textContent = msg ?? '';
  if (msg) {
    const box = document.getElementById('pin-dots');
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
  }
}

function lockFor(seconds) {
  open.lockedUntil = Date.now() + seconds * 1000;
  const tick = () => {
    if (!open) return;
    const left = Math.ceil((open.lockedUntil - Date.now()) / 1000);
    if (left > 0) { setError(`Trop d'essais. Réessaie dans ${left} s.`); setTimeout(tick, 500); }
    else { open.lockedUntil = 0; setError(''); }
  };
  tick();
}

async function press(k) {
  if (!open || open.busy || open.lockedUntil > Date.now()) return;
  if (k === 'del') { open.pin = open.pin.slice(0, -1); dots(); return; }
  if (open.pin.length >= LEN) return;
  open.pin += k;
  dots();
  if (open.pin.length < LEN) return;
  const pin = open.pin;
  if (!open.verify) return close(pin);
  open.busy = true;
  const result = await open.verify(pin).catch((err) => ({ error: err.message }));
  if (!open) return;
  open.busy = false;
  if (result === true) return close(pin);
  open.pin = '';
  dots();
  if (result?.retryAfter) lockFor(result.retryAfter);
  else setError(result?.error ?? 'Code incorrect');
}

function close(value) {
  const o = open;
  open = null;
  document.getElementById('pinpad').hidden = true;
  o?.resolve(value);
}

/** Affiche le pavé. `avatarEl` : pastille du profil (optionnelle). */
export function askPin({ title, subtitle = '', verify = null, avatarEl = null } = {}) {
  build();
  if (open) close(null);
  const root = document.getElementById('pinpad');
  document.getElementById('pin-title').textContent = title;
  document.getElementById('pin-sub').textContent = subtitle;
  const av = document.getElementById('pin-avatar');
  av.innerHTML = '';
  if (avatarEl) av.append(avatarEl);
  setError('');
  root.hidden = false;
  return new Promise((resolve) => {
    open = { resolve, verify, pin: '', busy: false, lockedUntil: 0 };
    dots();
  });
}

/** Choisir un nouveau code : saisie puis confirmation. Renvoie le code, ou null si annulé. */
export async function chooseNewPin({ title = 'Choisis un code', avatarEl = null } = {}) {
  const first = await askPin({ title, subtitle: '4 chiffres, pour protéger tes données', avatarEl: avatarEl?.cloneNode(true) });
  if (!first) return null;
  return askPin({
    title: 'Confirme ton code',
    subtitle: 'Saisis-le une deuxième fois',
    avatarEl: avatarEl?.cloneNode(true),
    verify: async (pin) => (pin === first ? true : { error: 'Les deux codes ne correspondent pas' }),
  });
}
