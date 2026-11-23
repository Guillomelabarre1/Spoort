// Voix de coaching (synthèse vocale du navigateur) + petits bips (Web Audio).
// Sur iOS, l'audio doit être "débloqué" pendant un geste de l'utilisateur : appeler unlock() dans le clic.

export class Voice {
  constructor() {
    this.enabled = true;
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
    if (!this.enabled || !this.synth) return;
    if (interrupt && this.synth.speaking) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (this.voice) u.voice = this.voice;
    u.rate = rate;
    this.synth.speak(u);
  }

  beep(freq = 880, ms = 120, gain = 0.15) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(this.ctx.destination);
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.start(t);
    osc.stop(t + ms / 1000);
  }

  stop() {
    this.synth?.cancel();
  }
}
