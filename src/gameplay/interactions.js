// Hookable targets and grandpa's reactions to them.
// Each target exposes: id, label, hitRadius, enabled(), anchor(out), attach(), pinned(),
// attachPoint(out), applyPull(t, dirToRod, dt), detach(reason), update(dt), reset(), stretch
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();

// dialogue pools, chosen by what the line actually means
export const LINES = {
  intro: [{ id: 'g_who', gap: 0.3 }, { id: 'p_state', gap: 0.45 }, { id: 'g_private', gap: 0 }],
  mirror: ['g_call'],
  cap: ['g_lock'],
  sleeve: ['g_who', 'g_road'],
  // when the whole truck starts moving (once per playthrough)
  truckMove: 'g_call',
  // later grumbles while it is dragged; the opening "state property" lines are not reused here
  truck: ['g_road', 'g_lock'],
  idle: ['g_road'],
};

export class Interactions {
  constructor(game) {
    this.game = game;
    const { truck, grandpa, animator, dialogue, audio } = game;
    this.truck = truck; this.g = grandpa; this.anim = animator; this.dialogue = dialogue; this.audio = audio;
    const D = truck.dims;
    const tow = new TruckPullTarget(this, {
      id: 'truck', label: 'Tow hook', hitRadius: 0.26, local: V(D.towHook[0] - 0.035, D.towHook[1] + 0.02, D.towHook[2]),
      attachSound: (au) => au.ping(2600, 0.1),
    });
    // rear door / rear cab section on the driver's side (behind the front door)
    const rear = new TruckPullTarget(this, {
      id: 'rearDoor', label: 'Rear door', hitRadius: 0.45, local: V((D.doorRear.x0 + D.doorRear.x1) / 2, 1.05, D.halfW),
      region: new THREE.Box3(V(D.doorRear.x0 - 0.04, 0.5, 0.78), V(D.doorRear.x1 + 0.12, 1.84, D.halfW + 0.06)),
      attachSound: (au) => { au.click(0.22, 1800, 0.03); au.thud(0.12, 260); },
    });
    this.targets = [new MirrorTarget(this), new CapTarget(this), new SleeveTarget(this), tow, rear];
    this.byId = Object.fromEntries(this.targets.map((t) => [t.id, t]));
    this.truckLineDone = false; // "I can call down..." when the truck first really moves
  }
  reset() { for (const t of this.targets) t.reset(); this.truckLineDone = false; }
  update(dt) {
    for (const t of this.targets) t.update(dt);
    const sim = this.truck.sim;
    const cur = this.game.fishing.target;
    // no truck target on the line -> no pull (and let any drag reaction wind down)
    if (!(cur && cur.movesTruck && this.game.fishing.hooked)) {
      sim.clearForce();
      const a = this.anim;
      if (a.script?.name === 'truck' && sim.stuck) a.script.duration = Math.min(a.script.duration, a.script.t + 0.5);
    }
    if (sim.events.released) this.audio.creak(0.12, 560 + Math.random() * 200);
  }

  // speech with a matching mouth: only when nothing else is playing
  say(pool, opts) { return this.dialogue.say(pool, opts); }
  get player() { return this.game.player.camera.getWorldPosition(new THREE.Vector3()); }
}

// ---------------------------------------------------------------------------- mirror
class MirrorTarget {
  constructor(ix) {
    this.ix = ix; this.id = 'mirror'; this.label = 'Mirror'; this.hitRadius = 0.2; this.stretch = 0.28;
    const P = ix.truck.dims.mirrorPivot;
    this.local = V(P[0] - 0.035, P[1] + 0.07, P[2] + 0.30); // on the mirror head (body coords at angle 0)
    this.reset();
  }
  reset() { this.angle = 0; this.vel = 0; this.hooked = false; this.reacted = false; this.lastClick = 0; this.fixing = 0; this.ix.truck.setMirrorAngle(0); }
  enabled() { return true; }
  anchor(out) {
    // the head point follows the hinge
    const t = this.ix.truck;
    out.copy(this.local).sub(t.mirrorPivot.position).applyAxisAngle(V(0, 1, 0), this.angle).add(t.mirrorPivot.position);
    return t.worldPoint(out, out);
  }
  attachPoint(out) { return this.anchor(out); }
  pinned() { return true; }
  attach() { this.hooked = true; this.reacted = false; this.ix.audio.click(0.25, 4200, 0.02); }
  detach() {
    this.hooked = false;
    // he pushes the mirror back into place after a moment
    if (Math.abs(this.angle) > 0.25) this.#scheduleFix();
  }
  applyPull(t, dir, dt) {
    const tr = this.ix.truck;
    const F = 170 * t; // N
    const hinge = tr.worldPoint(tr.mirrorPivot.position.clone(), new THREE.Vector3());
    const head = this.anchor(new THREE.Vector3());
    const r = head.sub(hinge);
    // torque about the body's vertical axis
    const up = V(0, 1, 0).applyQuaternion(tr.body.getWorldQuaternion(new THREE.Quaternion()));
    const torque = r.clone().cross(dir.clone().multiplyScalar(F)).dot(up);
    const breakaway = 4;
    const excess = Math.abs(torque) - breakaway;
    const prev = this.angle;
    if (excess > 0) this.angle += Math.sign(torque) * Math.min(excess * 0.16, 1.6) * dt;
    this.angle = THREE.MathUtils.clamp(this.angle, -1.05, 1.28);
    tr.setMirrorAngle(this.angle);
    if (Math.abs(this.angle - this.lastClick) > 0.09) { this.lastClick = this.angle; this.ix.audio.ratchet(0.16); }
    if (!this.reacted && Math.abs(this.angle - prev) > 0 && Math.abs(this.angle) > 0.12) { this.reacted = true; this.#react(); }
  }
  #react() {
    const a = this.ix.anim, ix = this.ix;
    const mirrorPos = () => this.anchor(new THREE.Vector3());
    a.play('mirror', [
      [0, () => { a.lookAt(mirrorPos, 1.1); a.setFace({ browAngry: 0.9, frown: 0.7, squint: 0.5 }); a.blink(); }],
      [1.1, () => { a.lookAt(() => ix.player, 3); ix.say(LINES.mirror); a.setArm('L', 'L_pointDown'); }],
      [1.7, () => a.setArm('R', 'R_open')],
      [2.6, () => a.setArm('L', 'L_pointOut')],
      [3.4, () => { a.setArm('L', 'L_sill'); a.setArm('R', 'R_rest'); }],
    ], 4.0);
  }
  #scheduleFix() {
    const a = this.ix.anim, tr = this.ix.truck;
    const start = this.angle;
    const handTarget = () => {
      const w = this.anchor(new THREE.Vector3());
      // pull the wrist a little in from the mirror head toward the door
      const local = w.clone().applyMatrix4(new THREE.Matrix4().copy(this.ix.g.group.matrixWorld).invert());
      local.lerp(V(-0.2, 0.42, 0.62), 0.35);
      return { w: local, f: V(-0.4, 0.1, 0.9), n: V(0, 0.9, 0.3), p: V(0.6, -0.6, 0) };
    };
    a.play('fixMirror', [
      [0.9, () => { a.lookAt(() => this.anchor(new THREE.Vector3()), 2.4); a.setArm('L', null, { dyn: handTarget, hand: 'open', speed: 5 }); }],
      [1.8, () => { this.fixing = 1; this.fixFrom = this.angle; this.fixT = 0; }],
      [2.8, () => { a.setArm('L', 'L_sill'); }],
    ], 3.4);
    this.fixStart = start;
  }
  update(dt) {
    if (this.fixing && !this.hooked) {
      this.fixT += dt / 0.7;
      const k = Math.min(1, this.fixT);
      this.angle = this.fixFrom * (1 - (k * k * (3 - 2 * k)));
      this.ix.truck.setMirrorAngle(this.angle);
      if (Math.abs(this.angle - this.lastClick) > 0.12) { this.lastClick = this.angle; this.ix.audio.ratchet(0.12); }
      if (k >= 1) { this.fixing = 0; this.ix.audio.click(0.2, 1800, 0.03); }
    }
  }
}

// ---------------------------------------------------------------------------- cap
class CapTarget {
  constructor(ix) {
    this.ix = ix; this.id = 'cap'; this.label = 'Cap'; this.hitRadius = 0.16; this.stretch = 0.25;
    const capGeo = ix.game.props.cap;
    this.mesh = ix.game.makePropMesh(capGeo);
    this.mesh.name = 'cap';
    // path through the cab (body coords): dash -> past the wheel -> out of the window
    this.path = new THREE.CatmullRomCurve3([
      V(-0.80, 1.335, -0.06), V(-0.76, 1.37, 0.22), V(-0.66, 1.46, 0.55), V(-0.52, 1.52, 0.86), V(-0.46, 1.50, 1.12), V(-0.42, 1.45, 1.3),
    ]);
    this.reset();
  }
  reset() {
    this.state = 'dash';
    this.p = 0;
    this.vel = new THREE.Vector3();
    this.hooked = false;
    this.reacted = false;
    this.ix.truck.body.add(this.mesh);
    this.mesh.position.copy(this.path.getPoint(0));
    this.mesh.rotation.set(0, Math.PI * 0.9, 0);
    if (this.ix.game.line) { this.ix.game.line.endMass = 1; }
  }
  enabled() { return true; }
  anchor(out) { return this.mesh.getWorldPosition(out).add(V(0, 0.06, 0)); }
  attachPoint(out) { return this.mesh.getWorldPosition(out).add(tmp.set(0, 0.07, 0).applyQuaternion(this.mesh.getWorldQuaternion(new THREE.Quaternion()))); }
  pinned() { return this.state === 'dash' || this.state === 'pulled' || this.state === 'ground'; }
  attach() {
    this.hooked = true;
    this.ix.audio.click(0.18, 2600, 0.02);
    if (this.state === 'dash') this.state = 'pulled';
  }
  detach() {
    this.hooked = false;
    if (this.state === 'hanging') { this.state = 'falling'; this.vel.set(0, 0, 0); }
    if (this.ix.game.line) this.ix.game.line.endMass = 1;
    if (this.state === 'pulled' && this.reacted) this.#settleReach();
  }
  #settleReach() { const a = this.ix.anim; a.setArm('R', 'R_rest'); }
  applyPull(t, dir, dt) {
    const a = this.ix.anim, ix = this.ix;
    if (this.state === 'pulled') {
      if (t > 0.06) {
        this.p = Math.min(1, this.p + dt * (0.15 + 0.8 * t));
        this.mesh.position.copy(this.path.getPoint(this.p));
        // swing a little as it is dragged
        this.mesh.rotation.set(Math.sin(this.p * 9) * 0.25, Math.PI * 0.9 + this.p * 1.2, Math.sin(this.p * 6) * 0.3);
        if (!this.reacted) { this.reacted = true; this.#reactGrab(); }
      }
      if (this.p >= 1) this.#toHanging();
    } else if (this.state === 'ground' && t > 0.1) {
      this.#toHanging();
    }
  }
  #reactGrab() {
    const a = this.ix.anim, ix = this.ix;
    const capPos = () => this.mesh.getWorldPosition(new THREE.Vector3());
    const reach = () => {
      const w = capPos();
      const local = w.applyMatrix4(new THREE.Matrix4().copy(ix.g.group.matrixWorld).invert());
      // stay within reach and inside the cab
      local.x = THREE.MathUtils.clamp(local.x, -0.55, -0.15);
      local.y = THREE.MathUtils.clamp(local.y, 0.25, 0.62);
      local.z = THREE.MathUtils.clamp(local.z, -0.35, 0.42);
      return { w: local, f: V(-0.6, 0.1, 0.8), n: V(0.1, 0.9, -0.3), p: V(0.3, -1, -0.4) };
    };
    a.play('capGrab', [
      [0, () => { a.lookAt(capPos, 4); a.setFace({ browUp: 0.7, browAngry: 0, frown: 0.2 }); a.setLean({ fwd: 0.6, twist: -0.3 }); }],
      [0.25, () => a.setArm('R', null, { dyn: reach, hand: 'pinch', speed: 6 })],
    ], 30);
  }
  #toHanging() {
    const line = this.ix.game.line;
    const wp = this.mesh.getWorldPosition(new THREE.Vector3());
    const wq = this.mesh.getWorldQuaternion(new THREE.Quaternion());
    this.ix.game.scene.add(this.mesh);
    this.mesh.position.copy(wp); this.mesh.quaternion.copy(wq);
    this.state = 'hanging';
    if (line) { line.endMass = 4; line.end.copy(wp); line.prev[line.n - 1].copy(wp); }
    this.ix.audio.whoosh(0.3, 0.2);
    // grandpa: lunges after it, then gives up and tells you off
    const a = this.ix.anim, ix = this.ix;
    a.play('capLost', [
      [0, () => { a.setArm('R', 'R_rest'); a.setLean({ fwd: 0.2, side: 0.5, twist: 0.2 }); a.lookAt(() => this.mesh.getWorldPosition(new THREE.Vector3()), 1.4); a.setFace({ browAngry: 1, frown: 0.8, browUp: 0 }); }],
      [1.3, () => { a.lookAt(() => ix.player, 3); ix.say(LINES.cap); a.setArm('L', 'L_pointOut'); }],
      [2.6, () => { a.setArm('L', 'L_sill'); a.setLean({ fwd: 0, side: 0, twist: 0 }); }],
    ], 3.2);
  }
  update(dt) {
    const line = this.ix.game.line;
    if (this.state === 'hanging' && line) {
      const e = line.end;
      const prev = this.mesh.position.clone();
      this.mesh.position.copy(e).add(V(0, -0.06, 0));
      // orient: hang from the button, sway with motion
      const v = this.mesh.position.clone().sub(prev).divideScalar(Math.max(dt, 1e-3));
      this.mesh.rotation.x = THREE.MathUtils.clamp(v.z * 0.4, -0.8, 0.8) + Math.PI;
      this.mesh.rotation.z = THREE.MathUtils.clamp(-v.x * 0.4, -0.8, 0.8);
      this.mesh.rotation.y += dt * 0.6;
    } else if (this.state === 'falling') {
      this.vel.y -= 9.8 * dt;
      this.mesh.position.addScaledVector(this.vel, dt);
      this.mesh.rotation.x += dt * 4;
      if (this.mesh.position.y < 0.035) {
        this.mesh.position.y = 0.035;
        this.mesh.rotation.set(0, Math.random() * 6, 0);
        this.state = 'ground';
        this.ix.audio.thud(0.25, 180);
      }
    }
  }
}

// ---------------------------------------------------------------------------- sleeve
class SleeveTarget {
  constructor(ix) {
    this.ix = ix; this.id = 'sleeve'; this.label = 'Sleeve'; this.hitRadius = 0.13; this.stretch = 0.22;
    this.reset();
  }
  reset() { this.hooked = false; this.timer = 0; this.local = null; this.unhooking = false; this.ix.anim.pull.amount = 0; }
  enabled() { return !this.ix.anim.busy || this.ix.anim.script?.name === 'idle'; }
  #bone() { return this.ix.g.bones.upperArmL; }
  #ensureLocal() {
    if (this.local) return;
    const b = this.#bone();
    b.updateWorldMatrix(true, false);
    const cam = this.ix.player;
    const center = V(0, -0.13, 0.004).applyMatrix4(b.matrixWorld);
    const toCam = cam.clone().sub(center).normalize();
    const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
    const ld = toCam.applyQuaternion(inv); ld.y = 0; ld.normalize();
    this.local = V(ld.x * 0.07, -0.13, 0.004 + ld.z * 0.07);
  }
  anchor(out) {
    const b = this.#bone();
    b.updateWorldMatrix(true, false);
    if (!this.local) return out.set(0, -0.12, 0.0).applyMatrix4(b.matrixWorld).add(tmp.set(0, 0.0, 0.07).applyQuaternion(this.ix.truck.body.getWorldQuaternion(new THREE.Quaternion())));
    return out.copy(this.local).applyMatrix4(b.matrixWorld);
  }
  attachPoint(out) { return this.anchor(out); }
  pinned() { return true; }
  attach() { this.local = null; this.#ensureLocal(); this.hooked = true; this.timer = 0; this.unhooking = false; this.ix.audio.click(0.12, 1200, 0.03); }
  detach() {
    this.hooked = false;
    this.ix.anim.pull.amount = 0;
    if (!this.unhooking && this.timer > 0.2) {
      const a = this.ix.anim;
      a.play('sleeveFree', [[0, () => { a.setFace({ browAngry: 0.6 }); a.lookAt(() => this.ix.player, 2); }]], 1.5);
    }
  }
  applyPull(t, dir, dt) {
    const a = this.ix.anim;
    a.pull.amount += (Math.min(1, t * 1.2) - a.pull.amount) * (1 - Math.exp(-8 * dt));
    a.pull.dir.copy(dir);
    if (t > 0.15) this.timer += dt;
    if (!this.unhooking && (this.timer > 1.1 || (this.timer > 0.4 && t > 0.8))) this.#unhook();
  }
  #unhook() {
    this.unhooking = true;
    const a = this.ix.anim, ix = this.ix;
    const grabTarget = () => {
      const w = this.anchor(new THREE.Vector3());
      const local = w.applyMatrix4(new THREE.Matrix4().copy(ix.g.group.matrixWorld).invert());
      local.add(V(-0.06, 0.03, -0.07));
      return { w: local, f: V(0.2, -0.3, 0.93), n: V(0.1, 0.95, -0.2), p: V(0.0, -1, -0.6) };
    };
    a.play('unhook', [
      [0, () => { a.setArm('R', 'R_wheel'); a.setLean({ back: 0.6, side: -0.4 }); a.setFace({ browAngry: 1, frown: 0.9, squint: 0.6 }); a.lookAt(() => this.anchor(new THREE.Vector3()), 1.3); }],
      [0.55, () => a.setArm('R', null, { dyn: grabTarget, hand: 'pinch', speed: 8 })],
      [1.15, () => { a.setHand('R', 'fist'); }],
      [1.3, () => {
        // yank the hook out
        ix.game.fishing.release('unhooked');
        ix.audio.whoosh(0.2, 0.15);
        a.pull.amount = 0;
        a.setLean({ back: 0, side: 0 });
        a.setArm('R', 'R_shrug', { hand: 'open', speed: 9 });
      }],
      [1.6, () => {
        a.lookAt(() => ix.player, 3);
        const id = ix.say(LINES.sleeve);
        if (id === 'g_road') a.setArm('L', 'L_thumbBack', { speed: 8 }); else a.setArm('L', 'L_pointDown');
      }],
      [2.9, () => { a.setArm('L', 'L_sill'); a.setArm('R', 'R_rest'); }],
    ], 3.4);
  }
  update() {}
}

// ---------------------------------------------------------------------------- whole-truck pulls
// Shared by the tow hook and the rear-door area: the line pulls the entire pickup from the
// attachment point (fixed in truck space), so off-centre pulls turn it.
class TruckPullTarget {
  constructor(ix, o) {
    this.ix = ix; this.id = o.id; this.label = o.label; this.hitRadius = o.hitRadius; this.stretch = 0.38;
    this.movesTruck = true;
    this.reelSpeed = 1.0; // the reel winds faster against the heavy load (feels like hauling)
    this.maxForce = 26000; // N at full line tension
    this.defaultLocal = o.local.clone();
    this.region = o.region || null; // body-space Box3 for hooking at the actual hit position
    this.attachSound = o.attachSound;
    this.local = this.defaultLocal.clone();
    this.reset();
  }
  reset() {
    this.hooked = false; this.wasStuck = true; this.strainT = 0; this.creakT = 0; this.reactedStrain = false;
    this.lastTalk = -10; this.moveTime = 0; this.lastReact = -100; this.lastGroan = -100; this.moveFrom = null;
    this.local.copy(this.defaultLocal); this.aim = null;
  }
  enabled() { return true; }
  // aim point (body space) taken from the actual hit position; used for the cast and highlight
  setAim(localPoint) { this.aim = localPoint ? localPoint.clone() : null; }
  anchor(out) {
    const p = this.hooked ? this.local : (this.aim || this.local);
    return this.ix.truck.worldPoint(out.copy(p), out);
  }
  attachPoint(out) { return this.ix.truck.worldPoint(out.copy(this.local), out); }
  pinned() { return true; }
  attach() {
    if (this.aim) this.local.copy(this.aim);
    this.hooked = true; this.reactedStrain = false; this.moveFrom = null;
    this.attachSound(this.ix.audio);
  }
  detach() {
    this.hooked = false;
    this.ix.truck.sim.clearForce();
    const a = this.ix.anim;
    if (a.script?.name === 'truck') a.script.duration = Math.min(a.script.duration, a.script.t + 0.8);
  }
  applyPull(t, dir, dt) {
    const sim = this.ix.truck.sim;
    // pull toward where the angler stands (the line slides over the bodywork): horizontal,
    // plus a little upward lift from the raised rod for the suspension
    const point = this.attachPoint(new THREE.Vector3());
    const angler = this.ix.game.player.pos;
    const f = new THREE.Vector3(angler.x - point.x, 0, angler.z - point.z);
    // taper off as the hook reaches the angler so the truck doesn't run them over
    const near = THREE.MathUtils.smoothstep(f.length(), 0.5, 1.3);
    if (f.lengthSq() < 1e-4) f.copy(dir).setY(0);
    f.normalize().multiplyScalar(t * this.maxForce * near);
    f.y = t * this.maxForce * 0.12;
    sim.setLineForce(f, point);
    const a = this.ix.anim, ix = this.ix;
    // stage 1-3: strain while stuck
    if (sim.stuck) {
      if (t > 0.35) {
        this.strainT += dt;
        this.creakT -= dt;
        if (this.creakT < 0) { this.creakT = 0.5 + Math.random() * 0.8 - t * 0.3; ix.audio.creak(0.05 + 0.08 * t, 600 + Math.random() * 300); }
        if (!this.reactedStrain && this.strainT > 0.35) {
          this.reactedStrain = true;
          const hookPos = () => this.attachPoint(new THREE.Vector3());
          a.play('strain', [
            [0, () => { a.lookAt(hookPos, 1.0); a.setFace({ browUp: 0.6, browAngry: 0.2 }); a.setArm('R', 'R_wheel'); }],
            [1.0, () => { a.lookAt(() => ix.player, 2); a.setFace({ browAngry: 0.9, browUp: 0, frown: 0.7 }); }],
          ], 3.0);
        }
      }
    }
    // stage 4+: it breaks loose
    if (this.wasStuck && !sim.stuck) {
      const now = performance.now() / 1000;
      if (now - this.lastGroan > 1.5) { this.lastGroan = now; ix.audio.groan(0.36); }
      ix.audio.creak(0.16, 520);
      if (!this.moveFrom) this.moveFrom = { x: sim.pos.x, z: sim.pos.y, yaw: sim.yaw };
      // brace / look reaction at most every 8 s; otherwise he just braces again
      if (!a.script || a.script.name !== 'truck') {
        if (now - this.lastReact > 8) this.#reactMove();
        else { a.setArm('R', 'R_wheel', { speed: 10 }); a.setArm('L', 'L_grabSill', { speed: 10 }); a.setLean({ back: 0.5 }); }
      }
    }
    if (!sim.stuck) {
      this.moveTime += dt;
      // once it is really being dragged (not just a twitch): his line, once per playthrough
      const mf = this.moveFrom;
      if (mf && !ix.truckLineDone && (Math.hypot(sim.pos.x - mf.x, sim.pos.y - mf.z) > 0.4 || Math.abs(sim.yaw - mf.yaw) > 0.2)) {
        ix.truckLineDone = true;
        this.lastTalk = performance.now() / 1000 + 4;
        ix.dialogue.playNext(LINES.truckMove, () => {
          a.lookAt(() => ix.player, 3);
          a.setArm('L', 'L_pointDown', { speed: 8 });
          setTimeout(() => { if (this.hooked && a.arms.L.target === 'L_pointDown') a.setArm('L', 'L_grabSill'); }, 1800);
        });
      }
      // afterwards keep grumbling at a sensible pace while being dragged
      const now = performance.now() / 1000;
      if (ix.truckLineDone && now - this.lastTalk > 6.5 && !ix.dialogue.speaking && this.moveTime > 2.5) {
        const id = ix.say(LINES.truck, { lineCooldown: 10 });
        if (id) {
          this.lastTalk = now;
          if (id === 'g_road') a.setArm('L', 'L_thumbBack', { speed: 8 }); else a.setArm('L', 'L_pointDown');
          setTimeout(() => { if (a.arms.L.target !== 'L_sill' && this.hooked) a.setArm('L', 'L_grabSill'); }, 1400);
        }
      }
      if (Math.random() < dt * (0.8 + sim.speed * 2.5)) ix.audio.creak(0.05 + Math.min(1, sim.speed) * 0.1, 500 + Math.random() * 500);
    }
    this.wasStuck = sim.stuck;
  }
  #reactMove() {
    const a = this.ix.anim, ix = this.ix;
    this.lastReact = performance.now() / 1000;
    this.reactedStrain = true;
    a.play('truck', [
      [0, () => { a.setArm('R', 'R_wheel', { speed: 10 }); a.setArm('L', 'L_grabSill', { speed: 10 }); a.setLean({ back: 0.5 }); a.setFace({ browUp: 1, browAngry: 0, frown: 0.3, squint: 0 }); a.blink(); a.lookAt(() => this.attachPoint(new THREE.Vector3()), 0.8); }],
      [0.8, () => { a.lookAt(() => ix.player, 60); a.setFace({ browUp: 0, browAngry: 1, frown: 0.9, squint: 0.5 }); }],
    ], 60);
  }
  update() {
    if (!this.hooked) {
      this.strainT = 0;
      this.wasStuck = this.ix.truck.sim.stuck;
    }
  }
}
