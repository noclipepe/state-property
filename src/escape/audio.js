import { AudioEngine } from '../audio/audio.js';

// The shared engine (wind, leaves, birds, the lake) plus a few small synthesized effects.
export class EscapeAudio extends AudioEngine {
  constructor() {
    super();
    try { this.setMuted(localStorage.getItem('state-property.escape.muted') === '1'); } catch { /* no storage */ }
  }
  setMuted(m) { super.setMuted(m); try { localStorage.setItem('state-property.escape.muted', m ? '1' : '0'); } catch { /* no storage */ } }

  #tone(f0, f1, dur, gain, type = 'sine', delay = 0) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx); o.onended = () => { o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + dur + 0.02);
  }
  #noise(dur, freq, gain, type = 'bandpass', q = 1, to = freq) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx); s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
    s.start(t); s.stop(t + dur + 0.02);
  }

  hop() { this.#noise(0.07, 1400, 0.06, 'bandpass', 0.8, 2600); this.#tone(380, 620, 0.06, 0.025, 'triangle'); }
  land() { this.#noise(0.06, 900, 0.14, 'lowpass', 0.7, 300); this.thud(0.1, 150); }
  clank() { this.#tone(520, 500, 0.35, 0.05, 'triangle'); this.#tone(1310, 1290, 0.25, 0.03); this.thud(0.16, 190); }
  edge() { this.thud(0.06, 120); }
  pinch() { this.click(0.3, 2600, 0.02); this.#tone(700, 160, 0.32, 0.09, 'square'); this.thud(0.3, 110); }
  cast() { this.whoosh(0.45, 0.16); for (let i = 0; i < 6; i++) this.#noise(0.02, 3000, 0.05, 'highpass', 0.5, 3000); }
  miss() { this.whoosh(0.3, 0.12); }
  reel() { for (let i = 0; i < 12; i++) this.#tone(2200, 2100, 0.02, 0.025, 'square', i * 0.045); }
  splash(k = 1) { this.#noise(0.5 * k + 0.1, 1800, 0.35 * k, 'bandpass', 0.6, 380); this.#noise(0.35 * k + 0.08, 500, 0.5 * k, 'lowpass', 0.7, 120); this.#tone(430, 960, 0.12, 0.05 * k, 'sine', 0.12); }
  honk() { this.#tone(330, 320, 0.28, 0.08, 'sawtooth'); this.#tone(415, 405, 0.28, 0.06, 'sawtooth'); this.thud(0.35, 90); this.#noise(0.12, 2400, 0.12, 'bandpass', 0.5, 900); }
  bell() { for (let i = 0; i < 3; i++) { this.#tone(1560, 1540, 0.18, 0.05, 'triangle', i * 0.22); this.#tone(2340, 2320, 0.12, 0.025, 'sine', i * 0.22); } }
  rustle() { this.#noise(0.25, 3200, 0.1, 'bandpass', 0.6, 1400); }
  record() { [660, 880, 1320].forEach((f, i) => this.#tone(f, f, 0.22, 0.06, 'triangle', i * 0.1)); }
}
