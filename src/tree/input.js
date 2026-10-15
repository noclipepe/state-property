// Drag (mouse or finger) to look around. Press and hold still for a moment to raise the
// binoculars, then keep dragging to aim; release to lower them behind the leaves.
// The right mouse button and Space raise them straight away. Arrow keys look/aim too.
const HOLD_SECONDS = 0.24, SLOP_MOUSE = 9, SLOP_TOUCH = 16;

export class TreeInput {
  constructor(game) {
    this.g = game; this.keys = new Set(); this.pointer = null;
    const c = game.canvas, opt = { signal: game.abort.signal };
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      if (this.pointer || !game.controllable) return;
      e.preventDefault(); game.audio.unlock();
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      // 'pending' becomes 'look' once it moves, or 'binoculars' once it has been held still
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, held: 0, mode: 'pending', slop: e.pointerType === 'mouse' ? SLOP_MOUSE : SLOP_TOUCH };
      if (e.button === 2) this.#raise();
      c.classList.add('holding');
    }, opt);
    c.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (p?.id !== e.pointerId) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (p.mode === 'pending' && Math.hypot(p.x - p.x0, p.y - p.y0) > p.slop) { p.mode = 'look'; game.aim(p.x - p.x0 - dx, p.y - p.y0 - dy); }
      if (p.mode !== 'pending') game.aim(dx, dy);
    }, opt);
    const end = (e) => { if (this.pointer?.id === e.pointerId) this.release(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(ev, end, opt);
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && game.state !== 'ready' && !e.target.closest?.('button,a')) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyR' && game.state !== 'ready' && game.state !== 'loading') { game.restart(); return; }
      if (e.code === 'KeyM') { game.toggleMute(); return; }
      if (e.code === 'Space' && e.target.closest?.('button,a')) return;
      if (game.controllable) { this.keys.add(e.code); if (e.code === 'Space') game.audio.unlock(); }
    }, opt);
    addEventListener('keyup', (e) => this.keys.delete(e.code), opt);
    addEventListener('blur', () => this.clear(), opt);
  }
  get holding() { return this.pointer?.mode === 'binoculars' || this.keys.has('Space'); }
  get looking() { return this.pointer?.mode === 'look'; }
  // the binoculars come up pointed at whatever is under the finger or cursor
  #raise() { const p = this.pointer; p.mode = 'binoculars'; this.g.aimToward(p.x, p.y); }
  release() { this.pointer = null; this.g.canvas.classList.remove('holding'); }
  clear() { this.release(); this.keys.clear(); }
  update(dt) {
    const p = this.pointer;
    if (p?.mode === 'pending' && (p.held += dt) >= HOLD_SECONDS) this.#raise();
    const k = this.keys, x = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0), y = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    // about a third of the current view per second, so the keys feel the same zoomed in or out
    if (x || y) this.g.aim(x * this.g.size.h * 0.35 * dt, y * this.g.size.h * 0.35 * dt);
  }
}
