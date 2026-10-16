import { V } from '../god/common.js';

const $ = (id) => document.getElementById(id);
const STATES = ['UNAWARE', 'DISTRACTED', 'SUSPICIOUS', 'SPOTTED YOU'];
const NAMES = { fisherman: 'fisherman', driver: 'driver' };

export class TreeUI {
  constructor(game) {
    this.g = game;
    const on = (id, fn) => $(id).addEventListener('click', fn, { signal: game.abort.signal });
    on('btn-enter', () => game.start());
    on('btn-retry', () => location.reload());
    on('btn-again', () => game.restart());
    on('btn-restart', () => game.restart());
    on('btn-sound', () => game.toggleMute());
    $('btn-menu').addEventListener('click', () => game.destroy(), { signal: game.abort.signal });
    const touch = document.documentElement.classList.contains('touch');
    $('hint').textContent = touch ? 'Drag to look around · touch and hold on someone to zoom in with the binoculars · let go to hide'
      : 'Drag to look around · hold the mouse button on someone (or right button / Space) for the binoculars · release to hide';
    $('how').innerHTML = touch ? 'Drag to look around. Touch and hold: binoculars up, drag to aim.<br>Let go to hide in the leaves. Don\'t stare too long.'
      : 'Drag to look around. Hold the mouse button (right button or Space: at once)<br>for the binoculars, drag to aim, release to hide. Don\'t stare too long.';
    this.meters = {};
    for (const el of document.querySelectorAll('.meter')) this.meters[el.dataset.who] = { el, fill: el.querySelector('.m-track span'), state: el.querySelector('.m-state'), level: -1 };
    this.lens = $('lens');
    this.reset();
  }

  progress(p, label) { $('load-fill').style.width = `${Math.round(p * 100)}%`; $('load-text').textContent = label; }
  failed() { $('load-text').textContent = 'Could not load the scene. Please try again.'; $('btn-retry').hidden = false; }
  ready() { $('start').classList.remove('loading'); $('btn-enter').hidden = false; $('btn-enter').focus({ preventScroll: true }); }
  begin() { $('start').hidden = true; $('hud').hidden = false; this.g.canvas.focus({ preventScroll: true }); }
  reset() {
    $('end').hidden = true; $('callout').hidden = true; this.calloutWho = null;
    this.raisedFor = 0; this.hintGone = false; $('hint').classList.remove('gone');
    for (const m of Object.values(this.meters)) { m.el.hidden = true; m.level = -1; }
    this.setSubtitle(null); $('announce').textContent = '';
  }

  /** binocular lenses sized to the screen; returns the angular radius of one lens (radians) */
  layout(w, h) {
    // Drawn once per resize on a plain 2D canvas (SVG masks with filters fail in mobile Safari):
    // a dark frame with two overlapping, soft-edged circles cut out of it.
    const r = Math.min(0.46 * h, 0.52 * w), cx = w / 2, cy = h / 2, off = r * 0.55, c = this.lens;
    const dpr = Math.min(2, window.devicePixelRatio || 1), ctx = c.getContext('2d');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.dataset.r = r.toFixed(1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#040605'; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    for (const x of [cx - off, cx + off]) {
      const grad = ctx.createRadialGradient(x, cy, r * 0.93, x, cy, r * 1.01);
      grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, cy, r * 1.02, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx - off * 0.4, cy - r * 0.15, r * 0.82, 0, Math.PI * 2); ctx.stroke();
    return r;
  }

  setSubtitle(cue) {
    const el = $('subtitle'); el.replaceChildren();
    if (!cue) return;
    const who = document.createElement('span'); who.className = 'who'; who.textContent = cue.who === 'driver' ? 'DRIVER' : 'FISHERMAN';
    el.append(who, document.createTextNode(cue.text));
  }

  announce(w, level) {
    const lines = ['is calm again.', 'looks distracted.', 'is looking toward the tree. Hide!', 'spotted you.'];
    $('announce').textContent = `The ${NAMES[w.who]} ${lines[level]}`;
  }

  callout(who) { this.calloutWho = who; $('callout').hidden = false; }
  flash() { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

  /** score: seconds spent watching them through the binoculars; best: the previous personal best */
  showEnd(score, by, best) {
    $('end-score').textContent = `${score.toFixed(1)} s`;
    $('end-detail').textContent = `watching them through the binoculars before ${by} spotted you`;
    $('end-best').textContent = score > best ? (best > 0 ? `New personal best! (was ${best.toFixed(1)} s)` : 'Your first record. Can you beat it?') : `Personal best: ${best.toFixed(1)} s`;
    $('end').hidden = false; $('hud').hidden = true; $('btn-again').focus({ preventScroll: true });
  }
  hideEnd() { $('end').hidden = true; $('hud').hidden = false; }

  update(dt) {
    const g = this.g;
    if (!g.watchers) return;
    this.lens.style.opacity = g.state === 'underwater' ? 0 : Math.min(1, g.raise * 1.15).toFixed(3);
    const stance = $('stance'), raised = g.raise > 0.5;
    stance.classList.toggle('hidden', !raised);
    $('stance-text').textContent = g.state === 'caught' || g.state === 'falling' ? 'SPOTTED!' : raised ? `WATCHING · ${g.watchedFor.toFixed(1)} s` : 'HIDDEN IN THE LEAVES';
    stance.hidden = g.state === 'underwater';
    // the hint goes away once the player has tried the binoculars (or after a while)
    if (g.raise > 0.9) this.raisedFor += dt;
    if (!this.hintGone && ((this.raisedFor > 1.2 && g.raise < 0.2) || g.time > 14 || g.state !== 'play')) { this.hintGone = true; $('hint').classList.add('gone'); }
    const playing = g.state === 'play' || g.state === 'caught';
    const spots = {};
    for (const w of g.watchers.list) {
      const show = playing && (w.focus > 0.02 || w.value > 0.06 || w.level > 0);
      const p = show && g.project(g.watchers.head(w.who).add(V(0, 0.42, 0)));
      w.shown = !!p && p.front;
      if (w.shown) spots[w.who] = { x: p.x, y: Math.min(g.size.h - 20, Math.max(118, p.y)) };
    }
    // the two men stand close together: never let their meters cover each other
    const a = spots.fisherman, b = spots.driver;
    const width = (who) => this.meters[who].el.offsetWidth || 170, gap = a && b ? (width('fisherman') + width('driver')) / 2 + 10 : 0;
    if (a && b && Math.abs(a.x - b.x) < gap && Math.abs(a.y - b.y) < 76) {
      const push = (gap - Math.abs(a.x - b.x)) / 2, s = a.x >= b.x ? 1 : -1;
      a.x += push * s; b.x -= push * s;
    }
    // labels stay on screen
    for (const [who, sp] of [['fisherman', a], ['driver', b]]) if (sp) { const half = width(who) / 2 + 6; sp.x = Math.min(g.size.w - half, Math.max(half, sp.x)); }
    for (const w of g.watchers.list) {
      const m = this.meters[w.who], spot = spots[w.who];
      if (!spot) { m.el.hidden = true; continue; }
      m.el.hidden = false; m.spot = spot;
      m.el.style.left = `${spot.x}px`;
      m.el.style.top = `${spot.y}px`;
      m.el.style.opacity = w.focus > 0.02 || w.level > 0 ? 1 : 0.7;
      m.fill.style.width = `${(w.value * 100).toFixed(1)}%`;
      if (m.level !== w.level) { m.level = w.level; m.el.className = `meter lvl${w.level}`; m.state.textContent = STATES[w.level]; }
    }
    if (this.calloutWho) {
      // above his meter (or above his head if the meter is off screen)
      const m = this.meters[this.calloutWho], c = $('callout');
      const p = !m.el.hidden && m.spot ? { x: m.spot.x, y: m.spot.y - 62, front: true } : g.project(g.watchers.head(this.calloutWho).add(V(0, 0.95, 0)));
      c.hidden = !p.front || g.state === 'underwater' || g.state === 'falling';
      c.style.left = `${Math.min(g.size.w - 70, Math.max(70, p.x))}px`; c.style.top = `${Math.min(g.size.h - 30, Math.max(150, p.y))}px`;
    }
    const sound = $('btn-sound');
    sound.textContent = g.audio.muted ? 'SOUND OFF' : 'SOUND ON'; sound.setAttribute('aria-pressed', String(!g.audio.muted));
  }
}
