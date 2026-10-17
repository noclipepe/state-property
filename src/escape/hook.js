// The anti-stall hook. When the fish has not reached a new furthest row for a while, the
// fisherman casts: the hook drops toward one marked cell (locked when it appears, it does not
// follow you). Leave that cell before it lands and it misses; stay and it hooks you.
import * as THREE from 'three';
import { ESCAPE } from './config.js';
import { makeHook, makeTarget } from './models.js';

const C = ESCAPE.cell, H = ESCAPE.hook;

export class HookThreat {
  constructor(parent) {
    this.hook = makeHook(); this.target = makeTarget();
    parent.add(this.hook, this.target);
    this.reset();
  }

  reset() {
    this.state = 'idle'; this.t = 0; this.cell = null; this.retry = 0;
    this.hook.visible = this.target.visible = false;
  }

  get active() { return this.state === 'descend'; }

  cast(cell) {
    this.state = 'descend'; this.t = 0; this.cell = { ...cell };
    this.hook.visible = this.target.visible = true;
    this.target.position.set(cell.c * C, 0, -cell.r * C);
  }

  /** pulled away (a miss, or the fish reached new ground) */
  retract() { if (this.state === 'descend') { this.state = 'retract'; this.t = 0; } }

  /**
   * step the hook; occupied = the cell the fish is in now. Returns 'caught', 'missed' or null.
   * After a miss the next cast waits ESCAPE.hook.retry seconds.
   */
  step(dt, occupied) {
    this.retry = Math.max(0, this.retry - dt);
    if (this.state === 'idle' || this.state === 'caught') return null;
    this.t += dt;
    if (this.state === 'descend' && this.t >= H.warn) {
      if (occupied.r === this.cell.r && occupied.c === this.cell.c) { this.state = 'caught'; this.t = 0; this.target.visible = false; return 'caught'; }
      this.state = 'retract'; this.t = 0; this.retry = H.retry; return 'missed';
    }
    if (this.state === 'retract' && this.t > 0.45) { this.state = 'idle'; this.hook.visible = this.target.visible = false; }
    return null;
  }

  render(time) {
    if (!this.hook.visible) return;
    const x = this.cell.c * C, z = -this.cell.r * C;
    let y;
    if (this.state === 'descend') {
      const u = Math.min(1, this.t / H.warn);
      y = 3.2 - 3.02 * (u * u); // in view from the start: slow at first, then it drops
      const T = this.target.userData;
      T.fill.scale.setScalar(Math.max(0.02, u));
      const pulse = 1 + Math.sin(time * 14) * 0.05 * (0.5 + u);
      T.ring.scale.setScalar(pulse); T.dash.scale.setScalar(pulse); T.dash.rotation.y = time * 1.5;
    } else if (this.state === 'retract') y = 0.2 + this.t * this.t * 30;
    else y = 0.2; // caught: the game lifts it (with the fish) itself
    if (this.state !== 'caught') this.hook.position.set(x + Math.sin(time * 2.1) * 0.03, y, z);
  }
}
