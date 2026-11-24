// Retour audio pendant la séance. Trois modes :
//   'voice'  : voix de coaching (synthèse vocale du navigateur) + petits sons ;
//   'sounds' : uniquement des sons (début d'exercice, répétitions, objectif…) ;
//   'off'    : silence.
// Sur iOS, l'audio doit être "débloqué" pendant un geste de l'utilisateur : appeler unlock() dans le clic.

// Petites mélodies : [fréquence en Hz, durée en ms].
const CUES = {
  tick: [[660, 90]], // compte à rebours, rappels de temps
  start: [[523, 110], [659, 110], [784, 240]], // début d'un exercice
  rep: [[880, 110]], // répétition
  milestone: [[880, 90], [1175, 160]], // palier (secondes de gainage, exercice du programme fini)
  partial: [[330, 160]], // répétition incomplète
  rest: [[587, 160], [440, 260]], // début du repos
  done: [[784, 130], [988, 130], [1319, 340]], // objectif atteint, fin
};

export class Voice {
  constructor() {
    this.mode = 'voice';
    this.voice = null;
    this.ctx = null;
    this.synth = globalThis.speechSynthesis ?? null;
    if (this.synth) {
      const pick = () => {
        const voices = this.synth.getVoices();
        this.voice =
          voices.find((v) => v.lang === 'fr-FR' && v.localService) ??
          voices.find((v) => v.lang?.startsWith('fr')) ??
          null;
      };
      pick();
      this.synth.addEventListener?.('voiceschanged', pick);
    }
  }

  unlock() {
    if (this.synth) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      this.synth.speak(u);
    }
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* pas de Web Audio */ }
  }

  /** `interrupt` coupe la phrase en cours (pour les consignes), sinon on met en file (pour les nombres). */
  say(text, { interrupt = false, rate = 1.1 } = {}) {
    if (this.mode !== 'voice' || !this.synth) return;
    if (interrupt && this.synth.speaking) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (this.voice) u.voice = this.voice;
    u.rate = rate;
    this.synth.speak(u);
  }

  /** Phrase en mode voix, petite mélodie en mode sons. */
  announce(text, cue, opts) {
    if (this.mode === 'voice') this.say(text, opts);
    else this.cue(cue);
  }

  /** Joue une mélodie (dans les modes voix et sons). */
  cue(name) {
    if (this.mode === 'off' || !this.ctx) return;
    let at = 0;
    for (const [freq, ms] of CUES[name] ?? []) {
      this.tone(freq, ms, at);
      at += ms + 30;
    }
  }

  tone(freq, ms, delayMs = 0, gain = 0.18) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(g).connect(this.ctx.destination);
    const t = this.ctx.currentTime + delayMs / 1000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  }

  stop() {
    this.synth?.cancel();
  }
}
