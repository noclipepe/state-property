// The player's fish: the Fish POV model, lying on its side, flopping from cell to cell. Every few
// hops it rolls right over in the air and lands on its other side.
// Logic (cell, hop progress, continuous position in cells) and the look of each hop live here.
import * as THREE from 'three';
import { makeFish } from '../fish/bucket.js';
import { ESCAPE } from './config.js';

const C = ESCAPE.cell, F = ESCAPE.fish;
const smooth = (u) => u * u * (3 - 2 * u);
// heading yaw (pivot space): the model's head (+X) points along the hop
const YAW = { f: Math.PI / 2, b: -Math.PI / 2, l: Math.PI, r: 0 };

export class PlayerFish {
  constructor(parent) {
    this.pivot = new THREE.Group(); parent.add(this.pivot);
    this.tilt = new THREE.Group(); this.pivot.add(this.tilt);
    const lie = new THREE.Group(); lie.rotation.x = -Math.PI / 2; this.tilt.add(lie); // on its side, one eye up
    const fish = makeFish(0x879b68); fish.root.scale.setScalar(F.scale); lie.add(fish.root);
    fish.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.tail = fish.tail; this.model = fish.root;
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b1206, transparent: true, opacity: 0.32, depthWrite: false }));
    this.shadow.scale.set(1.2, 1, 0.55); parent.add(this.shadow);
    this.lift = 0.017 * F.scale + 0.006; // resting height: half the body's thickness
    this.reset(0, 0);
  }

  reset(r, c) {
    this.cell = { r, c }; this.pos = { x: c, z: r, y: 0 };
    this.hop = null; this.anim = null; this.yaw = YAW.f; this.yawTarget = YAW.f; this.t = 0; this.idle = 1.6;
    this.flop = 0; this.attached = null; this.visible = true; this.pivot.visible = this.shadow.visible = true;
    this.tilt.rotation.set(0, 0, 0); this.tilt.scale.set(1, 1, 1); this.pivot.scale.set(1, 1, 1); this.swimming = false;
    this.roll = 0; this.flips = 0; this.untilFlip = 3 + Math.floor(Math.random() * 4); // which side is up (0 or π)
  }

  get busy() { return !!this.hop; }
  /** the hop's remaining time in seconds (0 when standing) */
  get remaining() { return this.hop ? (1 - this.hop.u) * F.hop : 0; }
  /** the cell the fish counts as being in (a hop belongs to its destination once past halfway) */
  get occupied() { const h = this.hop; return !h || h.bump ? this.cell : h.u > 0.5 ? h.to : this.cell; }

  /** hop toward the cell `to`; bump = the cell is blocked, so bounce back */
  start(dir, to, bump = false) {
    this.yawTarget = YAW[dir];
    // now and then (every 3–6 real hops) the hop is a full roll onto the other side
    const flip = !bump && --this.untilFlip <= 0;
    if (flip) this.untilFlip = 3 + Math.floor(Math.random() * 4);
    this.hop = { from: { r: this.cell.r, c: this.pos.x }, to: { ...to }, u: 0, bump, flip };
  }

  /** advance; returns 'landed' or 'bumped' when a hop ends */
  step(dt) {
    this.t += dt;
    let event = null;
    const h = this.hop;
    if (h) {
      h.u = Math.min(1, h.u + dt / (h.bump ? F.hop * 1.15 : F.hop));
      if (h.bump) {
        const k = Math.sin(Math.PI * h.u) * 0.28;
        this.pos.x = h.from.c + (h.to.c - h.from.c) * k; this.pos.z = h.from.r + (h.to.r - h.from.r) * k;
        this.pos.y = Math.sin(Math.PI * h.u) * F.hopHeight * 0.45;
      } else {
        const s = smooth(h.u);
        this.pos.x = h.from.c + (h.to.c - h.from.c) * s; this.pos.z = h.from.r + (h.to.r - h.from.r) * s;
        this.pos.y = Math.sin(Math.PI * h.u) * F.hopHeight * (h.flip ? 1.25 : 1);
      }
      if (h.u >= 1) {
        if (!h.bump) this.cell = { ...h.to }; else this.cell.c = h.from.c;
        if (h.flip) { this.roll = this.roll ? 0 : Math.PI; this.flips++; }
        this.pos.x = this.cell.c; this.pos.z = this.cell.r; this.pos.y = 0;
        this.hop = null; this.flop = 0.2; event = h.bump ? 'bumped' : 'landed';
      }
    }
    return event;
  }

  /** pose and place the model (course space). mode: null | 'tumble' | 'hooked' | 'intro' */
  render(dt) {
    let dy = this.yawTarget - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-28 * dt));
    const h = this.hop, T = this.tilt, a = this.anim, R0 = this.roll, side = R0 ? -1 : 1;
    if (a?.kind === 'flip') {
      // the leap out of the bucket: two full rolls, landing the right way up
      T.rotation.set(Math.PI * 4 * a.u, 0, Math.sin(a.u * Math.PI) * 0.5);
      this.tail.rotation.y = Math.sin(this.t * 30) * 0.7;
    } else if (a?.kind === 'squash') {
      // flattened: squashed flat and wide, eyes up, then a small flap of the tail
      const u = Math.min(1, a.t / 0.12);
      this.pivot.scale.set(1 + 0.35 * u, 1 - 0.78 * u, 1 + 0.35 * u);
      T.rotation.set(R0, 0, 0); this.tail.rotation.y = a.t > 0.5 ? Math.sin(this.t * 12) * 0.3 : 0;
    } else if (a?.kind === 'tumble') {
      // knocked over: spins along its length and lands belly-up
      const u = Math.min(1, a.t / 0.7);
      T.rotation.set(R0 + Math.PI * 3 * (1 - (1 - u) ** 2), 0, Math.sin(u * Math.PI * 2) * 0.4);
      this.tail.rotation.y = Math.sin(this.t * 40) * 0.6 * (1 - u);
    } else if (a?.kind === 'hooked' || a?.kind === 'drop') {
      // dangling nose-up from the hook, tail thrashing
      T.rotation.set(Math.sin(this.t * 17) * 0.35, 0, Math.PI / 2 * 0.9);
      this.tail.rotation.y = Math.sin(this.t * 32) * 0.8;
    } else if (h) {
      // the body curls into the hop and flips half onto its belly at the top; a flip hop rolls all
      // the way over and lands on the other side
      const u = h.u, roll = h.flip ? Math.PI * smooth(Math.min(1, u * 1.15)) : Math.sin(Math.PI * u) * (h.bump ? 0.4 : 0.85);
      T.rotation.set(R0 + side * roll, 0, Math.sin(Math.PI * 2 * u) * 0.32);
      this.tail.rotation.y = Math.sin(u * Math.PI * 2) * 0.9;
      T.scale.set(1, 1, 1);
    } else if (this.swimming) {
      // in a stream: upright in the water, swimming hard against the current
      T.rotation.set(R0 + side * Math.PI / 2 * 0.85, 0, Math.sin(this.t * 9) * 0.12);
      T.scale.set(1, 1, 1);
      this.tail.rotation.y = Math.sin(this.t * 18) * 0.7;
    } else {
      // a floppy landing, then the odd idle flop
      this.flop = Math.max(0, this.flop - dt);
      const f = this.flop / 0.2;
      T.rotation.set(R0 + side * Math.sin(f * Math.PI * 3) * 0.3 * f, 0, 0);
      T.scale.set(1, 1 - 0.18 * Math.sin(f * Math.PI), 1 + 0.08 * Math.sin(f * Math.PI));
      this.idle -= dt;
      if (this.idle < 0) { this.idle = 1.4 + Math.random() * 1.6; this.flop = 0.2; }
      this.tail.rotation.y = Math.sin(this.t * 3) * 0.12 + Math.sin(f * Math.PI * 4) * 0.6;
    }
    const lift = a?.kind === 'hooked' || a?.kind === 'drop' ? 0 : this.swimming && !h ? -0.015 : a?.kind === 'squash' ? 0.004 : this.lift;
    this.pivot.position.set(this.pos.x * C, this.pos.y * C + lift, -this.pos.z * C);
    this.pivot.rotation.y = this.yaw;
    this.shadow.position.set(this.pos.x * C, 0.012, -this.pos.z * C);
    const air = Math.min(1, this.pos.y * C / 1.5);
    this.shadow.scale.set(1.2 * (1 - air * 0.5), 1, 0.55 * (1 - air * 0.5)); this.shadow.material.opacity = 0.32 * (1 - air);
    this.shadow.visible = this.pivot.visible;
  }
}
