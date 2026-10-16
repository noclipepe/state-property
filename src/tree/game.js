// WITNESS POV: hiding on a branch over the pond, watching the original argument through
// binoculars. watch → get curious → stare too long → get spotted → panic → fall in the lake.
//
// States: loading → ready → play → caught (HEY!, flinch, the branch bends and cracks) → falling
//         → underwater (the ending) ; restart() always returns to a fresh 'play'.
import * as THREE from 'three';
import { createWorld } from '../scene/world.js';
import { loadTruck } from '../scene/truck.js';
import { loadGrandpa, loadFisherman } from '../character/grandpa.js';
import { GrandpaAnimator } from '../character/animator.js';
import { Fisherman } from '../driver/fisherman.js';
import { HOME, FISHER_LOCAL, BUCKET_LOCAL } from '../driver/layout.js';
import { toWorld } from '../ant/layout.js';
import { Bucket } from '../fish/bucket.js';
import { AntConversation } from '../ant/conversation.js';
import { V, clamp, smooth, mix } from '../god/common.js';
import { TreeAudio } from './audio.js';
import { TreeInput } from './input.js';
import { TreeUI } from './ui.js';
import { Perch, POND, inWater, EYE } from './perch.js';
import { Watchers } from './watchers.js';
import { Underwater } from './underwater.js';

// The fisherman's own "Hey…" from the original recording; the driver's is the same take, lower.
const HEY = { fisherman: { offset: 7.62, duration: 0.6, rate: 1 }, driver: { offset: 7.62, duration: 0.6, rate: 0.8 } };
const LENS_DEGREES = 13; // what one lens shows, edge to edge
// The failure sequence, in seconds after the shout.
const T = { notice: 0.4, flinch: 0.8, bend: 1.0, crack: 1.45, fall: 2.15, end: 3.6 };

export class TreeGame {
  constructor(options) {
    Object.assign(this, options);
    this.state = 'loading'; this.time = 0; this.paused = false; this.destroyed = false; this.clips = {};
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.abort = new AbortController();
    this.audio = new TreeAudio();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.03, 260); this.camera.rotation.order = 'YXZ';
    this.size = { w: 1, h: 1 }; this.lensAngle = THREE.MathUtils.degToRad(LENS_DEGREES / 2);
    this.ui = new TreeUI(this);
    this.input = new TreeInput(this);
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden; this.input.clear();
      if (this.paused) this.audio.suspend(); else if (this.state !== 'ready' && this.state !== 'loading') this.audio.unlock();
    }, { signal: this.abort.signal });
    addEventListener('pagehide', () => this.destroy(), { signal: this.abort.signal });
  }

  async load() {
    this.ui.progress(0.05, 'Climbing the tree…');
    this.world = createWorld(this.renderer, this.quality, { grass: { x: 2.5, z: 8.2, r: 14 }, grassScale: 1.15 });
    this.scene = this.world.scene;
    const [truck, driver, fisher] = await Promise.all([
      loadTruck((p) => this.ui.progress(0.1 + p * 0.5, 'Finding a good branch…')), loadGrandpa(), loadFisherman(), this.loadClips()]);
    if (this.destroyed) return;
    this.truck = truck; this.driver = driver;
    this.scene.add(truck.root); truck.sim.home = { ...HOME }; truck.sim.reset();
    driver.group.position.fromArray(driver.header.seat); truck.body.add(driver.group);
    this.driverAnim = new GrandpaAnimator(driver, { glances: [] });
    this.fisher = new Fisherman(fisher, this.scene);
    const fp = toWorld(V(...FISHER_LOCAL)), eye = this.eyeWorld();
    this.fisher.setHome(fp, Math.atan2(eye.x - fp.x, eye.z - fp.z));
    this.bucket = new Bucket(this.scene, toWorld(V(...BUCKET_LOCAL)));
    this.conv = new AntConversation({ audio: this.audio, clips: this.clips, ui: this.ui, onAction: (...a) => this.perform(...a) });
    // the argument, from the branch: aim between the two men
    this.truck.root.updateMatrixWorld(true); this.fisher.c.group.updateMatrixWorld(true);
    const lookAt = this.fisher.headWorld.lerp(this.eyeWorld(), 0.5);
    this.perch = new Perch(this.scene, { look: lookAt, leafMaterial: this.world.trees.leaves.material, leafGeometry: this.world.trees.leaves.geometry, quality: this.quality });
    this.watchPoint = this.perch.frame.localToWorld(EYE.clone());
    const d = this.perch.frame.worldToLocal(lookAt.clone()).sub(EYE).normalize();
    this.aimHome = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) - 0.035 };
    this.watchers = new Watchers(this);
    this.underwater = new Underwater(this.renderer, this.scene, this.world.ground);
    this.#planEnding();
    // light bouncing off the water onto the faces at the bank (off until the ending: no shader recompiles)
    this.bounce = new THREE.PointLight(0xd8f2e6, 0, 4.5, 1.2);
    this.bounce.position.copy(this.ending.fisher).lerp(this.ending.driver, 0.5).lerp(this.ending.under, 0.35).setY(0.25); this.scene.add(this.bounce);
    const sc = this.world.sun.shadow.camera; sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.far = 60; sc.updateProjectionMatrix();
    this.focus = V(2.4, 0, 8.6);
    this.reset();
    this.resize(this.size.w, this.size.h);
    this.world.update(0, this.focus);
    this.renderer.compile(this.scene, this.camera); this.renderer.render(this.scene, this.camera);
    this.ui.progress(1, 'Ready. Stay quiet.'); this.ui.ready();
    this.state = 'ready'; window.__ready = true;
    let previous = null;
    const loop = (now) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = previous === null ? 0 : Math.min((now - previous) / 1000, 0.05); previous = now;
      if (!document.hidden && !this.paused) this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async loadClips() {
    const r = await fetch('assets/audio/ant_dialogue.json');
    if (!r.ok) throw Error('Dialogue unavailable');
    const lines = await r.json();
    await Promise.all(Object.entries(lines).map(async ([id, line]) => { this.clips[id] = { line, buffer: await this.audio.decode(line.file) }; }));
    this.audio.dialogue = this.clips.ant_argument;
  }

  eyeWorld() { this.truck.root.updateMatrixWorld(true); return this.driver.bones.eyeL.getWorldPosition(V()); }
  get controllable() { return this.state === 'play' && !this.paused; }

  /** where the two men stand to peer into the water after the splash, and where you sink */
  #planEnding() {
    const seat = this.perch.frame.position, men = this.fisher.home.clone().lerp(this.eyeWorld().setY(0), 0.5);
    const toMen = men.clone().sub(seat).setY(0).normalize();
    const land = seat.clone().addScaledVector(this.perch.frame.localToWorld(V(0, 0, 1)).sub(seat).setY(0).normalize(), 0.35).setY(0);
    let edge = land.clone();
    for (let s = 0; s < 8 && inWater(edge.x, edge.z, -0.25); s += 0.05) edge = land.clone().addScaledVector(toMen, s);
    const side = V(-toMen.z, 0, toMen.x);
    this.ending = {
      // deep enough, and close enough to the bank, that both men stand inside Snell's window overhead
      land, under: edge.clone().addScaledVector(toMen, -1.55).setY(-1.15),
      fisher: edge.clone().addScaledVector(side, 0.7).addScaledVector(toMen, 0.05),
      driver: edge.clone().addScaledVector(side, -0.6).addScaledVector(toMen, -0.1),
    };
  }

  // ------------------------------------------------------------------ flow
  start() {
    if (this.state !== 'ready') return;
    this.audio.unlock(); this.ui.begin(); this.restart();
  }

  reset() {
    if (this.state !== 'loading') this.state = 'reset';
    this.input.clear(); this.audio.resetEffects(); this.audio.underwater(0);
    this.conv.reset(); this.loopPause = 0;
    // characters back to the original staging
    if (this.driver.group.parent !== this.truck.body) this.truck.body.add(this.driver.group);
    this.driver.group.position.fromArray(this.driver.header.seat); this.driver.group.quaternion.identity();
    this.fisher.pos.copy(this.fisher.home); this.fisher.yaw = this.fisher.homeYaw;
    this.fisher.reset(); this.fisher.faceToward(() => this.eyeWorld()); this.fisher.lookAt(() => this.eyeWorld(), 600);
    this.driverAnim.reset(); this.driverAnim.idlePose();
    this.watchers.reset(); this.perch.reset(); this.underwater.enable(false); this.bounce.intensity = 0;
    this.caught = null; this.fall = null; this.sink = null; this.shout = null; this.flinch = 0;
    this.raise = 0; this.aimAngles = { ...this.aimHome }; this.aimGoal = null; this.body = null; this.time = 0; this.watched = 0; this.watchedFor = 0;
    this.ui.reset();
    for (let i = 0; i < 30; i++) this.poseActors(1 / 60);
    this.perch.update(0, this.reduced); this.placeCamera(0); this.perch.updateBody(0, this.camera, 0);
  }

  restart() {
    if (this.state === 'loading') return;
    this.reset(); this.state = 'play'; this.ui.hideEnd(); this.audio.unlock(); this.conv.begin(0.5); // the HUD comes back with the new run
    this.resize(this.size.w, this.size.h);
  }

  // ------------------------------------------------------------------ binoculars
  /** turn the binoculars toward a point on the screen while they come up (press-and-hold target) */
  aimToward(clientX, clientY) {
    if (!this.controllable) return;
    const r = this.canvas.getBoundingClientRect(), c = this.camera;
    const dir = V((clientX - r.left) / r.width * 2 - 1, 1 - (clientY - r.top) / r.height * 2, 0.5).unproject(c).sub(c.position).normalize();
    dir.applyQuaternion(this.perch.frame.getWorldQuaternion(new THREE.Quaternion()).invert());
    const h = this.aimHome;
    this.aimGoal = { yaw: clamp(Math.atan2(-dir.x, -dir.z), h.yaw - 0.95, h.yaw + 0.95), pitch: clamp(Math.asin(dir.y), h.pitch - 0.6, h.pitch + 0.45) };
  }

  aim(dx, dy) {
    if (!this.controllable) return;
    if (dx || dy) this.aimGoal = null; // a drag takes over
    const k = THREE.MathUtils.degToRad(this.camera.fov) / Math.max(1, this.size.h);
    const a = this.aimAngles, h = this.aimHome;
    a.yaw = clamp(a.yaw - dx * k, h.yaw - 0.95, h.yaw + 0.95);
    a.pitch = clamp(a.pitch - dy * k, h.pitch - 0.6, h.pitch + 0.45);
  }

  /** aim angles (frame space, from the raised eye) that centre a world point: tests and the showcase */
  anglesTo(point) {
    const d = this.perch.frame.worldToLocal(point.clone()).sub(this.perch.eyeRaised).normalize();
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) };
  }

  /** how many parts of the tree or of your own body are between the eye and a world point */
  occluders(point) {
    const dir = point.clone().sub(this.camera.position), far = dir.length();
    const rc = new THREE.Raycaster(this.camera.position, dir.normalize(), 0.05, far - 0.3);
    return rc.intersectObject(this.perch.frame, true).length + rc.intersectObjects([this.perch.binoculars, ...this.perch.hands.flatMap((h) => [h.group, h.arm])], true).length;
  }

  updateRaise(dt) {
    // swing toward the pressed point as the binoculars rise, so it stays under the finger
    if (this.aimGoal && this.state === 'play') {
      const a = this.aimAngles, g = this.aimGoal, k = 1 - Math.exp(-9 * dt);
      a.yaw += (g.yaw - a.yaw) * k; a.pitch += (g.pitch - a.pitch) * k;
      if (Math.abs(g.yaw - a.yaw) + Math.abs(g.pitch - a.pitch) < 0.002 || !this.input.holding) this.aimGoal = null;
    }
    // after the shout the binoculars stay where they were until the flinch knocks them down
    const want = this.state === 'play' ? (this.input.holding ? 1 : 0) : this.state === 'caught' && this.flinch === 0 ? this.caught.raise : 0;
    // a quick, smooth lift; the flinch drops them much faster
    const rate = this.flinch > 0 ? 11 : want ? 7 : 8.5;
    this.raise += (want - this.raise) * (1 - Math.exp(-rate * dt));
    if (Math.abs(want - this.raise) < 0.002) this.raise = want;
  }

  placeCamera(dt) {
    const c = this.camera;
    if (this.state === 'underwater') return this.#underwaterCamera(dt);
    if (this.fall) return this.#fallCamera(dt);
    const e = this.raise * this.raise * (3 - 2 * this.raise);
    const a = this.aimAngles, B = this.#bodyPose(dt, e);
    // flinch: a jerk backward and up, then the branch takes over
    const fl = this.flinch;
    const extra = V(B.x, B.y - 0.04 * fl, B.z + (fl > 0 ? 0.13 * smooth(fl, 0, 0.6) : 0));
    this.perch.eyeWorld(e, extra, c.position);
    const seatQ = this.perch.seat.getWorldQuaternion(new THREE.Quaternion());
    const frameQ = this.perch.frame.getWorldQuaternion(new THREE.Quaternion()).slerp(seatQ, this.reduced ? 0.15 : 0.4);
    const jolt = fl > 0 ? Math.sin(Math.min(1, fl * 1.4) * Math.PI) * 0.08 : 0;
    c.quaternion.copy(frameQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a.pitch + jolt, a.yaw, B.roll, 'YXZ')));
    const lensFov = this.#lensFov();
    const fov = Math.exp(mix(Math.log(this.baseFov), Math.log(lensFov), e));
    if (Math.abs(fov - c.fov) > 1e-4) { c.fov = fov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld(true);
  }

  /**
   * The body follows the look: turn right and you lean a little to the right (and tip your head
   * that way), look down and you lean forward. On top of that, a slow sway on the branch.
   * Seat-space offsets for the eye, plus the torso turn the arms and binoculars follow.
   */
  #bodyPose(dt, raised) {
    const a = this.aimAngles, h = this.aimHome, b = this.body || (this.body = { x: 0, y: 0, z: 0, roll: 0, yaw: 0 });
    const yaw = a.yaw - h.yaw, pitch = a.pitch - h.pitch, k = dt ? 1 - Math.exp(-6 * dt) : 1;
    const t = this.perch.time, sway = this.reduced || this.state === 'falling' ? 0 : 1;
    const want = {
      x: -yaw * 0.09 + Math.sin(t * 1.25) * 0.018 * sway,
      y: -Math.abs(yaw) * 0.02 + Math.sin(t * 2.5 + 0.6) * 0.007 * sway,
      z: Math.min(0, pitch) * 0.1,
      roll: (yaw * 0.07 + Math.sin(t * 1.25 + 0.4) * 0.014 * sway) * (1 - 0.65 * raised),
      yaw: yaw * 0.45,
    };
    for (const key of Object.keys(want)) b[key] += (want[key] - b[key]) * k;
    return b;
  }

  #lensFov() { return clamp(LENS_DEGREES * this.size.h / (2 * this.lensPx), 6, 40); }

  // ------------------------------------------------------------------ getting caught
  detect(who) {
    if (this.caught || this.state !== 'play') return false; // exactly one detection per run
    const w = this.watchers[who];
    w.value = 1; w.level = 3;
    this.state = 'caught';
    this.caught = { who, t: 0, done: {}, raise: this.raise };
    this.watched = this.time;
    this.input.clear(); this.conv.reset();
    this.audio.alert(3);
    this.shout = { who, ...this.audio.say(who, HEY[who]) };
    this.ui.callout(who); this.ui.announce(w, 3);
    this.ui.setSubtitle({ who, text: 'HEY!' });
    if (who === 'fisherman') this.fisher.setLeft('raise'); else this.driverAnim.setArm('L', 'L_pointOut', { speed: 9 });
    return true;
  }

  #caughtStep(dt) {
    const C = this.caught; C.t += dt;
    const once = (key, at, fn) => { if (!C.done[key] && C.t >= at) { C.done[key] = true; fn(); } };
    once('notice', T.notice, () => {
      const other = this.watchers.other(this.watchers[C.who]);
      this.watchers.notice(other); this.ui.announce(other, 3);
    });
    once('flinch', T.flinch, () => { this.flinch = 0.001; this.audio.leaves(0.16); });
    once('bend', T.bend, () => { this.perch.bendTarget = 0.08; this.audio.bend(); });
    once('crack', T.crack, () => {
      this.perch.crack(); this.audio.crack();
      // the binoculars slip out of your hands while you grab for the branch
      const forward = this.camera.getWorldDirection(V()).setY(0).normalize();
      this.perch.dropBinoculars(forward.multiplyScalar(0.6).add(V(0, 0.4, 0)));
      this.perch.handMode = 'reach';
      this.ui.setSubtitle(null);
    });
    once('fall', T.fall, () => {
      this.perch.snap(); this.audio.leaves(0.2);
      const back = this.perch.frame.localToWorld(V(0, 0, 1)).sub(this.perch.frame.position).setY(0).normalize();
      // start from exactly where the camera is (position, rotation and the seat's tilt): no jump
      this.fall = { vel: back.multiplyScalar(0.5).add(V(0, 0.12, 0)), t: 0, q0: this.camera.quaternion.clone(), yaw: this.aimAngles.yaw };
      this.perch.handMode = 'flail'; this.perch.legs.visible = false;
      this.state = 'falling';
    });
    if (this.flinch > 0) this.flinch = Math.min(1, this.flinch + dt * 2.2);
    // once it cracks you look down at the branch giving way under you
    if (C.done.crack && !this.fall) { const a = this.aimAngles, k = 1 - Math.exp(-3.5 * dt); a.pitch += (this.aimHome.pitch - 0.62 - a.pitch) * k; a.yaw += (this.aimHome.yaw - a.yaw) * k; }
  }

  #fallCamera(dt) {
    const F = this.fall, c = this.camera;
    dt *= 0.8; F.t += dt; // a touch of slow motion keeps the fall readable
    // gravity eases in as you slide off the seat, so the drop starts softly
    F.vel.y -= 9.8 * smooth(F.t, 0, 0.35) * dt; c.position.addScaledVector(F.vel, dt);
    // restrained: one smooth tip backward to see the branch you fell from, a little roll, no spin
    const frameQ = this.perch.frame.getWorldQuaternion(new THREE.Quaternion());
    const target = frameQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.reduced ? 0.25 : 0.55, F.yaw, this.reduced ? 0.03 : 0.1, 'YXZ')));
    c.quaternion.copy(F.q0).slerp(target, smooth(F.t, 0, 1.25));
    if (Math.abs(c.fov - this.baseFov) > 1e-3) { c.fov += (this.baseFov - c.fov) * (1 - Math.exp(-10 * dt)); c.updateProjectionMatrix(); }
    c.updateMatrixWorld(true);
    if (c.position.y < POND.y + 0.12) this.#splash();
  }

  #splash() {
    this.fall = null; this.state = 'underwater';
    this.audio.splash(1.4); this.audio.underwater(1); this.ui.flash();
    this.ui.setSubtitle(null);
    // the cut under water hides the men walking over: now they stand on the bank, peering down
    const E = this.ending, under = E.under;
    this.fisher.pos.copy(E.fisher); this.fisher.walkVel.set(0, 0, 0);
    this.fisher.yaw = Math.atan2(under.x - E.fisher.x, under.z - E.fisher.z);
    this.fisher.faceToward(under.clone()); this.fisher.setLean({ fwd: 1 }); this.fisher.setLeft('rod');
    this.fisher.setFace({ browUp: 0.7, frown: 0.3, squint: 0, browAngry: 0.1, smile: 0 });
    // the driver crouches at the edge: his seated pose, hips at knee height, tipped forward
    const g = this.driver.group; this.scene.add(g);
    const dir = under.clone().sub(E.driver).setY(0).normalize();
    g.position.set(E.driver.x, 0.64, E.driver.z);
    g.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(dir.z, -dir.x), 0)).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.3));
    // the seated pose's feet and shins must stay above the bank: seen from under water, anything
    // below the ground would show through. Lift him until the lowest sole clears the grass.
    g.updateMatrixWorld(true);
    const B = this.driver.bones, low = Math.min(...['footL', 'footR', 'shinL', 'shinR'].map((n) => B[n].getWorldPosition(V()).y - (n.startsWith('foot') ? 0.11 : 0.07)));
    if (low < 0.06) { g.position.y += 0.06 - low; g.updateMatrixWorld(true); }
    this.driverAnim.setArm('L', 'L_pointDown', { speed: 6 }); this.driverAnim.setArm('R', 'R_rest');
    this.driverAnim.setLean({ fwd: 1 }); this.driverAnim.setFace({ browUp: 0.6, browAngry: 0.2, frown: 0.3, squint: 0 });
    for (const w of this.watchers.list) { w.level = 3; }
    this.callout = null; this.ui.calloutWho = null; document.getElementById('callout').hidden = true;
    this.perch.handsVisible = false; this.perch.legs.visible = false; this.perch.loose = null; this.perch.sinking = true;
    this.perch.pivot.visible = false; // the broken end went into the water with you
    this.bounce.intensity = 5;
    this.perch.binoculars.visible = true;
    // the camera keeps moving from the point of impact: down through the bubbles, turning up to the bank
    this.sink = { t: 0, spin: Math.random() * 6, from: this.camera.position.clone().setY(POND.y - 0.06), fromQ: this.camera.quaternion.clone() };
    this.#underwaterCamera(0);
    this.underwater.enable(true, this.camera);
  }

  #underwaterCamera(dt) {
    const S = this.sink, c = this.camera; S.t += dt;
    const E = this.ending, drift = Math.min(S.t, 3);
    const blend = smooth(S.t, 0, 1.7);
    c.position.copy(E.under).add(V(Math.sin(S.t * 0.7) * 0.04, -drift * 0.035, Math.cos(S.t * 0.5) * 0.04)).lerp(S.from, 1 - blend);
    // the men leaned over the bank; look up at them (they come into view as you settle)
    this.truck.root.updateMatrixWorld(true);
    // aim below them, so they sit in the upper half of the view, above the ending card
    const look = this.fisher.headWorld.lerp(this.driver.bones.head.getWorldPosition(V()), 0.5).add(V(0, -0.85 - 0.4 * (1 - smooth(S.t, 0, 1.4)), 0));
    const m = new THREE.Matrix4().lookAt(c.position, look, V(0, 1, 0));
    const target = new THREE.Quaternion().setFromRotationMatrix(m);
    if (blend < 1) c.quaternion.copy(S.fromQ).slerp(target, blend); else c.quaternion.slerp(target, 1 - Math.exp(-3 * dt));
    if (Math.abs(c.fov - this.baseFov) > 1e-3) { c.fov = this.baseFov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld(true);
    // the binoculars sink slowly past the lens
    const B = this.perch.binoculars, f = c.getWorldDirection(V()), up = V(0, 1, 0).applyQuaternion(c.quaternion), right = V(1, 0, 0).applyQuaternion(c.quaternion);
    B.position.copy(c.position).addScaledVector(f, 0.62).addScaledVector(up, 0.3 - S.t * 0.075).addScaledVector(right, 0.06 + Math.sin(S.t * 0.8) * 0.03);
    B.rotation.set(0.6 + S.t * 0.25, S.spin + S.t * 0.35, 0.3 + Math.sin(S.t) * 0.2);
    B.updateMatrixWorld(true);
    if (S.t > T.end && !S.shown) {
      S.shown = true;
      const by = this.caught?.who === 'driver' ? 'the driver' : 'the fisherman';
      const score = Math.floor(this.watchedFor * 10) / 10;
      let best = 0;
      try { best = Number(localStorage.getItem('state-property.witness.best')) || 0; if (score > best) localStorage.setItem('state-property.witness.best', String(score)); } catch { /* storage unavailable */ }
      this.ui.showEnd(score, by, best);
    }
  }

  // ------------------------------------------------------------------ characters
  perform(who, action, arg, extra) {
    const W = this.watchers;
    if (who === 'd') { if (action === 'arm' && W.driver.level < 2) this.driverAnim.setArm(arg[0], arg === 'R_pocket' ? 'R_rest' : arg, { speed: extra ?? 7 }); return; }
    const f = this.fisher, busy = W.fisherman.level > 0;
    if (action === 'listen' && !busy) f.lookAt(() => this.eyeWorld(), 600);
    if (action === 'face' && !busy) f.setFace(arg);
    if (action === 'gesture' && !busy) f.setLeft(arg);
    if (action === 'nod') f.nod();
    if (action === 'lean') f.setLean(arg);
    if (action === 'prepare') f.setHold('ready', 3);
  }

  #shoutEnv() {
    const s = this.shout; if (!s?.start) return 0;
    const t = this.audio.ctx.currentTime - s.start;
    if (t < 0 || t > s.len) return 0;
    const env = this.clips.ant_argument.line.env, i = (s.offset + t * s.rate) * 50, a = Math.floor(i);
    return (env[a] || 0) * (1 - (i - a)) + (env[a + 1] || 0) * (i - a);
  }

  poseActors(dt) {
    const speaker = this.conv.speaker, env = this.conv.speakerEnv, shout = this.#shoutEnv(), by = this.shout?.who;
    this.driverAnim.lookTarget.copy(this.fisher.headWorld);
    this.driverAnim.update(dt, { speechEnv: by === 'driver' ? shout : speaker === 'driver' ? env : 0, speaking: speaker === 'driver' || (by === 'driver' && shout > 0) });
    this.fisher.update(dt, { lookTarget: this.eyeWorld(), speechEnv: by === 'fisherman' ? shout : speaker === 'fisherman' ? env : 0, speaking: speaker === 'fisherman' || (by === 'fisherman' && shout > 0) });
  }

  // ------------------------------------------------------------------ per frame
  frame(dt) {
    const live = this.state === 'play' || this.state === 'caught' || this.state === 'falling' || this.state === 'underwater';
    if (live) {
      this.time += dt;
      this.conv.update(dt);
      if (this.state === 'play' && this.conv.state === 'done') { this.loopPause += dt; if (this.loopPause > 3) { this.conv.begin(); this.loopPause = 0; } }
      if (this.state === 'play') this.input.update(dt);
    }
    this.updateRaise(live ? dt : 0);
    if (this.caught && this.state !== 'underwater') this.#caughtStep(dt);
    this.perch.update(dt, this.reduced);
    this.placeCamera(dt);
    this.watchers.update(live ? dt : 0);
    // the score: seconds spent actually watching one of them through the binoculars
    // (raised and aimed at a man; the sky, the road or your own shoes don't count)
    if (this.state === 'play' && this.raise > 0.85 && this.watchers.list.some((w) => w.focus > 0.02)) this.watchedFor += dt;
    this.watchers.react(dt);
    this.poseActors(dt);
    this.perch.updateBody(dt, this.camera, this.raise, this.body);
    this.underwater.update(dt, this.camera);
    this.world.update(dt, this.focus);
    this.audio.spatial(this.camera, this.fisher.headWorld, this.eyeWorld());
    this.ui.update(dt);
    if (this.underwater.active) this.underwater.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  project(point) {
    const p = point.clone().project(this.camera);
    return { x: (p.x + 1) * this.size.w / 2, y: (1 - p.y) * this.size.h / 2, front: p.z > -1 && p.z < 1, inside: Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
  }

  resize(w, h) {
    this.size = { w, h }; this.renderer.setSize(w, h, false);
    const aspect = w / h; this.camera.aspect = aspect;
    // landscape: a natural 60 degrees tall; portrait keeps about 64 degrees across
    this.baseFov = aspect >= 1 ? 60 : clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(32)) / aspect)), 60, 104);
    this.lensPx = this.ui.layout(w, h);
    this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.underwater?.resize(Math.round(w * pr), Math.round(h * pr));
    if (this.perch) { this.placeCamera(0); }
  }

  toggleMute() { this.audio.unlock(); this.audio.setMuted(!this.audio.muted); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; cancelAnimationFrame(this.raf); this.abort.abort(); this.resizeObserver?.disconnect();
    this.conv?.reset(); this.audio.destroy();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene?.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) { materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); }
    });
    if (this.scene?.environment) textures.add(this.scene.environment);
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose());
    this.underwater?.target.dispose(); this.renderer.dispose();
  }
}
