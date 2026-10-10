export class FishInput {
  constructor(game, canvas, rise) {
    this.game = game; this.canvas = canvas; this.riseButton = rise;
    this.pad = document.getElementById('swim-pad');
    this.knob = this.pad.querySelector('.pad-knob');
    this.keys = new Set(); this.reset();
    canvas.addEventListener('pointerdown', (e) => {
      if (!game.active || game.showcase || game.spill?.active) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag?.id !== e.pointerId) return;
      game.look(-(e.clientX - this.drag.x) * 0.004, -(e.clientY - this.drag.y) * 0.003);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    const end = () => { this.drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    const padMove = (e) => {
      if (this.padPointer !== e.pointerId) return;
      const r = this.pad.getBoundingClientRect();
      let x = (e.clientX - r.x - r.width / 2) / 27, y = (e.clientY - r.y - r.height / 2) / 27;
      const n = Math.max(1, Math.hypot(x, y)); x /= n; y /= n;
      this.stick = { x, y }; this.knob.style.transform = `translate(${x * 23}px,${y * 23}px)`;
    };
    this.pad.addEventListener('pointerdown', (e) => {
      if (!game.active || game.showcase || game.spill?.active) return;
      e.preventDefault(); this.padPointer = e.pointerId; this.pad.setPointerCapture(e.pointerId); padMove(e);
    });
    this.pad.addEventListener('pointermove', padMove);
    for (const ev of ['pointerup','pointercancel','lostpointercapture']) this.pad.addEventListener(ev, () => this.clearPad());
    rise.addEventListener('pointerdown', (e) => {
      if (!game.active || game.showcase || game.spill?.active) return;
      e.preventDefault(); rise.setPointerCapture(e.pointerId);
      this.pointerRise = true; rise.classList.add('held');
    });
    const release = () => { this.pointerRise = false; rise.classList.remove('held'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) rise.addEventListener(ev, release);
    rise.addEventListener('keydown', (e) => { if (e.code === 'Enter') this.pointerRise = true; });
    rise.addEventListener('keyup', release);
    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Escape' || e.code === 'KeyP') game.paused ? game.resume() : game.pause();
      if (game.mode !== 'play') return;
      if (e.code === 'KeyR') game.reset();
      if (e.code === 'KeyM') game.toggleMute();
      if (e.code === 'KeyH') game.ui.toggleClean();
      if (e.code === 'KeyF') game.splash();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.reset(); game.pause(); });
  }
  get rising() { return this.pointerRise || this.keys.has('Space'); }
  get movement() {
    const k = this.keys;
    const x = this.stick.x + Number(k.has('KeyD')) - Number(k.has('KeyA'));
    const y = this.stick.y + Number(k.has('KeyS')) - Number(k.has('KeyW'));
    const n = Math.max(1, Math.hypot(x,y));
    return { x: x / n, y: y / n };
  }
  clearPad() { this.padPointer = null; this.stick = { x: 0, y: 0 }; this.knob.style.transform = ''; }
  reset() {
    this.drag = null; this.pointerRise = false; this.keys.clear();
    this.clearPad();
    this.riseButton.classList.remove('held');
  }
  update(dt) {
    const k = this.keys;
    this.game.look(((k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0)) * dt,
      ((k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0)) * dt * 0.7);
  }
}
