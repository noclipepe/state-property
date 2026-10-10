import { AudioEngine } from '../audio/audio.js';

// One voice bus, one continuously changing filter. Surfacing never restarts a clip.
export class FishAudio extends AudioEngine {
  constructor() {
    super();
    const c = this.ctx;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.55;
    this.filter.frequency.value = 780;
    this.voice.disconnect();
    this.voice.connect(this.filter).connect(this.master);
    this.outside = c.createBiquadFilter();
    this.outside.type = 'lowpass';
    this.outside.frequency.value = 650;
    this.duck.disconnect();
    this.duck.connect(this.outside).connect(this.master);
    this.waterSfx = c.createGain();
    this.waterSfx.gain.value = 0.38;
    // Nearby water stays audible; the outside world is filtered separately.
    this.waterDuck = c.createGain();
    this.waterSfx.connect(this.waterDuck).connect(this.master);
    this.oneshots = new Set();
  }

  setDepth(submerged) {
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(16000 * Math.pow(780 / 16000, submerged), t, 0.07);
    this.voice.gain.setTargetAtTime(1 - submerged * 0.2, t, 0.07);
    this.outside.frequency.setTargetAtTime(12000 * Math.pow(650 / 12000, submerged), t, 0.09);
  }

  setDucked(on) {
    super.setDucked(on);
    this.waterDuck.gain.setTargetAtTime(on ? 0.7 : 1, this.ctx.currentTime, 0.06);
  }

  bubble(size = 1) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(430 / size, t);
    o.frequency.exponentialRampToValueAtTime(960 / size, t + 0.085);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.waterSfx);
    this.oneshots.add(o);
    o.onended = () => { o.disconnect(); g.disconnect(); this.oneshots.delete(o); };
    o.start(t); o.stop(t + 0.18);
  }

  splash(strength = 1) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf;
    bp.type = 'bandpass'; bp.Q.value = 0.6;
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * strength, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    s.connect(bp).connect(g).connect(this.waterSfx);
    this.oneshots.add(s);
    s.onended = () => { s.disconnect(); bp.disconnect(); g.disconnect(); this.oneshots.delete(s); };
    s.start(t); s.stop(t + 0.57);
    const body=c.createBufferSource(), low=c.createBiquadFilter(), weight=c.createGain();
    body.buffer=this.brownBuf; low.type='lowpass'; low.frequency.value=600;
    weight.gain.setValueAtTime(0,t); weight.gain.linearRampToValueAtTime(strength*1.2,t+0.025);
    weight.gain.exponentialRampToValueAtTime(0.0001,t+0.42);
    body.connect(low).connect(weight).connect(this.waterSfx); this.oneshots.add(body);
    body.onended=()=>{body.disconnect();low.disconnect();weight.disconnect();this.oneshots.delete(body);};
    body.start(t);body.stop(t+0.45);
    this.bubble(1.3);
  }

  bucketHit() { this.thud(0.55,180); this.ping(1100,0.22); }

  flop(strength=1) {
    if(!this.running) return;
    this.thud(0.2*strength,115);
    this.click(0.22*strength,850,0.07);
  }

  flushSfx() {
    for (const s of this.oneshots) { try { s.stop(); } catch { /* Already ended. */ } }
    this.oneshots.clear();
    super.flushSfx();
  }
}
