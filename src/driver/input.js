// Driver POV input: drag anywhere on the view to look around (mouse or one finger), arrow keys /
// WASD to turn, 1/2/3 to answer, F the finger, R restart, M sound, Esc or P pause, H hide the top bar.
// Looking is never locked by dialogue: it works during lines, menus, the hook and the drag.
// Buttons stop their own pointerdown, so a tap on the interface never turns the camera; a drag
// that is cancelled (incoming call, gesture taken by the browser) simply ends.
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointer already gone */ } };

export class DriverInput {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.keys = new Set();
    this.drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.drag || this.game.mode !== 'play' || this.game.paused) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      capture(canvas, e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      if (this.game.paused) { this.reset(); return; }
      const k = 2.6 / canvas.getBoundingClientRect().height; // radians per stage height
      this.game.view.look(-(e.clientX - this.drag.x) * k, -(e.clientY - this.drag.y) * k);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.game.ui.hideHint();
    });
    const end = (e) => { if (this.drag && e.pointerId === this.drag.id) this.#endDrag(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.#key(e, true));
    addEventListener('keyup', (e) => this.#key(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.#endDrag(); });
  }

  #endDrag() { this.drag = null; this.canvas.classList.remove('grabbing'); }

  /** forget held keys and any drag in progress (pause, restart, leaving the page) */
  reset() { this.keys.clear(); this.#endDrag(); }

  #key(e, down) {
    const k = e.key.toLowerCase();
    if (e.target?.closest?.('a, button') && (k === 'enter' || k === ' ')) return; // let focused controls work
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down || e.repeat) return;
    const g = this.game;
    if (g.mode !== 'play') return;
    if (k === 'escape' || k === 'p') { if (g.paused) g.resume(); else g.pause('menu'); return; }
    if (g.paused) return;
    if (k === '1' || k === '2' || k === '3') g.ui.pick(Number(k) - 1);
    if (k === 'r') g.reset();
    if (k === 'm') g.toggleMute();
    if (k === 'h') g.ui.toggleHud();
    if (k === 'f') g.flipOff();
  }

  /** arrow keys / A-D-W-S: +x turns left, +y looks up */
  keyLook() {
    const K = this.keys;
    if (this.game.paused) return { x: 0, y: 0 };
    return {
      x: (K.has('arrowleft') || K.has('a') ? 1 : 0) - (K.has('arrowright') || K.has('d') ? 1 : 0),
      y: (K.has('arrowup') || K.has('w') ? 1 : 0) - (K.has('arrowdown') || K.has('s') ? 1 : 0),
    };
  }
}
