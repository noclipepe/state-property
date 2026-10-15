import { GodAudio } from '../god/audio.js';

// The God POV's spatial dialogue (the original recording from two emitters in the scene), plus
// a mix-wide low-pass for the underwater ending and a few restrained effects. The divine choir
// is never prepared here.
export class TreeAudio extends GodAudio {
  constructor() {
    super();
    const c = this.ctx;
    this.muffle = c.createBiquadFilter();
    this.muffle.type = 'lowpass'; this.muffle.Q.value = 0.5; this.muffle.frequency.value = 20000;
    this.master.disconnect();
    this.master.connect(this.muffle).connect(this.comp);
  }

  underwater(amount) {
    if (this.ctx.state === 'closed') return;
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(480 / 20000, amount), this.ctx.currentTime, 0.05);
  }

  /** a slice of the original recording from one man's emitter: {offset, duration, rate} */
  say(who, { offset, duration, rate = 1, gain = 1.3 }) {
    if (this.ctx.state === 'closed' || !this.dialogue) return null;
    const c = this.ctx, t = c.currentTime + 0.01, len = duration / rate;
    for (const [name, { gain: g }] of Object.entries(this.speech.speakers)) {
      g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(name === who ? 1 : 0, t);
    }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = this.dialogue.buffer; src.playbackRate.value = rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + len - 0.06); g.gain.linearRampToValueAtTime(0, t + len);
    src.connect(g).connect(this.voice);
    src.start(t, offset, duration + 0.02);
    this.effects.add(src);
    src.onended = () => { this.effects.delete(src); src.disconnect(); g.disconnect(); };
    return { start: t, offset, rate, len };
  }

  #tone(freq, delay, dur, gain, type = 'sine') {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx); this.effects.add(o);
    o.onended = () => { this.effects.delete(o); o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + dur + 0.02);
  }

  #noise(dur, freq, gain, { type = 'bandpass', q = 0.8, to = freq, brown = false, delay = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = brown ? this.brownBuf : this.noiseBuf; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx); this.effects.add(s);
    s.onended = () => { this.effects.delete(s); s.disconnect(); f.disconnect(); g.disconnect(); };
    s.start(t); s.stop(t + dur + 0.02);
  }

  /** suspicion cues: a soft blip for "distracted", a rising pair for "suspicious", a sting when spotted */
  alert(level) {
    if (!this.running) return;
    if (level === 1) this.#tone(660, 0, 0.18, 0.045, 'triangle');
    if (level === 2) { this.#tone(700, 0, 0.14, 0.055, 'triangle'); this.#tone(940, 0.11, 0.2, 0.06, 'triangle'); }
    if (level === 3) { this.#tone(520, 0, 0.12, 0.08, 'square'); this.#tone(1040, 0.06, 0.32, 0.07, 'triangle'); this.thud(0.25, 90); }
  }
  leaves(gain = 0.12) { if (this.running) this.#noise(0.35, 2600, gain, { to: 900, q: 0.5 }); }
  bend() { if (this.running) { this.creak(0.16, 320); this.#noise(0.5, 420, 0.08, { brown: true, type: 'lowpass', to: 180 }); } }
  crack() {
    if (!this.running) return;
    this.#noise(0.09, 3200, 0.55, { type: 'highpass', q: 0.4, to: 1600 });
    this.#noise(0.16, 1400, 0.4, { q: 0.7, to: 500, delay: 0.035 });
    this.thud(0.55, 85); this.creak(0.12, 520);
  }
  splash(strength = 1) {
    if (!this.running) return;
    this.#noise(0.6, 1900, 0.55 * strength, { q: 0.6, to: 360 });
    this.#noise(0.5, 600, 1.1 * strength, { brown: true, type: 'lowpass', to: 120 });
    for (let i = 0; i < 6; i++) this.bubble(0.8 + Math.random() * 0.8, 0.15 + i * 0.11);
  }
  bubble(size = 1, delay = 0) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(420 / size, t); o.frequency.exponentialRampToValueAtTime(950 / size, t + 0.08);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.sfx); this.effects.add(o);
    o.onended = () => { this.effects.delete(o); o.disconnect(); g.disconnect(); };
    o.start(t); o.stop(t + 0.17);
  }
}
