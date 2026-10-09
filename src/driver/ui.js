// DOM overlay for the driver POV game: branded loading / pause / end screens, the small in-game
// HUD, the three dialogue buttons, speaker-labelled subtitles, the first-play hint, "Tap for
// sound" and the creator links (from SITE). "Back to games" leaves for the series menu.
import { SITE } from '../site-config.js';
import { track } from '../analytics.js';

const $ = (id) => document.getElementById(id);
const HINT_KEY = 'spsim.hintSeen';

// A button press that survives touch quirks: a finger lifted on the button without sliding counts
// as a press right away (some browsers drop the click of the first tap after a quick swipe, e.g.
// right after looking around); mouse and keyboard use the normal click. Never fires twice.
function onPress(el, fn) {
  let down = null, last = -1e9;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') down = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12;
    down = null;
    const r = el.getBoundingClientRect();
    if (moved || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom || el.disabled) return;
    last = performance.now();
    fn(e);
  });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('click', (e) => { if (performance.now() - last > 800) fn(e); });
}

const ENDINGS = {
  dragged: {
    title: 'Reeled in.',
    text: 'He hooked your truck and hauled it to the pond. Turns out it was his property now.',
  },
  left: {
    title: 'Peaceful ending.',
    text: 'He packed up and walked off. Calm, legal, and nobody filmed it. Try another answer to see what really happened.',
  },
};

export class DriverUI {
  constructor(game) {
    this.game = game;
    this.stage = $('stage');
    this.start = $('start');
    this.choicesEl = $('choices');
    this.subEl = $('subtitle');
    this.buttons = [...this.choicesEl.querySelectorAll('button')];
    this.onPick = null;

    // creator links from the config: tracked, and a game in progress pauses before the link opens
    for (const a of document.querySelectorAll('a[data-link]')) {
      const key = a.dataset.link;
      if (SITE.links[key]) a.href = SITE.links[key]; else a.hidden = true;
      a.addEventListener('click', () => {
        track(`${key}_clicked`, { from: a.closest('section')?.id || 'hud' });
        game.pauseForLink?.();
      });
    }

    // buttons never leak a press to the look-drag on the canvas behind them
    for (const b of this.stage.querySelectorAll('button, a')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
    onPress($('btn-retry'), () => location.reload());
    onPress($('btn-sound'), () => game.toggleMute());
    onPress($('btn-menu-sound'), () => game.toggleMute());
    onPress($('btn-restart'), () => { track('replay_clicked', { from: 'hud' }); game.reset(); });
    onPress($('btn-pause'), () => game.pause('menu'));
    onPress($('btn-resume'), () => game.resume());
    onPress($('btn-menu-restart'), () => { track('replay_clicked', { from: 'menu' }); game.resume({ restart: true }); });
    onPress($('btn-again'), () => { track('replay_clicked', { from: 'end' }); game.reset(); });
    onPress($('btn-games'), () => game.backToGames());
    onPress($('btn-other'), () => game.backToGames());
    onPress($('btn-unmute'), () => game.unlockAudio());
    onPress($('btn-finger'), () => game.flipOff());
    const fs = $('btn-fullscreen');
    const fsEl = document.documentElement;
    if (fsEl.requestFullscreen && document.fullscreenEnabled) {
      fs.hidden = false;
      onPress(fs, () => {
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else fsEl.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      });
      document.addEventListener('fullscreenchange', () => { fs.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
    }
    this.buttons.forEach((b, i) => onPress(b, () => this.pick(i)));
  }

  // ------------------------------------------------------------------ start + loading
  /** state: 'idle' (hidden: playing) | 'waiting' (no numbers yet) | 'progress' | 'failed' */
  setLoading(state, p = 0, label = '') {
    const s = this.start;
    s.hidden = state === 'idle';
    s.classList.toggle('loading', state !== 'idle');
    s.classList.toggle('indeterminate', state === 'waiting');
    s.classList.toggle('failed', state === 'failed');
    $('btn-retry').hidden = state !== 'failed';
    if (state === 'progress') $('load-fill').style.width = Math.round(p * 100) + '%';
    $('load-text').textContent = state === 'failed' ? "Couldn't load the game. Check your connection." : state === 'waiting' ? 'Loading…' : `${label || 'Loading…'} ${Math.round(p * 100)}%`;
  }

  showHud(on) { $('hud').hidden = !on; }
  setMuted(m) {
    $('btn-sound').classList.toggle('muted', m);
    $('btn-sound').setAttribute('aria-label', m ? 'Sound on' : 'Sound off');
    $('btn-menu-sound').textContent = m ? 'Sound: off' : 'Sound: on';
  }
  toggleHud() { this.stage.classList.toggle('rec'); }
  showUnmute(on) { $('btn-unmute').hidden = !on; }

  // ------------------------------------------------------------------ pause / end
  showPause(on, reason) {
    $('pause').hidden = !on;
    $('pause-note').hidden = reason !== 'hidden';
    if (on) $('btn-resume').focus({ preventScroll: true });
  }
  get pauseOpen() { return !$('pause').hidden; }

  showEnd(outcome) {
    const e = ENDINGS[outcome] || ENDINGS.dragged;
    $('end-title').textContent = e.title;
    $('end-text').textContent = e.text;
    $('end').hidden = false;
    this.hideChoices();
    this.setSubtitle(null);
  }
  hideEnd() { $('end').hidden = true; }

  reset() {
    this.hideChoices();
    this.setSubtitle(null);
    this.hideEnd();
    this.hideHint(true);
  }

  // ------------------------------------------------------------------ first-play hint (once per browser)
  maybeShowHint() {
    try { if (localStorage.getItem(HINT_KEY)) return; } catch { /* storage blocked: show it this time */ }
    const touch = document.documentElement.classList.contains('touch');
    const el = $('hint');
    el.textContent = touch ? 'Drag to look around · tap an answer' : 'Drag (or arrow keys) to look · click an answer';
    el.classList.remove('out');
    el.hidden = false;
    clearTimeout(this.hintT);
    this.hintT = setTimeout(() => this.hideHint(), 5000);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* fine */ }
  }
  hideHint(now = false) {
    const el = $('hint');
    clearTimeout(this.hintT);
    if (el.hidden) return;
    if (now) { el.hidden = true; return; }
    el.classList.add('out');
    this.hintT = setTimeout(() => { el.hidden = true; }, 400);
  }

  // ------------------------------------------------------------------ dialogue
  /** three identical buttons; the first click (or key) wins and disables them all */
  showChoices(labels, onPick) {
    this.onPick = onPick;
    this.buttons.forEach((b, i) => {
      b.querySelector('.label').textContent = labels[i] || '';
      b.disabled = false;
      b.style.animationDelay = (i * 0.06) + 's';
    });
    this.choicesEl.hidden = false;
    this.choicesEl.classList.remove('show');
    void this.choicesEl.offsetWidth; // restart the entrance animation
    this.choicesEl.classList.add('show');
  }

  hideChoices() {
    this.onPick = null;
    for (const b of this.buttons) b.disabled = true;
    this.choicesEl.classList.remove('show');
    this.choicesEl.hidden = true;
  }

  get choicesVisible() { return !!this.onPick; }

  pick(i) {
    const cb = this.onPick;
    if (!cb || this.game.paused) return false;
    this.onPick = null;
    for (const b of this.buttons) b.disabled = true;
    this.hideHint();
    return cb(i);
  }

  /** s: {who: 'driver'|'fisherman', text, textOnly} or null */
  setSubtitle(s) {
    const key = s ? s.who + '|' + s.text + '|' + !!s.textOnly : '';
    if (key === this._subKey) return;
    this._subKey = key;
    const el = this.subEl;
    if (!s) { el.classList.remove('show'); return; }
    el.innerHTML = '';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = s.who === 'driver' ? 'You' : 'Fisherman';
    const tx = document.createElement('span');
    tx.className = 'text';
    tx.textContent = s.text;
    el.append(who, tx);
    el.classList.toggle('you', s.who === 'driver');
    el.classList.toggle('textonly', !!s.textOnly);
    el.classList.add('show');
  }

  // ------------------------------------------------------------------ toast
  toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { el.hidden = true; }, ms);
  }

}
