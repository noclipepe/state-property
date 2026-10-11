// Input: drag-to-look (never casts), tap/click to cast, keyboard, touch stick and reel button.
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointer already gone */ } };

export class Input {
  constructor(game, canvas, stage) {
    this.game = game;
    this.canvas = canvas;
    this.stage = stage;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.stick = { x: 0, y: 0, id: null };
    this.reelHeld = { key: false, button: false };
    this.drag = null;
    this.hover = null;
    this.enabled = false;

    canvas.addEventListener('pointerdown', (e) => this.#down(e));
    canvas.addEventListener('pointermove', (e) => this.#movePtr(e));
    canvas.addEventListener('pointerup', (e) => this.#up(e));
    canvas.addEventListener('pointercancel', (e) => this.#cancel(e));
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.#key(e, true));
    addEventListener('keyup', (e) => this.#key(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.reelHeld.key = false; this.reelHeld.button = false; this.#reelChanged(); });

    // touch stick
    const st = document.getElementById('stick');
    const knob = st.querySelector('.stick-knob');
    const stickMove = (e) => {
      const r = st.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.stick.x = x; this.stick.y = -y;
      knob.style.transform = `translate(${x * 28}px, ${y * 28}px)`;
    };
    st.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(st, e.pointerId); this.stick.id = e.pointerId; stickMove(e); });
    st.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) stickMove(e); });
    const stickEnd = (e) => { if (e.pointerId !== this.stick.id) return; this.stick = { x: 0, y: 0, id: null }; knob.style.transform = ''; };
    st.addEventListener('pointerup', stickEnd); st.addEventListener('pointercancel', stickEnd);

    // reel button: hold
    const reel = document.getElementById('btn-reel');
    reel.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(reel, e.pointerId); this.reelHeld.button = true; this.#reelChanged(); });
    const reelUp = () => { this.reelHeld.button = false; this.#reelChanged(); };
    reel.addEventListener('pointerup', reelUp); reel.addEventListener('pointercancel', reelUp); reel.addEventListener('lostpointercapture', reelUp);
    reel.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get reeling() { return this.enabled && (this.reelHeld.key || this.reelHeld.button); }
  reset() {
    this.keys.clear(); this.drag = null;
    this.stick = { x: 0, y: 0, id: null }; this.move = { x: 0, y: 0 };
    this.reelHeld = { key: false, button: false };
    document.querySelector('.stick-knob').style.transform = '';
    this.canvas.classList.remove('grabbing'); this.#reelChanged();
  }
  #reelChanged() {
    document.getElementById('btn-reel').classList.toggle('active', this.reeling);
    this.game.onReelChanged?.(this.reeling);
  }

  #local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }
  #down(e) {
    if (!this.enabled) return;
    this.game.gru?.stopShowcase();
    if (this.drag) return; // one look pointer at a time
    capture(this.canvas, e.pointerId);
    const p = this.#local(e);
    this.drag = { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now(), moved: false };
  }
  #movePtr(e) {
    const p = this.#local(e);
    if (!this.drag || e.pointerId !== this.drag.id) {
      if (e.pointerType === 'mouse') this.hover = p;
      return;
    }
    const dx = p.x - this.drag.x, dy = p.y - this.drag.y;
    this.drag.x = p.x; this.drag.y = p.y;
    if (!this.drag.moved && Math.hypot(p.x - this.drag.x0, p.y - this.drag.y0) > 7) {
      this.drag.moved = true;
      this.canvas.classList.add('grabbing');
    }
    if (this.drag.moved) {
      const k = 2.6 / p.h; // radians per stage height
      this.game.player.look(dx * k, dy * k);
    }
    if (e.pointerType === 'mouse') this.hover = p;
  }
  #up(e) {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const d = this.drag;
    this.drag = null;
    this.canvas.classList.remove('grabbing');
    const quick = performance.now() - d.t0 < 450;
    if (!d.moved && quick && this.enabled) {
      const p = this.#local(e);
      this.game.onTap(p.x, p.y, e.pointerType);
    }
  }
  #cancel(e) { if (this.drag && e.pointerId === this.drag.id) { this.drag = null; this.canvas.classList.remove('grabbing'); } }

  #key(e, down) {
    // Bind physical keys so movement and shortcuts survive keyboard layout changes.
    const k = e.code;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (down && e.repeat && k !== 'Space') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (k === 'Space') { this.reelHeld.key = down; this.#reelChanged(); }
    if (!down) return;
    if (k === 'Enter') this.game.onEnter?.();
    if (!this.enabled && k !== 'Escape') return;
    if (this.game.gru) {
      if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyE','KeyF','Space'].includes(k)) this.game.gru.stopShowcase();
      if (k === 'KeyE') this.game.gru.take();
      if ((k === 'KeyF' || k === 'Space') && !e.repeat) this.game.gru.fire();
    }
    if (k === 'KeyX' || k === 'KeyQ') this.game.onRelease();
    if (k === 'KeyR') this.game.reset();
    if (k === 'KeyM') this.game.toggleMute();
    if (k === 'Escape') this.game.onEscape();
    if (k === 'KeyT') this.game.startShowcase();
  }

  update() {
    let x = 0, y = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      x += this.stick.x; y += this.stick.y;
      if ((x || y) && this.game.gru) this.game.gru.stopShowcase();
    }
    this.move.x = x; this.move.y = y;
  }
}
