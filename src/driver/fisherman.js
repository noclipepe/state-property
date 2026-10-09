// The fisherman in the driver POV mode: a standing character on the shared rig, holding the
// rod in his right hand (the rod follows the solved hand bone), restrained gestures with the
// left hand, nods, a cast, reeling, and walking backwards while he drags the truck.
// Char space: +Z forward, +X = his left, origin on the ground between the feet.
import * as THREE from 'three';
import { GrandpaAnimator } from '../character/animator.js';
import { Rod } from '../gameplay/rod.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const UP = V(0, 1, 0);

// left-hand gestures (char space): w wrist, f finger direction, n back of hand, p elbow pole
const POSES = {
  L_open: { w: V(0.25, 1.00, 0.30), f: V(0.25, 0.20, 0.95), n: V(0.15, -0.95, 0.15), p: V(0.6, -0.5, -0.5), hand: 'open' },
  L_raise: { w: V(0.27, 1.20, 0.30), f: V(0.05, 0.95, 0.25), n: V(0.05, -0.25, -0.95), p: V(0.8, -0.5, -0.2), hand: 'open' },
  L_chest: { w: V(0.07, 1.16, 0.17), f: V(-0.80, 0.25, -0.25), n: V(0.15, 0.15, 0.98), p: V(0.6, -0.7, 0.2), hand: 'open' },
};
// rod hold presets: grip point G and aim D in char space
const HOLDS = {
  rest: { g: V(-0.16, 1.02, 0.28), d: V(-0.50, 0.82, 0.22) }, // casual, tip up and away to his right
  ready: { g: V(-0.13, 1.08, 0.32), d: V(-0.30, 0.85, 0.40) },
  back: { g: V(-0.17, 1.38, 0.10), d: V(-0.18, 0.80, -0.58) }, // wind-up over the right shoulder
  forward: { g: V(-0.10, 1.12, 0.42), d: V(-0.02, 0.10, 0.99) },
  fight: { g: V(-0.10, 1.10, 0.30), d: V(-0.04, 0.70, 0.71) }, // rod high against the load
};

export class Fisherman {
  constructor(character, scene) {
    this.c = character;
    this.B = character.bones;
    scene.add(character.group);
    this.anim = new GrandpaAnimator(character, { poses: POSES, bindCurl: character.header.bindCurl, glances: [] });
    this.rod = new Rod(scene, null);
    this.rod.group.traverse((o) => { o.castShadow = true; });
    this.pos = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.homeYaw = 0;
    this.reset();
  }

  setHome(pos, yaw) { this.home.copy(pos); this.homeYaw = yaw; this.reset(); }

  reset() {
    this.pos.copy(this.home);
    this.yaw = this.homeYaw;
    this.yawTarget = null; // world point to turn the body toward (null = keep)
    this.hold = { g: HOLDS.rest.g.clone(), d: HOLDS.rest.d.clone() };
    this.holdTarget = 'rest';
    this.holdSpeed = 4;
    this.leftMode = 'rod'; // 'rod' (on the butt), 'reel' (cranking) or a gesture pose name
    this.walkVel = new THREE.Vector3(); // m/s, world (he walks backwards while facing the truck)
    this.walkPhase = 0;
    this.reeling = false;
    this.whip = 0;
    this.lean = { back: 0, fwd: 0 };
    this.tension = 0;
    this.lineDir = null;
    this.speechEnv = 0;
    this.speaking = false;
    this.nodT = -1;
    this.bob = 0;
    this.anim.reset();
    this.anim.setFace({ smile: 0.05, frown: 0, browUp: 0.1, browAngry: 0, browSad: 0, squint: 0.15, sneer: 0, pucker: 0 });
    this.anim.setLean({ back: 0, side: 0, twist: 0, fwd: 0 });
    this.anim.setArm('R', null, { dyn: () => this.#gripPose(), hand: 'grip', speed: 9 });
    this.setLeft('rod');
    this.#place();
    this.c.group.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ controls (used by the director)
  lookAt(target, seconds = 60) { this.anim.lookAt(target, seconds); }
  setFace(f) { this.anim.setFace(f); }
  setLean(l) { Object.assign(this.lean, l); this.anim.setLean({ back: this.lean.back, fwd: this.lean.fwd }); }
  nod() { this.nodT = 0; }
  setHold(name, speed = 4) { this.holdTarget = name; this.holdSpeed = speed; }
  /** 'rod', 'reel' or a gesture ('open', 'raise', 'chest'); null = back to the rod */
  setLeft(mode) {
    this.leftMode = mode || 'rod';
    if (this.leftMode === 'rod' || this.leftMode === 'reel') this.anim.setArm('L', null, { dyn: () => this.#leftOnRod(), hand: 'grip', speed: 7 });
    else this.anim.setArm('L', 'L_' + this.leftMode, { speed: 6 });
  }
  /** world point or a function returning one (followed every frame); null = keep the current yaw */
  faceToward(target) { this.yawTarget = target?.isVector3 ? target.clone() : target || null; }

  get forward() { return V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get walkSpeed() { return this.walkVel.length(); }

  // ------------------------------------------------------------------ rig helpers
  #toChar(world) { return world.clone().applyMatrix4(new THREE.Matrix4().copy(this.c.group.matrixWorld).invert()); }

  // right hand wraps over the rod with the reel hanging below (spinning-rod grip)
  #gripPose() {
    const D = this.hold.d.clone().normalize();
    const n = V(-1, -0.15, 0).addScaledVector(D, -V(-1, -0.15, 0).dot(D)).normalize(); // back of hand: outwards
    const f = D.clone().cross(n).normalize(); // fingers around the handle
    const w = this.hold.g.clone().addScaledVector(f, -0.07).addScaledVector(n, 0.03);
    return { w, f, n, p: V(-0.6, -0.6, -0.4) };
  }

  // left hand under the butt, or cranking the reel handle
  #leftOnRod() {
    const D = this.hold.d.clone().normalize();
    let g;
    if (this.leftMode === 'reel') {
      const a = this.rod.reelAngle;
      g = this.hold.g.clone().addScaledVector(D, -0.03).add(V(0.07, -0.08 + Math.sin(a) * 0.035, Math.cos(a) * 0.035));
    } else g = this.hold.g.clone().addScaledVector(D, -0.22);
    const n = V(0.4, -0.9, 0).addScaledVector(D, -V(0.4, -0.9, 0).dot(D)).normalize(); // palm up under the rod
    const f = n.clone().cross(D).normalize();
    const w = g.addScaledVector(f, -0.07).addScaledVector(n, 0.03);
    return { w, f, n, p: V(0.7, -0.6, -0.2) };
  }

  #place() {
    this.c.group.position.copy(this.pos);
    this.c.group.rotation.set(0, this.yaw, 0);
  }

  // ------------------------------------------------------------------ per frame
  /** ctx: {lookTarget (world), speechEnv, speaking} */
  update(dt, ctx) {
    // body yaw toward the current focus (only turns, never strafes)
    if (this.yawTarget) {
      const d = (typeof this.yawTarget === 'function' ? this.yawTarget() : this.yawTarget).clone().sub(this.pos);
      const want = Math.atan2(d.x, d.z);
      let diff = want - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * (1 - Math.exp(-4 * dt));
    }
    // walking (backwards while he hauls)
    if (this.walkSpeed > 0.01) {
      this.pos.addScaledVector(this.walkVel, dt);
      this.walkPhase += dt * Math.PI * this.walkSpeed / 0.42;
    } else this.walkPhase = damp(this.walkPhase, Math.round(this.walkPhase / Math.PI) * Math.PI, 6, dt);
    this.#place();
    // rod hold blends between presets
    const H = HOLDS[this.holdTarget];
    const k = 1 - Math.exp(-this.holdSpeed * dt);
    this.hold.g.lerp(H.g, k);
    this.hold.d.lerp(H.d, k).normalize();
    // a short nod
    if (this.nodT >= 0) {
      this.nodT += dt;
      this.anim.nod = Math.sin(Math.min(1, this.nodT / 0.45) * Math.PI) * 0.16;
      if (this.nodT > 0.45) this.nodT = -1;
    }
    if (!this.anim.lookOverride && ctx.lookTarget) this.anim.lookTarget.copy(ctx.lookTarget);
    this.c.group.updateMatrixWorld(true);
    this.anim.update(dt, { speechEnv: ctx.speechEnv, speaking: ctx.speaking });
    this.#legs(dt);
    this.c.group.updateMatrixWorld(true);
    this.#updateRod(dt);
  }

  #legs(dt) {
    const B = this.B, q = new THREE.Quaternion(), X = V(1, 0, 0);
    const moving = this.walkSpeed > 0.01;
    const amp = Math.min(1, this.walkSpeed / 0.9);
    const ph = this.walkPhase;
    for (const [s, off] of [['L', 0], ['R', Math.PI]]) {
      const a = Math.sin(ph + off);
      // walking backwards: the free foot reaches back, knee bends while it swings
      const thigh = moving ? a * 0.32 * amp : 0;
      const knee = moving ? Math.max(0, Math.cos(ph + off)) * 0.55 * amp : 0;
      B['thigh' + s].quaternion.multiply(q.setFromAxisAngle(X, thigh));
      B['shin' + s].quaternion.multiply(q.setFromAxisAngle(X, knee));
      B['foot' + s].quaternion.multiply(q.setFromAxisAngle(X, -(thigh + knee) * 0.7));
    }
    // brace stance when the line pulls: knees soften, hips sink a little
    const brace = this.tension * 0.6;
    const bob = moving ? Math.abs(Math.cos(ph)) * 0.025 * amp : 0;
    this.bob = damp(this.bob, brace * 0.05 + bob, 10, dt);
    B.pelvis.position.y -= this.bob;
    if (brace > 0.01) {
      for (const s of ['L', 'R']) {
        B['thigh' + s].quaternion.multiply(q.setFromAxisAngle(X, -0.25 * brace));
        B['shin' + s].quaternion.multiply(q.setFromAxisAngle(X, 0.45 * brace));
        B['foot' + s].quaternion.multiply(q.setFromAxisAngle(X, -0.2 * brace));
      }
    }
  }

  // the rod follows the solved right hand
  #updateRod(dt) {
    const hb = this.B.handR;
    hb.updateWorldMatrix(true, false);
    const m = hb.matrixWorld;
    const X = V(0, 0, 0).setFromMatrixColumn(m, 0).normalize();
    const Y = V(0, 0, 0).setFromMatrixColumn(m, 1).normalize();
    const D = V(0, 0, 0).setFromMatrixColumn(m, 2).normalize();
    const hp = V(0, 0, 0).setFromMatrixPosition(m);
    const grip = hp.addScaledVector(Y, -0.07).addScaledVector(X, 0.03);
    const butt = grip.clone().addScaledVector(D, -0.27);
    this.whip = damp(this.whip, 0, 5, dt);
    this.rod.updateHeld(dt, {
      butt, dir: D, up: UP, tension: this.tension, lineDirWorld: this.lineDir, heavy: true,
      reeling: this.reeling, whip: this.whip,
    });
  }

  handsWorld(out = new THREE.Vector3()) { return this.B.handR.getWorldPosition(out); }
  get tipWorld() { return this.rod.tipWorld; }
  get headWorld() { return this.B.head.getWorldPosition(new THREE.Vector3()); }
}
