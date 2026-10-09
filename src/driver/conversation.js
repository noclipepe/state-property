// Dialogue state machine for the driver POV mode.
//
//   opening -> choose(k) --canonical--> driver -> fisherman -> choose(k+1) ... -> hook
//                        --alternative--> altDriver -> altFisherman -> choose(k)   (text only)
//                                                                   \-> end (an alternative with an ending)
//
// Canonical choices play one continuous clip of the original recording (the driver's lines and
// the fisherman's replies, interjections and pauses exactly as recorded). The phase switches from
// 'driver' to 'fisherman' at the clip's final reply. Cue timing follows the audio clock, so
// subtitles and gestures stay in sync with the voices. Alternatives never use the recording: their
// lines get a synthesised "blah-blah" mumble (AudioEngine.babble) for as long as the text needs.
// Every scheduled callback carries the epoch it was created in; reset() bumps the epoch, stops
// the clip and clears the timeline, so nothing from a previous run can fire after a restart.
import { MENUS, CLIP_ACTIONS } from './script.js';

export class Timeline {
  constructor() { this.t = 0; this.items = []; }
  after(sec, fn) { this.items.push({ at: this.t + sec, fn }); }
  update(dt) {
    this.t += dt;
    const due = this.items.filter((it) => it.at <= this.t);
    if (!due.length) return;
    this.items = this.items.filter((it) => it.at > this.t);
    for (const it of due) it.fn();
  }
  clear() { this.items.length = 0; }
}

export class Conversation {
  /**
   * deps: {audio, clips: {id: {buffer, line}}, ui, onAction(who, action, arg), onEvent(name, data)}
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.timeline = new Timeline();
    this.epoch = 0;
    this.reset();
  }

  reset() {
    this.epoch++;
    this.timeline.clear();
    this.#stopClip();
    this.#stopBabble();
    this.state = 'idle';
    this.step = 0; // current decision point
    this.played = {}; // clip id -> true once its exchange has played
    this.history = []; // [{step, option}] for tests / debugging
    this.ui.hideChoices();
    this.ui.setSubtitle(null);
  }

  get speakerEnv() {
    if (this.clip) return this.#envAt(this.clip, this.#clipTime());
    const b = this.babble, t = this.audio.ctx.currentTime;
    const s = b?.syllables.find((q) => t >= q.t0 && t < q.t1);
    return s ? 0.35 + 0.6 * Math.sin(Math.PI * (t - s.t0) / (s.t1 - s.t0)) : 0;
  }
  /** 'driver' | 'fisherman' | null for whoever is audible right now */
  get speaker() {
    if (this.clip) {
      const cue = this.#cueAt(this.#clipTime());
      return cue ? cue.speaker : null;
    }
    const b = this.babble, t = this.audio.ctx.currentTime;
    return b && t >= b.start && t < b.end ? b.who : null;
  }

  // ------------------------------------------------------------------ flow
  begin(openingSeconds) {
    this.reset();
    this.state = 'opening';
    this.#later(openingSeconds, () => this.#enterChoose(0));
  }

  #later(sec, fn) {
    const ep = this.epoch;
    this.timeline.after(sec, () => { if (ep === this.epoch) fn(); });
  }

  #enterChoose(k) {
    this.state = 'choose';
    this.step = k;
    this.ui.setSubtitle(null);
    this.ui.showChoices(MENUS[k].options.map((o) => o.label), (i) => this.choose(k, i));
    this.onEvent?.('menu', k);
  }

  /** a choice from the menu (button, key or test). Ignored unless that exact menu is waiting. */
  choose(k, i) {
    if (this.state !== 'choose' || k !== this.step) return false;
    const opt = MENUS[k].options[i];
    if (!opt) return false;
    this.ui.hideChoices(); // also disables the buttons before anything else can click
    this.#stopBabble(); // a grumble in progress gives way
    this.history.push({ step: k, option: i });
    if (opt.clip) this.#playExchange(opt.clip);
    else this.#playAlternative(opt);
    return true;
  }

  #playExchange(id) {
    if (this.played[id]) return; // each original exchange plays exactly once per run
    this.played[id] = true;
    const c = this.clips[id];
    this.state = 'driver';
    this.#stopBabble();
    this.clip = { id, line: c.line, src: this.audio.playBuffer(c.buffer, this.audio.voice, 1.0), actions: (CLIP_ACTIONS[id] || []).slice(), cueKey: '' };
    this.clip.start = this.clip.src.startTime;
    this.audio.setDucked(true);
    this.onEvent?.('exchange', id);
  }

  #playAlternative(opt) {
    this.state = 'altDriver';
    this.ui.setSubtitle({ who: 'driver', text: opt.label, textOnly: true });
    this.onAction?.('d', 'textLine');
    const said = this.#mumble('driver', opt.label);
    this.#later(Math.max(1.4, said + 0.45), () => {
      this.state = 'altFisherman';
      this.ui.setSubtitle({ who: 'fisherman', text: opt.reply, textOnly: true });
      this.onAction?.('f', 'textReply');
      const answered = this.#mumble('fisherman', opt.reply);
      this.#later(Math.max(1.8, answered + 0.8), () => {
        if (!opt.ending) { this.#enterChoose(this.step); return; }
        this.ui.setSubtitle(null);
        this.state = 'end';
        this.onEvent?.('altEnding', opt.ending);
      });
    });
  }

  #finishExchange() {
    const id = this.clip.id;
    this.#stopClip();
    this.ui.setSubtitle(null);
    if (this.step < MENUS.length - 1) {
      this.state = 'between';
      this.#later(0.35, () => this.#enterChoose(this.step + 1));
    } else {
      this.state = 'hook';
      this.onEvent?.('conversationDone', id);
    }
  }

  /** set by the game when the hook / drag sequence advances */
  setState(s) { this.state = s; }

  /**
   * The fisherman grumbles (no subtitle) if nobody is talking and he is just waiting for your
   * answer; returns false otherwise, so nothing ever talks over the original recording.
   */
  grumble(text) {
    if (this.state !== 'choose' || this.clip || this.#babbling) return false;
    this.#mumble('fisherman', text);
    return true;
  }

  // ------------------------------------------------------------------ the blah-blah voice
  get #babbling() { return !!this.babble && this.audio.ctx.currentTime < this.babble.end; }
  #mumble(who, text) {
    this.#stopBabble();
    this.babble = { ...this.audio.babble(text, who), who };
    this.audio.setDucked(true);
    return this.babble.end - this.audio.ctx.currentTime;
  }
  #stopBabble() {
    if (!this.babble) return;
    this.babble.stop();
    this.babble = null;
    if (!this.clip) this.audio.setDucked(false);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    this.timeline.update(dt);
    if (this.babble && this.audio.ctx.currentTime > this.babble.end + 0.1) this.#stopBabble();
    const c = this.clip;
    if (!c) return;
    const t = this.#clipTime();
    // phase: the fisherman's final reply starts at replyAt
    this.state = t >= c.line.replyAt ? 'fisherman' : 'driver';
    // performance cues (each exactly once)
    while (c.actions.length && c.actions[0][0] <= t) {
      const [, who, action, arg, extra] = c.actions.shift();
      this.onAction?.(who, action, arg, extra);
    }
    const cue = this.#cueAt(t);
    const key = cue ? cue.t0 + cue.text : '';
    if (key !== c.cueKey) {
      c.cueKey = key;
      this.ui.setSubtitle(cue ? { who: cue.speaker, text: cue.text } : null);
    }
    if (t >= c.line.duration) this.#finishExchange();
  }

  #clipTime() { return this.audio.ctx.currentTime - this.clip.start; }
  #cueAt(t) { return this.clip.line.cues.find((q) => t >= q.t0 - 0.04 && t < q.t1 + 0.12) || null; }
  #envAt(c, t) {
    const env = c.line.env, f = t * 50, i = Math.floor(f);
    if (i < 0 || i >= env.length - 1) return 0;
    return env[i] + (env[i + 1] - env[i]) * (f - i);
  }

  #stopClip() {
    if (!this.clip) return;
    this.audio.stopSource(this.clip.src);
    this.clip = null;
    this.audio.setDucked(false);
  }
}
