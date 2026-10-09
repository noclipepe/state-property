// Dialogue manager: verified clips from the meme's original audio, one at a time,
// with cooldowns, no immediate repeats, subtitles and a mouth envelope for lip motion.

export class Dialogue {
  constructor(audio, subtitleEl) {
    this.audio = audio;
    this.el = subtitleEl;
    this.lines = {};
    this.buffers = {};
    this.current = null; // {id, src, start, line}
    this.lastPlayed = {}; // id -> time
    this.queue = []; // reactions waiting to play next
    this._gapTimer = null;
    this._seq = null;
    this.lastId = null;
    this.globalReadyAt = 0;
    this.onLineStart = null;
    this.onLineEnd = null;
    this.subsEnabled = true;
  }

  async load(baseUrl, onProgress) {
    const res = await fetch(baseUrl + 'assets/audio/dialogue.json');
    this.lines = await res.json();
    const ids = Object.keys(this.lines);
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      this.buffers[id] = await this.audio.decode(baseUrl + this.lines[id].file);
      done++; onProgress?.(done / ids.length);
    }));
  }

  now() { return performance.now() / 1000; }
  get speaking() { return !!this.current; }
  get grandpaSpeaking() { return !!this.current && this.lines[this.current.id].speaker === 'grandpa'; }

  /**
   * Pick from a pool, honouring cooldowns. opts: {force, lineCooldown}
   * returns the id played or null
   */
  say(pool, opts = {}) {
    const list = Array.isArray(pool) ? pool : [pool];
    const t = this.now();
    if (this.current && !opts.force) return null;
    if (this.queue.length || this._gapTimer) return null; // a queued reaction / sequence goes first
    if (!opts.force && t < this.globalReadyAt) return null;
    const perLine = opts.lineCooldown ?? 9;
    let cands = list.filter((id) => this.buffers[id] && (opts.force || t - (this.lastPlayed[id] ?? -1e9) > perLine));
    if (cands.length > 1) cands = cands.filter((id) => id !== this.lastId);
    if (!cands.length) return null;
    const id = cands[Math.floor(Math.random() * cands.length)];
    this.#play(id, opts);
    return id;
  }

  /**
   * Play a specific line as soon as possible without overlapping: immediately if nothing is
   * playing, otherwise right after the current line (ahead of the rest of a sequence).
   * onStart runs when the line actually begins (for matching gestures).
   */
  playNext(id, onStart) {
    if (!this.buffers[id]) return false;
    if (!this.current && !this._gapTimer) { this.#play(id); onStart?.(); return true; }
    this.queue.push({ id, onStart });
    return true;
  }

  // play a fixed sequence (intro). Lines queued with playNext() are slotted in between.
  sequence(items) {
    this.reset();
    return new Promise((resolve) => {
      let i = 0;
      const seq = (this._seq = { cancelled: false });
      const next = () => {
        if (seq.cancelled) { resolve(false); return; }
        if (i >= items.length) { this._seq = null; resolve(true); return; }
        const it = items[i++];
        this.#play(it.id, { force: true, onEnd: () => this.#after(next, it.gap ?? 0.25) });
      };
      next();
    });
  }

  // after a line: run queued reactions first, then continue (sequence or nothing)
  #after(cont, gap) {
    this._gapTimer = setTimeout(() => {
      this._gapTimer = null;
      const q = this.queue.shift();
      if (q) {
        this.#play(q.id, { onEnd: () => this.#after(cont || (() => {}), 0.3) });
        q.onStart?.();
      } else cont?.();
    }, gap * 1000);
  }

  #play(id, opts = {}) {
    if (this.current) this.#stopCurrent();
    const line = this.lines[id];
    const src = this.audio.playBuffer(this.buffers[id], this.audio.voice, 1.0);
    const start = this.now() + 0.01;
    this.current = { id, src, start, line };
    this.lastPlayed[id] = start;
    this.lastId = id;
    this.audio.setDucked(true);
    src.onended = () => {
      if (this.current && this.current.src === src) {
        this.current = null;
        this.audio.setDucked(false);
        this.globalReadyAt = this.now() + (opts.gapAfter ?? 1.4);
        this.#setSubtitle(null);
        this.onLineEnd?.(id);
        if (opts.onEnd) opts.onEnd();
        else if (this.queue.length) this.#after(null, 0.3);
      }
    };
    this.onLineStart?.(id, line);
  }

  #stopCurrent() {
    if (!this.current) return;
    const s = this.current.src;
    this.current = null;
    s.onended = null;
    this.audio.stopSource(s);
    this.audio.setDucked(false);
  }

  // stop speech, cancel any sequence, queued reactions and pending gaps
  stop() {
    if (this._seq) { this._seq.cancelled = true; this._seq = null; }
    clearTimeout(this._gapTimer);
    this._gapTimer = null;
    this.queue.length = 0;
    this.#stopCurrent();
    this.#setSubtitle(null);
    this.globalReadyAt = 0;
  }

  // cut the running sequence (and its current line) short, but keep queued reactions
  skipSequence() {
    if (this._seq) { this._seq.cancelled = true; this._seq = null; }
    clearTimeout(this._gapTimer);
    this._gapTimer = null;
    this.#stopCurrent();
    this.#setSubtitle(null);
    if (this.queue.length) this.#after(null, 0.2);
  }

  // full reset for a restart: also forget cooldown / repetition history
  reset() {
    this.stop();
    this.lastPlayed = {};
    this.lastId = null;
  }

  // mouth openness 0..1 for the active grandpa line
  envelope() {
    if (!this.current || this.lines[this.current.id].speaker !== 'grandpa') return 0;
    const t = this.now() - this.current.start;
    const env = this.current.line.env;
    const f = t * 50;
    const i = Math.floor(f);
    if (i < 0 || i >= env.length - 1) return 0;
    const a = env[i], b = env[i + 1];
    return a + (b - a) * (f - i);
  }

  update() {
    if (!this.current) return;
    const t = this.now() - this.current.start;
    const cue = this.current.line.cues.find((c) => t >= c.t0 - 0.05 && t < c.t1 + 0.1);
    this.#setSubtitle(cue ? { text: cue.text, speaker: this.current.line.speaker } : null);
  }

  #setSubtitle(s) {
    const key = s ? s.speaker + '|' + s.text : '';
    if (key === this._subKey) return;
    this._subKey = key;
    if (!s || !this.subsEnabled) { this.el.classList.remove('show'); return; }
    // grandpa's lines are unlabelled (he is on screen); the player's own line gets a small tag
    this.el.innerHTML = '';
    if (s.speaker !== 'grandpa') {
      const w = document.createElement('span'); w.className = 'who'; w.textContent = 'You';
      this.el.append(w);
    }
    const tx = document.createElement('span'); tx.textContent = s.text;
    this.el.append(tx);
    this.el.classList.toggle('you', s.speaker !== 'grandpa');
    this.el.classList.add('show');
  }
}
