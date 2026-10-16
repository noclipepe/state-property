// Keys: W/↑/Space forward, S/↓ back, A/← left, D/→ right. One press = one hop (held keys
// don't auto-repeat). Touch / mouse: a tap hops forward; a swipe hops in its direction.
// Every gesture produces at most one move: it is decided once, when the finger lifts.
const TAP_PX = 14, SWIPE_PX = 26, TAP_MS = 450;
const KEYS = { ArrowUp: 'f', KeyW: 'f', Space: 'f', ArrowDown: 'b', KeyS: 'b', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };

export class EscapeInput {
  constructor(game) {
    this.g = game; this.pointer = null;
    const c = game.canvas, opt = { signal: game.abort.signal };
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.pointer) return;
      e.preventDefault(); game.audio.unlock();
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    }, opt);
    c.addEventListener('pointerup', (e) => {
      const p = this.pointer; if (p?.id !== e.pointerId) return;
      this.pointer = null;
      const dx = e.clientX - p.x, dy = e.clientY - p.y, d = Math.hypot(dx, dy);
      if (d < TAP_PX && performance.now() - p.t < TAP_MS) game.move('f');
      else if (d >= SWIPE_PX) game.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 'f'));
    }, opt);
    for (const ev of ['pointercancel', 'lostpointercapture']) c.addEventListener(ev, (e) => { if (this.pointer?.id === e.pointerId) this.pointer = null; }, opt);
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    // the page itself never scrolls or zooms under a finger
    document.addEventListener('touchmove', (e) => { if (e.target === c) e.preventDefault(); }, { passive: false, signal: game.abort.signal });
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('button,a')) return;
      if (KEYS[e.code] || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      if (game.state === 'loading') return;
      if (game.state === 'ready') { if (KEYS[e.code] || e.code === 'Enter') game.begin(); return; }
      // the opening scene: a move key skips it and hops at once; any other key just skips it
      if (game.state === 'scene' && !KEYS[e.code] && e.code !== 'KeyM') { game.skip(); return; }
      if (game.state === 'results' && ['Space', 'Enter', 'KeyR'].includes(e.code)) { game.restart(); return; }
      if (e.code === 'KeyR') { game.restart(); return; }
      if (e.code === 'KeyM') { game.toggleMute(); return; }
      if (KEYS[e.code]) { game.audio.unlock(); game.move(KEYS[e.code]); }
    }, opt);
    addEventListener('blur', () => { this.pointer = null; }, opt);
  }
  clear() { this.pointer = null; }
}
