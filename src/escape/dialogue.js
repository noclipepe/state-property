// Lines from the original argument (assets/audio/ant_argument.mp3, the verified recording with its
// cues) in FISH ESCAPE: the opening exchange over the familiar shot (opening()), then a line every
// 14–22 s in the background, and a fitting line when a run ends. Each line shows as a caption while
// it plays, and speech() tells the characters who is talking and how loud (mouths follow it).
const OPENING = [0, 3];                 // "Who told you you could fish here?" … "STATE?!" "Yeah."
const AMBIENT = [[4, 7], [8, 10], [12, 13], [15, 16], [17, 17], [18, 18], [20, 21], [9, 10], [2, 2]];
const ON_END = { hook: [21, 21], car: [8, 8], swept: [9, 10], crab: [6, 7] };
const FIRST_GAP = [6, 8], GAP = [14, 22];

export class EscapeDialogue {
  constructor(audio, ui) { Object.assign(this, { audio, ui }); this.ready = false; this.reset(); }

  async load() {
    try {
      const res = await fetch('assets/audio/ant_dialogue.json');
      const line = (await res.json()).ant_argument;
      this.cues = line.cues; this.env = line.env || []; this.buffer = await this.audio.decode(line.file); this.ready = true;
    } catch (e) { console.warn('dialogue unavailable', e); }
  }

  reset() { this.stop(); this.opened = false; this.wait = null; this.last = this.last ?? -1; }

  stop() {
    if (this.src) { try { this.src.stop(); } catch { /* ended */ } this.src = null; }
    this.playing = null; this.ui?.line(null);
  }

  /** play cues a..b (inclusive) as one stretch of the recording */
  #play([a, b]) {
    if (!this.ready || !this.audio.running) return false;
    this.stop();
    const c = this.audio.ctx, from = Math.max(0, this.cues[a].t0 - 0.06), to = this.cues[b].t1 + 0.12, t = c.currentTime + 0.02;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = this.buffer; g.gain.value = 1.25;
    src.connect(g).connect(this.audio.voice);
    src.start(t, from, to - from);
    src.onended = () => { src.disconnect(); g.disconnect(); if (this.src === src) { this.src = null; this.playing = null; this.ui.line(null); } };
    this.src = src; this.playing = { start: t - from, a, b, end: t + (to - from) };
    return true;
  }

  /** the opening exchange (the first run's scene); returns the seconds until its first line ends
   *  (the shot lasts that long; the rest plays on behind the run), or 0 without sound */
  opening() {
    if (!this.#play(OPENING)) return 0;
    this.opened = this.heard = true; this.wait = rand(FIRST_GAP);
    return this.playing.start + this.cues[OPENING[0]].t1 - this.audio.ctx.currentTime;
  }

  /** seconds into the recording being heard (0 when nothing plays) */
  get elapsed() { return this.playing ? this.audio.ctx.currentTime - this.playing.start : 0; }

  /** who is speaking now and the loudness of the voice (0…1), from the recording's envelope */
  speech() {
    if (!this.playing) return { speaker: null, env: 0 };
    const t = this.elapsed, cue = this.cues.slice(this.playing.a, this.playing.b + 1).find((q) => t >= q.t0 && t < q.t1);
    const i = t * 50, k = Math.floor(i), env = (this.env[k] || 0) * (1 - (i - k)) + (this.env[k + 1] || 0) * (i - k);
    return { speaker: cue?.speaker || null, env: cue ? env : 0 };
  }

  #pick() { let k; do k = Math.floor(Math.random() * AMBIENT.length); while (k === this.last); return k; }

  /** a line for how the run ended */
  end(cause) { if (ON_END[cause]) this.#play(ON_END[cause]); }

  update(dt, playing) {
    if (!this.ready) return;
    // the opening exchange waits for the first moment sound is allowed (the first tap on a phone)
    // later runs open with a random line instead, so retries don't repeat the same five seconds
    if (!this.opened && playing && this.audio.running) {
      const k = this.heard ? this.#pick() : -1;
      if (this.#play(k < 0 ? OPENING : AMBIENT[k])) { this.opened = this.heard = true; if (k >= 0) this.last = k; this.wait = rand(FIRST_GAP); }
    }
    else if (this.opened && playing && !this.playing) {
      this.wait -= dt;
      if (this.wait <= 0) {
        const k = this.#pick();
        if (this.#play(AMBIENT[k])) this.last = k;
        this.wait = rand(GAP);
      }
    }
    // caption: the cue being heard right now
    if (this.playing) {
      const t = this.audio.ctx.currentTime - this.playing.start;
      let cue = null;
      for (let i = this.playing.a; i <= this.playing.b; i++) { const q = this.cues[i]; if (t >= q.t0 - 0.05 && t < q.t1 + 0.25) cue = q; }
      this.ui.line(cue);
    }
  }
}
const rand = ([a, b]) => a + Math.random() * (b - a);
