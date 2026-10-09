// Web Audio engine: buses, mute, decoded dialogue buffers and procedural sound effects.
// All effects are synthesised at runtime (no sample files besides the verified dialogue).

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 1;
    // gentle limiter so overlapping effects never clip
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.2;
    this.master.connect(this.comp).connect(c.destination);
    this.voice = c.createGain(); this.voice.gain.value = 1.0; this.voice.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.55; this.amb.connect(this.master);
    this.duck = c.createGain(); this.duck.gain.value = 1; // ducks sfx+ambience under dialogue
    this.sfx.disconnect(); this.amb.disconnect();
    this.sfx.connect(this.duck); this.amb.connect(this.duck); this.duck.connect(this.master);
    this.muted = false;
    this.started = false;
    this.noiseBuf = this.#makeNoise(2.0);
    this.brownBuf = this.#makeNoise(4.0, true);
    this.loops = {};
  }

  #makeNoise(seconds, brown = false) {
    const c = this.ctx, n = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  async decode(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('missing ' + url);
    const ab = await res.arrayBuffer();
    return await new Promise((ok, fail) => this.ctx.decodeAudioData(ab, ok, fail));
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.started) { this.started = true; this.#startAmbience(); }
  }

  /**
   * Call synchronously inside a tap/click handler: resumes the context while the browser still
   * counts it as user-initiated, plays a silent tick (older iOS WebKit needs one) and asks iOS to
   * treat the page as media playback (so the ring/silent switch doesn't mute it, Safari 16.4+).
   */
  unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    const c = this.ctx;
    if (c.state !== 'running') c.resume().catch(() => {});
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, c.sampleRate);
      s.connect(c.destination);
      s.start(0);
    } catch { /* closed context */ }
    if (!this.started) { this.started = true; this.#startAmbience(); }
  }
  get running() { return this.ctx.state === 'running'; }
  // pause everything (dialogue clips freeze where they are and continue on resume)
  suspend() { if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }

  setMuted(m) {
    this.muted = m;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 1, t, 0.03);
  }

  // cut the tails of one-shot effects (restart): dip the effects bus and bring it back
  flushSfx() {
    const t = this.ctx.currentTime, g = this.sfx.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.9, t + 0.35);
  }

  setDucked(on) {
    const t = this.ctx.currentTime;
    this.duck.gain.setTargetAtTime(on ? 0.45 : 1, t, on ? 0.05 : 0.3);
  }

  playBuffer(buf, bus = this.voice, gain = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    // short ramps so clips never click
    const t = c.currentTime + 0.01;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    src.connect(g).connect(bus);
    src.start(t);
    src.gainNode = g;
    src.startTime = t;
    return src;
  }
  stopSource(src) {
    if (!src) return;
    const t = this.ctx.currentTime;
    try {
      src.gainNode.gain.cancelScheduledValues(t);
      src.gainNode.gain.setValueAtTime(src.gainNode.gain.value, t);
      src.gainNode.gain.linearRampToValueAtTime(0, t + 0.04);
      src.stop(t + 0.05);
    } catch { /* already stopped */ }
  }

  // ------------------------------------------------------------ helpers
  #noiseSrc(buf = this.noiseBuf, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = loop;
    s.loopStart = 0; s.loopEnd = buf.duration;
    return s;
  }
  #env(g, t, a, peak, d, sustain = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }

  // ------------------------------------------------------------ ambience
  #startAmbience() {
    const c = this.ctx;
    // wind: brown noise, slowly breathing lowpass
    const wind = this.#noiseSrc(this.brownBuf);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const wg = c.createGain(); wg.gain.value = 0.22;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(lp.frequency);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11;
    const lfo2G = c.createGain(); lfo2G.gain.value = 0.08;
    lfo2.connect(lfo2G).connect(wg.gain);
    wind.connect(lp).connect(wg).connect(this.amb);
    wind.start(); lfo.start(); lfo2.start();
    // leaves rustle: highpassed noise with slow amplitude modulation
    const rus = this.#noiseSrc();
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5200; hp.Q.value = 0.6;
    const rg = c.createGain(); rg.gain.value = 0.012;
    const rl = c.createOscillator(); rl.frequency.value = 0.23;
    const rlg = c.createGain(); rlg.gain.value = 0.01;
    rl.connect(rlg).connect(rg.gain);
    rus.connect(hp).connect(rg).connect(this.amb);
    rus.start(); rl.start();
    // pond water: bandpassed noise, volume set by distance each frame
    const wat = this.#noiseSrc();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    const wl = c.createOscillator(); wl.frequency.value = 0.6;
    const wlg = c.createGain(); wlg.gain.value = 0.4;
    const wmod = c.createGain(); wmod.gain.value = 0.6;
    wl.connect(wlg).connect(wmod.gain);
    this.waterGain = c.createGain(); this.waterGain.gain.value = 0.0;
    wat.connect(bp).connect(wmod).connect(this.waterGain).connect(this.amb);
    wat.start(); wl.start();
    // engine idle: low pulses + filtered rumble
    const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 31;
    const eng2 = c.createOscillator(); eng2.type = 'square'; eng2.frequency.value = 15.5;
    const elp = c.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 140; elp.Q.value = 2;
    const eg = c.createGain(); eg.gain.value = 0.0;
    const e2g = c.createGain(); e2g.gain.value = 0.35;
    eng.connect(elp); eng2.connect(e2g).connect(elp);
    const rum = this.#noiseSrc(this.brownBuf);
    const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 220;
    const rumG = c.createGain(); rumG.gain.value = 0.25;
    rum.connect(rlp).connect(rumG).connect(elp);
    this.enginePan = c.createStereoPanner();
    elp.connect(eg).connect(this.enginePan).connect(this.sfx);
    eng.start(); eng2.start(); rum.start();
    this.engineGain = eg;
    // birds
    this.#scheduleBirds();
    // continuous effect loops we modulate every frame
    this.loops.scrape = this.#makeLoop('lowpass', 900, 0.7, this.noiseBuf);
    this.loops.rustle = this.#makeLoop('bandpass', 3000, 0.8, this.noiseBuf);
    this.loops.rumble = this.#makeLoop('lowpass', 140, 1.0, this.brownBuf);
    this.loops.strain = this.#makeTone(1250);
    this.loops.whir = this.#makeWhir();
  }

  #makeLoop(type, freq, q, buf) {
    const c = this.ctx;
    const s = this.#noiseSrc(buf);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
    return { g, f };
  }
  #makeTone(freq) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 1.51;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.3;
    o.connect(g); o2.connect(g2).connect(g);
    g.connect(this.sfx);
    o.start(); o2.start();
    return { g, o, o2 };
  }
  #makeWhir() {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 150;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.5;
    const g = c.createGain(); g.gain.value = 0;
    o.connect(f).connect(g).connect(this.sfx);
    o.start();
    return { g, o };
  }

  #scheduleBirds() {
    const c = this.ctx;
    const chirp = () => {
      if (!this.started) return;
      const t = c.currentTime + 0.05;
      const pan = c.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
      const species = Math.random();
      const notes = species < 0.5 ? 2 + Math.floor(Math.random() * 4) : 1;
      const base = 2400 + Math.random() * 2200;
      let tt = t;
      for (let i = 0; i < notes; i++) {
        const o = c.createOscillator(); o.type = 'sine';
        const g = c.createGain();
        const dur = species < 0.5 ? 0.06 + Math.random() * 0.05 : 0.25 + Math.random() * 0.2;
        const f0 = base * (0.9 + Math.random() * 0.25);
        o.frequency.setValueAtTime(f0, tt);
        if (species < 0.5) o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.3), tt + dur);
        else { o.frequency.exponentialRampToValueAtTime(f0 * 0.75, tt + dur * 0.5); o.frequency.exponentialRampToValueAtTime(f0 * 1.1, tt + dur); }
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.035 + Math.random() * 0.03, tt + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
        o.connect(g).connect(pan);
        o.start(tt); o.stop(tt + dur + 0.02);
        tt += dur + 0.03 + Math.random() * 0.05;
      }
      pan.connect(this.amb);
      setTimeout(chirp, 900 + Math.random() * 3800);
    };
    setTimeout(chirp, 600);
  }

  // ------------------------------------------------------------ per-frame continuous parameters
  /**
   * p: {engine:0..1, enginePan, water:0..1, scrape:0..1, roll:0..1, strain:0..1, reel:0..1}
   */
  update(p) {
    if (!this.started) return;
    const t = this.ctx.currentTime, k = 0.06;
    this.engineGain.gain.setTargetAtTime(0.10 * (p.engine ?? 1), t, 0.2);
    this.enginePan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p.enginePan || 0)), t, 0.1);
    this.waterGain.gain.setTargetAtTime(0.05 * (p.water || 0), t, 0.3);
    const L = this.loops;
    L.scrape.g.gain.setTargetAtTime(0.28 * (p.scrape || 0), t, k);
    L.scrape.f.frequency.setTargetAtTime(500 + 900 * (p.scrape || 0), t, k);
    L.rustle.g.gain.setTargetAtTime(0.10 * Math.min(1, (p.scrape || 0) + (p.roll || 0) * 0.6), t, k);
    L.rumble.g.gain.setTargetAtTime(0.5 * Math.min(1, (p.roll || 0) + (p.scrape || 0) * 0.5), t, k);
    L.strain.g.gain.setTargetAtTime(0.010 * Math.pow(p.strain || 0, 2) * (1 + 1.2 * (p.reelLoad || 0)), t, k);
    L.strain.o.frequency.setTargetAtTime(900 + 700 * (p.strain || 0), t, k);
    L.strain.o2.frequency.setTargetAtTime((900 + 700 * (p.strain || 0)) * 1.51, t, k);
    // the reel labours (lower, louder) under load
    L.whir.g.gain.setTargetAtTime(0.03 * (p.reel || 0) * (1 + 0.8 * (p.reelLoad || 0)), t, 0.03);
    L.whir.o.frequency.setTargetAtTime((120 + 90 * (p.reel || 0)) * (1 - 0.45 * (p.reelLoad || 0)), t, 0.05);
  }

  // ------------------------------------------------------------ one-shots
  click(gain = 0.25, freq = 3500, dur = 0.012) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    const s = this.#noiseSrc(this.noiseBuf, false);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2.5;
    const g = c.createGain();
    this.#env(g, t, 0.001, gain, dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  whoosh(dur = 0.38, gain = 0.35) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    const s = this.#noiseSrc(this.noiseBuf, false);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t); s.stop(t + dur + 0.05);
  }
  zip(dur = 0.5) {
    // line paying out from the spool: fast ticks
    if (!this.started) return;
    const n = Math.floor(dur * 45);
    for (let i = 0; i < n; i++) setTimeout(() => this.click(0.05 * (1 - i / n) + 0.02, 6000, 0.006), i * (1000 * dur / n));
  }
  ping(freq = 3200, gain = 0.12) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    for (const [m, gg] of [[1, 1], [1.47, 0.5], [2.09, 0.3]]) {
      const o = c.createOscillator(); o.frequency.value = freq * m;
      const g = c.createGain();
      this.#env(g, t, 0.002, gain * gg, 0.25);
      o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.3);
    }
  }
  thud(gain = 0.4, freq = 120) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.15);
    const g = c.createGain(); this.#env(g, t, 0.003, gain, 0.18);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.25);
    this.click(gain * 0.4, 800, 0.05);
  }
  creak(gain = 0.12, f0 = 700) {
    // metallic suspension squeak: resonant noise with a pitch glide
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    const dur = 0.25 + Math.random() * 0.35;
    const s = this.#noiseSrc(this.noiseBuf, false);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 28;
    f.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.2), t);
    f.frequency.linearRampToValueAtTime(f0 * (1.15 + Math.random() * 0.25), t + dur);
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 20; f2.frequency.value = f0 * 2.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    g.gain.setValueAtTime(gain, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g); s.connect(f2).connect(g);
    g.connect(this.sfx);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  groan(gain = 0.25) {
    // low body/frame groan when the truck breaks loose
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(52, t + 0.7);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.85);
    this.creak(0.08, 520);
  }
  ratchet(gain = 0.12) { this.click(gain, 2200, 0.02); }

  /**
   * Stylised "blah-blah" speech for invented (non-original) lines: a buzzy source through two
   * vowel formants, one syllable per vowel group of the text, word gaps, a rising end on questions.
   * It is not speech synthesis and imitates nobody. voice: 'driver' (older, lower, raspy) or
   * 'fisherman'. Returns {start, end, syllables: [{t0, t1}], stop()} in AudioContext time; it is
   * scheduled on the context clock, so pausing (suspend) freezes it too.
   */
  babble(text, voice = 'fisherman', { gain = 1.15, when } = {}) {
    const c = this.ctx;
    const V = voice === 'driver'
      ? { f0: 108, shift: 0.92, rasp: 0.32, rate: 0.95, wobble: 0.06 }
      : { f0: 146, shift: 1.04, rasp: 0.12, rate: 1.08, wobble: 0.04 };
    const VOWELS = [[780, 1180], [520, 1760], [340, 2200], [520, 900], [370, 820], [650, 1500]];
    const t0 = when ?? c.currentTime + 0.06;
    const words = String(text).replace(/[^\p{L}\p{N}\s,.!?'-]/gu, ' ').split(/\s+/).filter(Boolean);
    const question = /\?\s*$/.test(text), shout = /!\s*$/.test(text);
    const syl = [];
    let t = t0;
    words.forEach((w, wi) => {
      const n = Math.max(1, Math.min(4, (w.match(/[aeiouy]+/gi) || []).length));
      for (let i = 0; i < n; i++) {
        const dur = (0.075 + Math.random() * 0.06) / V.rate;
        syl.push({ t0: t, t1: t + dur, vowel: VOWELS[Math.floor(Math.random() * VOWELS.length)], stress: i === 0 ? 1 : 0.8 });
        t += dur + 0.018;
      }
      t += (/[,.]$/.test(w) ? 0.16 : 0.045 + Math.random() * 0.04) / V.rate;
      if (wi === words.length - 1) t -= 0.04;
    });
    const end = t;
    // source: buzzy saw + square an octave down + a little breath noise, shaped by two formants
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    const sub = c.createOscillator(); sub.type = 'square';
    const subG = c.createGain(); subG.gain.value = 0.25;
    const src = c.createGain(); src.gain.value = 0.5;
    osc.connect(src); sub.connect(subG).connect(src);
    const noise = this.#noiseSrc();
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1700; nf.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = V.rasp;
    noise.connect(nf).connect(ng).connect(src);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 9;
    const f2g = c.createGain(); f2g.gain.value = 0.6;
    const amp = c.createGain(); amp.gain.value = 0;
    const out = c.createGain(); out.gain.value = gain * (shout ? 1.25 : 1);
    src.connect(f1).connect(amp); src.connect(f2).connect(f2g).connect(amp);
    amp.connect(out).connect(this.voice);
    syl.forEach((s, i) => {
      const last = i >= syl.length - 2;
      let p = V.f0 * (1 + (Math.random() - 0.5) * 0.22) * (1 - i * 0.012);
      if (question && last) p *= 1.18 + (i === syl.length - 1 ? 0.15 : 0);
      if (shout) p *= 1.15;
      osc.frequency.setValueAtTime(p, s.t0);
      osc.frequency.linearRampToValueAtTime(p * (1 + (Math.random() - 0.5) * V.wobble * 2), s.t1);
      sub.frequency.setValueAtTime(p / 2, s.t0);
      f1.frequency.setValueAtTime(s.vowel[0] * V.shift, s.t0);
      f2.frequency.setValueAtTime(s.vowel[1] * V.shift, s.t0);
      const peak = 1.6 * s.stress;
      amp.gain.setValueAtTime(0, s.t0);
      amp.gain.linearRampToValueAtTime(peak, s.t0 + 0.014); // a soft "b"-like onset
      amp.gain.setValueAtTime(peak * 0.85, s.t1 - 0.03);
      amp.gain.linearRampToValueAtTime(0, s.t1);
    });
    for (const o of [osc, sub, noise]) { o.start(t0); o.stop(end + 0.1); }
    const nodes = [osc, sub, noise];
    return {
      start: t0, end, syllables: syl,
      stop: () => {
        const n = c.currentTime;
        out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(0, n + 0.03);
        for (const o of nodes) { try { o.stop(n + 0.04); } catch { /* already stopped */ } }
      },
    };
  }
}
