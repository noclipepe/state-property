// Procedural animation for the seated grandpa: breathing, blinks, glances, look-at,
// arm IK poses with finger presets, speech-driven jaw and timed reaction scripts.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

// bind finger curls from the baker (deg): [prox, dist]
const BIND_CURL = {
  L: { Index: [18, 22], Middle: [22, 26], Ring: [26, 28], Pinky: [30, 30], Thumb: [8, 10] },
  R: { Index: [28, 30], Middle: [34, 36], Ring: [38, 40], Pinky: [42, 44], Thumb: [10, 12] },
};
// absolute curl presets (deg)
const HAND = {
  relaxed: null, // = bind
  open: { Index: [4, 6], Middle: [5, 6], Ring: [6, 8], Pinky: [8, 8], Thumb: [0, 4] },
  point: { Index: [0, 2], Middle: [80, 90], Ring: [85, 95], Pinky: [85, 95], Thumb: [30, 40] },
  fist: { Index: [80, 95], Middle: [85, 95], Ring: [85, 95], Pinky: [85, 95], Thumb: [35, 40] },
  grip: { Index: [62, 70], Middle: [66, 72], Ring: [68, 74], Pinky: [70, 76], Thumb: [25, 30] },
  thumb: { Index: [85, 95], Middle: [88, 95], Ring: [88, 95], Pinky: [88, 95], Thumb: [-20, -10] },
  pinch: { Index: [45, 55], Middle: [55, 65], Ring: [65, 70], Pinky: [70, 75], Thumb: [30, 30] },
  middle: { Index: [88, 124], Middle: [0, 0], Ring: [88, 124], Pinky: [86, 120], Thumb: [72, 58] }, // the finger: tight fist, thumb tucked over it
};
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];

// Arm poses in character space (origin at the hip point, truck axes: front -X, door +Z).
// w: wrist, f: finger direction, n: back-of-hand normal, p: elbow pole, hand: finger preset
const POSES = {
  // left arm (window side)
  L_sill: null, // bind pose
  L_pointDown: { w: V(-0.07, 0.43, 0.62), f: V(-0.15, -0.85, 0.5), n: V(0.1, 0.45, 0.88), p: V(0.6, -0.4, 0.1), hand: 'point' },
  L_pointOut: { w: V(-0.10, 0.47, 0.63), f: V(-0.3, -0.25, 0.92), n: V(0, 1, 0.1), p: V(0.6, -0.6, 0.0), hand: 'point' },
  L_flick: { w: V(-0.12, 0.55, 0.60), f: V(-0.2, 0.25, 0.95), n: V(0, 0.95, -0.25), p: V(0.6, -0.6, 0.1), hand: 'open' },
  // out of the window toward someone standing ahead-left, back of the hand to them, middle finger up
  L_flip: { w: V(-0.21, 0.50, 0.62), f: V(-0.12, 0.95, 0.28), n: V(-0.48, 0.05, 0.87), p: V(0.5, -0.7, 0.3), hand: 'middle' },
  L_thumbBack: { w: V(0.05, 0.66, 0.42), f: V(0.15, 0.9, 0.2), n: V(-0.1, 0.1, 0.99), p: V(0.3, -0.6, 0.6), hand: 'thumb' },
  L_grabSill: { w: V(-0.12, 0.33, 0.56), f: V(-0.1, -0.6, 0.79), n: V(0, 0.8, 0.6), p: V(0.6, -0.5, 0.2), hand: 'grip' },
  // right arm (inside)
  R_rest: null,
  R_open: { w: V(-0.28, 0.33, 0.08), f: V(-0.45, 0.25, 0.86), n: V(0.15, -0.6, -0.78), p: V(0.3, -1, -0.4), hand: 'open' },
  R_point: { w: V(-0.26, 0.40, 0.18), f: V(-0.2, 0.05, 0.98), n: V(0, 1, 0), p: V(0.3, -1, -0.5), hand: 'point' },
  R_wheel: { w: V(-0.40, 0.31, -0.13), f: V(-0.62, 0.62, 0.48), n: V(0.6, 0.25, -0.76), p: V(0.2, -1, -0.7), hand: 'grip' },
  R_shrug: { w: V(-0.25, 0.30, -0.02), f: V(-0.6, 0.2, 0.75), n: V(0, -0.8, -0.6), p: V(0.3, -1, -0.5), hand: 'open' },
};

export class GrandpaAnimator {
  /** opts (other characters on the same rig): {poses, bindCurl, glances: world points ([] = none)} */
  constructor(grandpa, opts = {}) {
    this.g = grandpa;
    this.poses = opts.poses || POSES;
    this.bindCurl = opts.bindCurl || BIND_CURL;
    this.glances = opts.glances || [V(-6, 1.2, -3), V(4, 1.0, -6), V(-2, 0.4, 3)];
    this.B = grandpa.bones;
    this.time = 0;
    this.lookTarget = new THREE.Vector3(0, 1.6, 2);
    this._lookDir = null;
    this.lookOverride = null; // {target: Vector3|fn, until}
    this.arms = {
      L: { pose: 'L_sill', weight: 0, cur: null, target: 'L_sill', dyn: null, speed: 7 },
      R: { pose: 'R_rest', weight: 0, cur: null, target: 'R_rest', dyn: null, speed: 7 },
    };
    this.hands = { L: { preset: 'relaxed', curls: {} }, R: { preset: 'relaxed', curls: {} } };
    this.lean = { back: 0, side: 0, twist: 0, fwd: 0 };
    this.leanT = { back: 0, side: 0, twist: 0, fwd: 0 };
    this.pull = { amount: 0, dir: new THREE.Vector3() };
    this.inertia = { x: 0, z: 0, vx: 0, vz: 0 };
    this.faceT = { smile: 0, frown: 0.35, browUp: 0, browAngry: 0.35, browSad: 0, squint: 0.32, sneer: 0, pucker: 0 };
    this.blinkT = 2;
    this.blinkPhase = -1;
    this.glanceT = 4;
    this.glance = null;
    this.script = null;
    this.speechEnv = 0;
    this.jaw = 0;
    this.nod = 0;
    this.emphasis = 0;
    this.bindLocal = {};
    for (const [n, b] of Object.entries(this.B)) this.bindLocal[n] = b.quaternion.clone();
    for (const s of ['L', 'R']) for (const f of FINGERS) this.hands[s].curls[f] = [...this.bindCurl[s][f]];
  }

  reset() {
    this.script = null;
    this.lookOverride = null;
    this.glance = null;
    for (const s of ['L', 'R']) { this.arms[s].target = s === 'L' ? 'L_sill' : 'R_rest'; this.arms[s].weight = 0; this.arms[s].cur = null; this.arms[s].dyn = null; this.setHand(s, 'relaxed'); }
    this.leanT = { back: 0, side: 0, twist: 0, fwd: 0 };
    this.lean = { back: 0, side: 0, twist: 0, fwd: 0 };
    this.pull.amount = 0;
    this.inertia = { x: 0, z: 0, vx: 0, vz: 0 };
    this.setFace({ smile: 0, frown: 0.35, browUp: 0, browAngry: 0.35, browSad: 0, squint: 0.32, sneer: 0, pucker: 0 });
    this.g.resetPose();
  }

  // ---------------------------------------------------------------- high level controls
  setArm(side, pose, opts = {}) {
    const a = this.arms[side];
    a.target = pose;
    a.dyn = opts.dyn || null; // function returning world-space wrist target
    a.speed = opts.speed ?? 7;
    if (opts.hand !== undefined) this.setHand(side, opts.hand);
    else this.setHand(side, this.poses[pose]?.hand || 'relaxed');
  }
  setHand(side, preset) { this.hands[side].preset = preset; }
  setFace(f) { Object.assign(this.faceT, f); }
  lookAt(target, seconds = 1.5) { this.lookOverride = { target, until: this.time + seconds }; }
  setLean(l) { Object.assign(this.leanT, l); }

  /** run a reaction script: list of [time, fn]; replaces any running script */
  play(name, steps, duration) {
    this.script = { name, steps: steps.slice().sort((a, b) => a[0] - b[0]), t: 0, i: 0, duration };
  }
  get busy() { return !!this.script; }

  idlePose() {
    this.setArm('L', 'L_sill'); this.setArm('R', 'R_rest');
    this.setLean({ back: 0, side: 0, twist: 0, fwd: 0 });
    this.setFace({ smile: 0, frown: 0.35, browUp: 0, browAngry: 0.35, browSad: 0, squint: 0.32, sneer: 0 });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, ctx) {
    this.time += dt;
    const g = this.g, B = this.B;
    // script
    if (this.script) {
      const s = this.script;
      s.t += dt;
      while (s.i < s.steps.length && s.steps[s.i][0] <= s.t) { s.steps[s.i][1](); s.i++; }
      if (s.t >= s.duration) { this.script = null; this.idlePose(); }
    }
    g.resetPose();
    // ---- torso: breathing, lean, inertia, pull
    for (const k of Object.keys(this.lean)) this.lean[k] = damp(this.lean[k], this.leanT[k], 5, dt);
    const br = Math.sin(this.time * 2 * Math.PI / 4.2);
    // truck acceleration -> body lags behind (spring)
    const I = this.inertia;
    const acc = ctx?.truckAccel || _v1.set(0, 0, 0);
    I.vx += (-acc.x * 0.012 - I.x * 60 - I.vx * 9) * dt;
    I.vz += (-acc.z * 0.012 - I.z * 60 - I.vz * 9) * dt;
    I.x += I.vx * dt; I.z += I.vz * dt;
    I.x = THREE.MathUtils.clamp(I.x, -0.12, 0.12); I.z = THREE.MathUtils.clamp(I.z, -0.12, 0.12);
    const pullA = this.pull.amount;
    this.#rotLocal(B.spine, (-this.lean.back * 0.12 + br * 0.006 + this.lean.fwd * 0.12) + I.x * 0.8, this.lean.twist * 0.08, (-this.lean.side * 0.08) - I.z * 0.8 - pullA * 0.09);
    this.#rotLocal(B.chest, -this.lean.back * 0.08 + br * 0.012 + this.lean.fwd * 0.06, this.lean.twist * 0.1, -this.lean.side * 0.05 - pullA * 0.06);
    // shoulders rise with breath
    B.upperArmL.position.y += br * 0.002; B.upperArmR.position.y += br * 0.002;
    // ---- head look
    this.#updateLook(dt, ctx);
    // ---- arms
    for (const side of ['L', 'R']) this.#updateArm(side, dt);
    // sleeve pull: drag the left upper arm toward the line
    if (pullA > 0.001) {
      const ua = B.upperArmL;
      ua.parent.updateWorldMatrix(true, false);
      const pq = ua.parent.getWorldQuaternion(_q1).invert();
      const localDir = this.pull.dir.clone().applyQuaternion(pq);
      // rotate so the arm's -Y swings slightly toward the pull direction
      const axis = new THREE.Vector3(0, -1, 0).applyQuaternion(ua.quaternion).cross(localDir).normalize();
      if (axis.lengthSq() > 0) ua.quaternion.premultiply(_q2.setFromAxisAngle(axis, pullA * 0.22));
    }
    // ---- fingers
    for (const side of ['L', 'R']) this.#updateFingers(side, dt);
    // ---- face
    this.#updateFace(dt, ctx);
  }

  #rotLocal(bone, x, y, z) {
    _q1.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
    bone.quaternion.multiply(_q1);
  }

  #updateLook(dt, ctx) {
    const B = this.B;
    // pick target
    let target = this.lookTarget;
    if (this.lookOverride) {
      if (this.time > this.lookOverride.until) this.lookOverride = null;
      else target = typeof this.lookOverride.target === 'function' ? this.lookOverride.target() : this.lookOverride.target;
    }
    // idle glances away (road / mirror) when nothing is happening
    this.glanceT -= dt;
    if (!this.script && !this.lookOverride && ctx && !ctx.speaking && this.glanceT < 0 && this.glances.length) {
      this.glanceT = 5 + Math.random() * 6;
      const choices = this.glances;
      this.glance = { target: choices[Math.floor(Math.random() * choices.length)], until: this.time + 0.8 + Math.random() * 0.7 };
    }
    if (this.glance && this.time < this.glance.until && !this.script) {
      const tw = this.g.group.parent ? this.glance.target.clone() : this.glance.target;
      target = tw;
    }
    const neck = B.neck, head = B.head;
    neck.updateWorldMatrix(true, true);
    const hp = head.getWorldPosition(_v1);
    const desired = _v2.copy(target).sub(hp).normalize();
    if (!this._lookDir) this._lookDir = desired.clone();
    // head turns with a short ease; slightly faster for big moves
    const ang = this._lookDir.angleTo(desired);
    const rate = 4 + Math.min(ang, 1.2) * 4;
    this._lookDir.lerp(desired, 1 - Math.exp(-rate * dt)).normalize();
    // current head forward
    const hq = head.getWorldQuaternion(_q1);
    const fwd = _v3.set(0, 0, 1).applyQuaternion(hq);
    const up = new THREE.Vector3(0, 1, 0);
    // limit: don't turn more than ~80deg from the bind direction
    const dir = this._lookDir.clone();
    const a = fwd.angleTo(dir);
    const maxA = 1.25;
    if (a > maxA) dir.copy(fwd).lerp(dir, maxA / a).normalize();
    // limit pitch
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.dot(up), -1, 1));
    const cp = THREE.MathUtils.clamp(pitch, -0.45, 0.4);
    if (cp !== pitch) { const hz = Math.cos(cp); const hx = new THREE.Vector3(dir.x, 0, dir.z).normalize(); dir.set(hx.x * hz, Math.sin(cp), hx.z * hz); }
    const q = new THREE.Quaternion().setFromUnitVectors(fwd, dir);
    // add speech nod
    const nodQ = new THREE.Quaternion().setFromAxisAngle(_v3.set(1, 0, 0).applyQuaternion(hq), this.nod);
    q.premultiply(nodQ);
    // split rotation: 35% neck, 65% head (both applied in world space)
    const qNeck = new THREE.Quaternion().slerp(q, 0.35);
    const nq = neck.getWorldQuaternion(new THREE.Quaternion());
    const npq = neck.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    neck.quaternion.copy(npq.multiply(qNeck.clone().multiply(nq)));
    neck.updateWorldMatrix(false, true);
    const hq2 = head.getWorldQuaternion(new THREE.Quaternion());
    const fwd2 = new THREE.Vector3(0, 0, 1).applyQuaternion(hq2);
    const q2 = new THREE.Quaternion().setFromUnitVectors(fwd2, dir).premultiply(nodQ);
    const hpq = head.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    head.quaternion.copy(hpq.multiply(q2.multiply(hq2)));
    head.updateWorldMatrix(false, true);
    // eyes lead the head
    this.g.gazeTarget.copy(target);
  }

  #charToWorld(v, out) { return out.copy(v).applyMatrix4(this.g.group.matrixWorld); }
  #dirToWorld(v, out) { return out.copy(v).transformDirection(this.g.group.matrixWorld); }

  #updateArm(side, dt) {
    const a = this.arms[side];
    const B = this.B;
    const isBind = !this.poses[a.target] && !a.dyn;
    const wTarget = isBind ? 0 : 1;
    a.weight = damp(a.weight, wTarget, a.speed * 0.9, dt);
    if (a.weight < 0.002 && isBind) { a.cur = null; return; }
    // desired pose (char space)
    let P = this.poses[a.target];
    const sideS = side === 'L' ? 1 : -1;
    let w, f, n, p;
    if (a.dyn) {
      const d = a.dyn();
      w = d.w; f = d.f; n = d.n; p = d.p;
    } else if (P) { w = P.w; f = P.f; n = P.n; p = P.p; }
    else if (a.cur) { w = a.cur.w; f = a.cur.f; n = a.cur.n; p = a.cur.p; }
    else return;
    if (!a.cur) {
      // start from the current (bind) wrist so blending is continuous
      const hb = B['hand' + side];
      hb.updateWorldMatrix(true, false);
      const inv = _m.copy(this.g.group.matrixWorld).invert();
      const cw = hb.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const hq = hb.getWorldQuaternion(new THREE.Quaternion());
      const gq = this.g.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      const cf = new THREE.Vector3(0, -1, 0).applyQuaternion(hq).applyQuaternion(gq);
      const cn = new THREE.Vector3(sideS, 0, 0).applyQuaternion(hq).applyQuaternion(gq);
      a.cur = { w: cw, f: cf, n: cn, p: (p || V(0.3, -1, 0)).clone() };
    }
    const k = 1 - Math.exp(-a.speed * dt);
    a.cur.w.lerp(w, k); a.cur.f.lerp(f, k).normalize(); a.cur.n.lerp(n, k).normalize(); a.cur.p.lerp(p, k).normalize();
    this.#solveArm(side, a.cur, a.weight);
  }

  #solveArm(side, pose, weight) {
    const B = this.B, s = side === 'L' ? 1 : -1;
    const ua = B['upperArm' + side], fa = B['forearm' + side], hd = B['hand' + side];
    ua.parent.updateWorldMatrix(true, false);
    ua.updateWorldMatrix(false, false);
    const S = ua.getWorldPosition(new THREE.Vector3());
    const W = this.#charToWorld(pose.w, new THREE.Vector3());
    const F = this.#dirToWorld(pose.f, new THREE.Vector3()).normalize();
    const N = this.#dirToWorld(pose.n, new THREE.Vector3()).normalize();
    const Pp = this.#dirToWorld(pose.p, new THREE.Vector3()).normalize();
    // IK targets and shoulder positions are in world space, including vehicle shrink.
    const scale = this.g.group.getWorldScale(new THREE.Vector3()).x;
    const la = 0.30 * scale, lb = 0.255 * scale;
    const D = W.clone().sub(S);
    const d = THREE.MathUtils.clamp(D.length(), 0.1 * scale, la + lb - 0.004 * scale);
    D.normalize();
    const Wc = S.clone().addScaledVector(D, d);
    const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const pole = Pp.clone().addScaledVector(D, -Pp.dot(D)).normalize();
    const E = S.clone().addScaledVector(D, la * cosA).addScaledVector(pole, la * sinA);
    const basis = (Y, Zhint) => {
      const Z = Zhint.clone().addScaledVector(Y, -Zhint.dot(Y)).normalize();
      const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    };
    const basisX = (Y, Xhint) => {
      const X = Xhint.clone().addScaledVector(Y, -Xhint.dot(Y)).normalize();
      const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    };
    const Yua = S.clone().sub(E).normalize();
    const qUA = basis(Yua, Wc.clone().sub(E));
    const Yfa = E.clone().sub(Wc).normalize();
    const Xs = N.clone().multiplyScalar(s);
    const qFA = basisX(Yfa, Xs);
    const Yhd = F.clone().negate();
    const qHD = basisX(Yhd, Xs);
    // world -> local and blend with the current (bind) local rotation
    const parentQ = ua.parent.getWorldQuaternion(new THREE.Quaternion());
    const lUA = parentQ.clone().invert().multiply(qUA);
    const lFA = qUA.clone().invert().multiply(qFA);
    const lHD = qFA.clone().invert().multiply(qHD);
    ua.quaternion.slerp(lUA, weight);
    fa.quaternion.slerp(lFA, weight);
    hd.quaternion.slerp(lHD, weight);
  }

  #updateFingers(side, dt) {
    const h = this.hands[side];
    const preset = HAND[h.preset] || this.bindCurl[side];
    const s = side === 'L' ? 1 : -1;
    for (const f of FINGERS) {
      const c = h.curls[f], tgt = preset[f];
      c[0] = damp(c[0], tgt[0], 12, dt); c[1] = damp(c[1], tgt[1], 12, dt);
      const b1 = this.B[f + side + '1'], b2 = this.B[f + side + '2'];
      const d1 = (c[0] - this.bindCurl[side][f][0]) * Math.PI / 180;
      const d2 = (c[1] - this.bindCurl[side][f][1]) * Math.PI / 180;
      b1.quaternion.multiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), -d1 * s));
      b2.quaternion.multiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), -d2 * s));
    }
  }

  #updateFace(dt, ctx) {
    const f = this.g.face;
    for (const k of Object.keys(this.faceT)) f[k] = damp(f[k], this.faceT[k], 8, dt);
    // speech: jaw follows the audio envelope, with quick attack / slower release
    const env = ctx?.speechEnv ?? 0;
    const tgt = Math.min(0.85, Math.max(0, (env - 0.08) * 0.95));
    this.jaw = tgt > this.jaw ? damp(this.jaw, tgt, 30, dt) : damp(this.jaw, tgt, 14, dt);
    f.jaw = this.jaw;
    // emphasis: brows and nods track loud syllables
    const prevE = this.emphasis;
    this.emphasis = damp(this.emphasis, env, 6, dt);
    this.nod = damp(this.nod, (env - prevE) * 0.9 + env * 0.03, 10, dt);
    f.browUp += Math.max(0, env - 0.5) * 0.25;
    // blinking
    this.blinkT -= dt;
    if (this.blinkT < 0 && this.blinkPhase < 0) { this.blinkPhase = 0; this.blinkT = 1.8 + Math.random() * 4.2; if (Math.random() < 0.15) this.blinkT = 0.25; }
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.16;
      f.blink = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
      if (this.blinkPhase >= 1) { this.blinkPhase = -1; f.blink = 0; }
    }
    this.g.applyFace(dt);
  }

  blink() { if (this.blinkPhase < 0) this.blinkPhase = 0; }
}

export { POSES };
