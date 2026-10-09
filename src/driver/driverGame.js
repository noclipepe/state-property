// Driver POV mode: you sit in grandpa's seat and talk to the fisherman through the open window.
// Three decision points recreate the original exchange; then he hooks the truck's rear door
// frame and drags the pickup, with you in it, toward himself and the pond.
import * as THREE from 'three';
import { createWorld } from '../scene/world.js';
import { loadTruck } from '../scene/truck.js';
import { Effects } from '../scene/effects.js';
import { patchMaterial } from '../scene/shading.js';
import { loadGrandpa, loadFisherman } from '../character/grandpa.js';
import { GrandpaAnimator } from '../character/animator.js';
import { loadPack } from '../util/pack.js';
import { AudioEngine } from '../audio/audio.js';
import { Conversation } from './conversation.js';
import { Fisherman } from './fisherman.js';
import { Hook } from './hook.js';
import { DriverView, DashProp } from './cabin.js';
import { DriverUI } from './ui.js';
import { DriverInput } from './input.js';
import { track } from '../analytics.js';

const BASE = new URL('../../', import.meta.url).href;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// Layout: the pickup is parked with its driver's side toward the pond; the fisherman stands
// outside the driver's window, a little ahead of it, between the truck and the water.
const HOME = { x: -2.93, z: 7.35, yaw: 2.428 };
const FISHER_LOCAL = V(-0.85, 0, 1.85); // truck-body coords at rest
const POND = { x: 11, z: 6.5, rx: 4.6 * 1.3, rz: 4.6, stop: 1.36 };
const OPENING = { seconds: 1.1, distance: 0.9, yaw0: 0.36 }; // final braking; the head turns from the wheel to him
const VIEW_OFFSET = -0.14; // keep him left of centre (clear of the right-hand overlays); A-pillar and mirror show
const VIEW_PITCH = -0.1;

export class DriverGame {
  constructor({ renderer, stage, canvas, quality, isTouch }) {
    this.renderer = renderer; this.stage = stage; this.canvas = canvas; this.quality = quality; this.isTouch = isTouch;
    this.camera = new THREE.PerspectiveCamera(76, 9 / 16, 0.04, 600);
    this.size = { w: 1, h: 1 };
    this.mode = 'loading'; // loading | title | play
    this.paused = false;
    this.runs = 0;
    this.loadP = 0;
    this.clock = new THREE.Timer();
    this.audio = new AudioEngine();
    this.ui = new DriverUI(this);
    this.debug = new URLSearchParams(location.search);
    this.clips = {};
    this.debugCam = this.debug.get('debugcam');
  }

  async load(progress) {
    const parts = { world: 0, truck: 0, grandpa: 0, fisher: 0, props: 0, audio: 0 };
    const report = (k, v, label) => { parts[k] = v; progress(Object.values(parts).reduce((a, b) => a + b, 0) / 6, label); };
    report('world', 0, 'Building the scene…');
    // grass around the parked pickup (both windows) and along the drag path to the pond
    this.world = createWorld(this.renderer, this.quality, { grass: { x: -1.5, z: 6.0, r: 17 }, grassScale: 1.6 });
    this.scene = this.world.scene;
    report('world', 1);
    const [truck, grandpa, fisher, props] = await Promise.all([
      loadTruck((p) => report('truck', p, 'Loading the pickup…')),
      loadGrandpa((p) => report('grandpa', p, 'Loading the driver…')),
      loadFisherman((p) => report('fisher', p, 'Loading the fisherman…')),
      loadPack(BASE + 'assets/meshes/props', (p) => report('props', p)),
      this.#loadClips((p) => report('audio', p, 'Loading dialogue…')),
    ]);
    report('props', 1);
    this.truck = truck;
    this.scene.add(truck.root);
    const sim = truck.sim;
    sim.home = { x: HOME.x, z: HOME.z, yaw: HOME.yaw };
    sim.maxSpeed = 1.3;
    sim.maxYawRate = 0.12;
    sim.bounds = { x0: -9, x1: 2.4, z0: 2.5, z1: 12 };
    sim.avoid = [{ x: -6.5, z: 4.5, r: 3.0 }, { x: 3, z: 11, r: 2.4 }];
    sim.reset();

    // you: grandpa's body in the driver's seat, head hidden (the camera is your eyes)
    this.driver = grandpa;
    grandpa.group.position.fromArray(grandpa.header.seat);
    truck.body.add(grandpa.group);
    truck.root.updateMatrixWorld(true);
    const eyeL = grandpa.bones.eyeL.getWorldPosition(V(0, 0, 0)), eyeR = grandpa.bones.eyeR.getWorldPosition(V(0, 0, 0));
    const eyeLocal = truck.body.worldToLocal(eyeL.add(eyeR).multiplyScalar(0.5));
    for (const n of ['head', 'hair', 'brows', 'mustache']) if (grandpa.meshes[n]) grandpa.meshes[n].visible = false;
    grandpa.bones.head.traverse((o) => { if (o.isMesh) o.visible = false; });
    this.driverAnim = new GrandpaAnimator(grandpa, { glances: [] });

    // the fisherman
    this.fisher = new Fisherman(fisher, this.scene);
    const fPos = this.#homeWorld(FISHER_LOCAL);
    const eyeHome = this.#homeWorld(eyeLocal);
    this.fisher.setHome(fPos, Math.atan2(eyeHome.x - fPos.x, eyeHome.z - fPos.z));

    // cab: camera at your eyes, a loose cap on the dash
    this.eyeLocal = eyeLocal;
    this.view = new DriverView(this.camera, truck.body, eyeLocal);
    const cap = new THREE.Mesh(props.geos.cap, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { vertexAO: true }));
    cap.castShadow = true; cap.receiveShadow = true;
    this.dashProp = new DashProp(cap, truck.body, V(-0.89, 1.335, 0.62));

    // cabin fill light on the interior, like the fishing mode
    const fill = new THREE.PointLight(0xffe2c4, 0.6, 1.8, 1.5);
    fill.position.set(-0.3, 1.5, 0.6);
    truck.body.add(fill);
    // sunlight bouncing off the white door onto whoever stands at the window (reads his face)
    const bounce = new THREE.SpotLight(0xfff1df, 2.4, 7, 0.42, 0.8, 1.2);
    bounce.position.set(-0.45, 1.05, 1.15);
    bounce.target.position.set(-0.85, 1.6, 2.6);
    truck.body.add(bounce, bounce.target);

    this.effects = new Effects(this.scene, this.world.trample);
    this.hook = new Hook({
      scene: this.scene, truck, fisherman: this.fisher, audio: this.audio, pond: POND,
      resolution: new THREE.Vector2(1, 1),
    });
    this.conv = new Conversation({
      audio: this.audio, clips: this.clips, ui: this.ui,
      onAction: (who, action, arg, extra) => this.#perform(who, action, arg, extra),
      onEvent: (name, data) => this.#onConversation(name, data),
    });
    this.input = new DriverInput(this, this.canvas);
    this.renderer.compile(this.scene, this.camera);
    this.reset({ begin: false });
    this.#frame(0);
  }

  async #loadClips(onProgress) {
    const res = await fetch(BASE + 'assets/audio/driver_dialogue.json');
    const lines = await res.json();
    const ids = Object.keys(lines);
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      this.clips[id] = { line: lines[id], buffer: await this.audio.decode(BASE + lines[id].file) };
      onProgress(++done / ids.length);
    }));
  }

  #homeWorld(local) {
    return local.clone().applyAxisAngle(UP, HOME.yaw).add(V(HOME.x, 0, HOME.z));
  }

  resize(w, h) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // portrait: keep ~49deg of horizontal view (the window, the A-pillar and him) on any phone;
    // landscape: a lower, wider view so he stays clear of the answers on the right
    const a = this.camera.aspect;
    if (a < 1) {
      const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(24.5)) / a);
      this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vfov), 50, 82);
    } else this.camera.fov = THREE.MathUtils.lerp(60, 50, THREE.MathUtils.smoothstep(a, 1, 2.2));
    this.viewOffset = a < 1 ? VIEW_OFFSET : VIEW_OFFSET - 0.1;
    if (this.view && !this.opening && this.mode !== 'loading') this.view.setBase(this.#bearingToFisher(0) + this.viewOffset, VIEW_PITCH);
    this.camera.updateProjectionMatrix();
    this.hook?.line.mat.resolution.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  // ------------------------------------------------------------------ start, loading, pause
  loadProgress(p, label) {
    this.loadP = p; this.loadLabel = label || this.loadLabel;
    this.ui.setLoading('progress', p, this.loadLabel);
  }
  loadFailed() {
    this.mode = 'failed';
    this.ui.setLoading('failed');
  }

  /** assets are in: start the single render loop (it idles while paused or hidden) */
  ready() {
    this.mode = 'title';
    window.__ready = true;
    if (this.debug.has('clean')) this.stage.classList.add('rec'); // ?clean: no top bar (recording)
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause('hidden'); });
    addEventListener('pagehide', () => this.pause('hidden'));
    const loop = () => { this.#tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    // PLAY was pressed in the series menu: start right away. The browser may still hold the sound
    // until the first tap here (iOS does); that tap unlocks it, "Tap for sound" says so meanwhile.
    if (this.debug.has('shot')) this.mode = 'shot';
    else this.go();
  }

  go() {
    if (this.mode !== 'title') return;
    this.ui.setLoading('idle');
    this.ui.showHud(true);
    this.mode = 'play';
    this.unlockAudio();
    this.reset();
    this.ui.maybeShowHint();
  }

  unlockAudio() {
    this.audio.unlock();
    setTimeout(() => this.#checkSound(), 400);
  }
  // still blocked (some in-app browsers): offer a "Tap for sound" button
  #checkSound() { this.ui.showUnmute(this.mode === 'play' && !this.paused && !this.audio.running); }

  /** "Back to games" / "Choose another POV": silence everything, then leave for the series menu */
  backToGames() {
    this.paused = true;
    this.input.reset();
    this.audio.suspend();
    location.href = './';
  }

  /** a creator link is about to open: pause a game in progress (not the end screen) */
  pauseForLink() { if (!this.ending?.shown) this.pause('hidden'); }

  toggleMute() { this.audio.setMuted(!this.audio.muted); this.ui.setMuted(this.audio.muted); if (!this.audio.muted) this.unlockAudio(); }

  /** freeze the game, its timers and its sound; reason 'hidden' (left the page) or 'menu' */
  pause(reason = 'menu') {
    if (this.mode !== 'play' || this.paused) return;
    this.paused = true;
    this.input.reset();
    this.audio.suspend();
    this.ui.showUnmute(false);
    this.ui.showPause(true, reason);
  }

  resume({ restart = false } = {}) {
    if (!this.paused) return;
    this.paused = false;
    this.ui.showPause(false);
    this.unlockAudio();
    this.clock.update(); // drop the paused interval
    if (restart) this.reset();
  }

  /**
   * Restart: stop the clip, clear every scheduled step, menus and subtitles, put the truck, the
   * fisherman, rod, line, hook, the cap and the camera back, then replay the opening.
   */
  reset({ begin = true } = {}) {
    this.paused = false;
    this.ui.showPause(false);
    this.input?.reset();
    this.leaving = null;
    this.finger = null;
    this.textGestureT = 0;
    this.conv.reset();
    this.hook.reset();
    this.audio.flushSfx?.();
    this.truck.sim.reset();
    this.truck.setMirrorAngle(0);
    this.fisher.reset();
    this.driverAnim.reset();
    this.driverAnim.idlePose();
    this.dashProp.reset();
    this.effects.reset();
    this.world.trample.clear();
    this.ui.reset();
    this.prevVel = new THREE.Vector2();
    this.ending = null;
    this.opening = null;
    const yaw0 = this.#bearingToFisher(0) + (this.viewOffset ?? VIEW_OFFSET);
    this.view.reset(yaw0, VIEW_PITCH);
    if (begin && this.mode === 'play') {
      this.opening = { t: 0 };
      this.#placeOpening(0);
      this.view.setBase(OPENING.yaw0, VIEW_PITCH);
      this.conv.begin(OPENING.seconds + 0.25);
      track('play_started', { replay: this.runs > 0 });
      this.runs++;
    }
  }

  // the camera's horizontal angle toward the fisherman with the truck `back` metres short of home
  #bearingToFisher(back) {
    const f = this.fisher.home.clone().sub(V(HOME.x, 0, HOME.z)).applyAxisAngle(UP, -HOME.yaw); // body coords
    f.x -= back; // the truck is still `back` metres behind its stop, so he is further ahead
    return Math.atan2(f.z - this.eyeLocal.z, -(f.x - this.eyeLocal.x));
  }

  #placeOpening(u) {
    const e = 1 - Math.pow(1 - u, 2.2); // decelerating to a stop
    const back = OPENING.distance * (1 - e);
    const sim = this.truck.sim;
    const fwd = V(-1, 0, 0).applyAxisAngle(UP, HOME.yaw);
    const prev = this.opening.back ?? back;
    sim.pos.set(HOME.x - fwd.x * back, HOME.z - fwd.z * back);
    for (const w of this.truck.wheels) w.angle -= (prev - back) / this.truck.dims.wheelR;
    this.opening.back = back;
    return back;
  }

  // ------------------------------------------------------------------ dialogue performance
  #perform(who, action, arg, extra) {
    if (who === 'd') {
      const a = this.driverAnim;
      if (action === 'arm') {
        if (arg === 'R_pocket') a.setArm('R', null, { dyn: () => this.#pocketPose(), hand: 'pinch', speed: 5 });
        else this.#driverArm(arg[0], arg, { speed: extra ?? 7 });
      }
      return;
    }
    const f = this.fisher;
    if (action === 'listen') { f.lookAt(() => this.#eyeWorld(), 60); }
    else if (action === 'face') f.setFace(arg);
    else if (action === 'gesture') f.setLeft(arg);
    else if (action === 'nod') f.nod();
    else if (action === 'lean') f.setLean(arg);
    else if (action === 'prepare') { f.setHold('ready', 3); f.lookAt(() => this.hook.hookWorld(), 1.2); }
    else if (action === 'textReply') { f.nod(); f.setLeft('open'); this.textGestureT = 1.6; }
  }

  // your left arm: a scripted pose waits while the finger is up, then takes over again
  #driverArm(side, pose, opts) {
    if (side === 'L' && this.finger) { this.finger.restore = { pose, opts }; return; }
    this.driverAnim.setArm(side, pose, opts);
  }

  /** the 🖕 button / F key: out of the window at him; ignored while it is already up */
  flipOff() {
    if (this.mode !== 'play' || this.paused || this.finger) return false;
    const L = this.driverAnim.arms.L;
    this.finger = { t: 0, reacted: false, restore: { pose: L.target, opts: { speed: 7 } } };
    this.driverAnim.setArm('L', 'L_flip', { speed: 11 });
    this.audio.whoosh(0.22, 0.08);
    track('finger_shown', { state: this.state });
    return true;
  }

  #updateFinger(dt) {
    const F = this.finger;
    if (!F) return;
    F.t += dt;
    if (F.t > 0.45 && !F.reacted) { F.reacted = true; this.#fisherReacts(); }
    if (F.t > 1.9 && !F.down) { F.down = true; this.driverAnim.setArm('L', F.restore.pose || 'L_sill', F.restore.opts); }
    if (F.t > 2.5) {
      if (F.calmDown) F.calmDown();
      this.finger = null;
    }
  }

  // He looks at you either way. Waiting for your answer, he leans back, raises a hand and grumbles
  // (the blah-blah voice, no subtitle). During an original line his face reacts only, so nothing
  // talks over the recording; once he has the truck on the line he just grins.
  #fisherReacts() {
    const f = this.fisher, F = this.finger;
    f.lookAt(() => this.#eyeWorld(), 2.4);
    if (this.hook.phase !== 'idle' || this.leaving) { f.setFace({ smile: 0.75, squint: 0.45, browUp: 0.3, browAngry: 0 }); return; }
    f.setFace({ browUp: 0.9, browAngry: 0.55, frown: 0.55, smile: 0 });
    f.setLean({ back: 0.35 });
    const free = this.conv.grumble(['Wow. Real mature, man.', 'Hey! Same to you, buddy.', 'Okay... that was rude.'][Math.floor(Math.random() * 3)]);
    if (free) f.setLeft('raise');
    F.calmDown = () => {
      f.setLean({ back: 0 });
      if (free) f.setLeft(null);
      if (!this.conv.clip && this.hook.phase === 'idle') f.setFace({ browUp: 0.2, browAngry: 0.25, frown: 0.15, smile: 0 });
    };
  }

  #pocketPose() {
    // reach across to the pen in the shirt pocket (left chest), in grandpa's char space
    const g = this.driver;
    g.bones.chest.updateWorldMatrix(true, false);
    const w = V(0.085, 0.10, 0.20).applyMatrix4(g.bones.chest.matrixWorld);
    g.group.updateWorldMatrix(true, false);
    w.applyMatrix4(new THREE.Matrix4().copy(g.group.matrixWorld).invert());
    return { w, f: V(-0.2, 0.55, 0.8), n: V(0.3, -0.2, -0.9), p: V(0.3, -1, -0.5) };
  }

  #eyeWorld() { return this.camera.getWorldPosition(V(0, 0, 0)); }

  #onConversation(name, data) {
    if (name === 'conversationDone') {
      this.hook.start((ev) => this.#onHook(ev));
      this.conv.setState('hook');
    }
    if (name === 'altEnding') this.#leave(data);
  }

  // "Alright, please pack up and leave.": he reels in, turns away and walks off along the bank
  #leave(kind) {
    const f = this.fisher;
    f.setLeft('rod');
    f.setHold('rest', 3);
    f.setFace({ smile: 0.15, browUp: 0.2, browAngry: 0, squint: 0.2 });
    const away = f.pos.clone().sub(this.truck.root.position).setY(0).normalize();
    away.applyAxisAngle(UP, -0.5);
    f.faceToward(f.pos.clone().addScaledVector(away, 20));
    f.lookAt(f.pos.clone().addScaledVector(away, 20).setY(1.5), 60);
    this.leaving = { t: 0, dir: away };
    this.ending = { t: 0, outcome: kind, after: 3.2 };
  }

  #onHook(ev) {
    const a = this.driverAnim;
    if (ev === 'hooked') { this.view.jolt(0.12); this.fisher.lookAt(() => this.#eyeWorld(), 1.6); }
    if (ev === 'strain') { a.setArm('R', 'R_wheel', { speed: 8 }); }
    if (ev === 'moving') {
      this.conv.setState('pull');
      this.view.jolt(0.35);
      this.#driverArm('L', 'L_grabSill', { speed: 10 });
      a.setArm('R', 'R_wheel', { speed: 10 });
      a.setLean({ back: 0.5 });
      this.fisher.lookAt(() => this.hook.hookWorld(), 60);
    }
    if (ev === 'stopped') {
      this.conv.setState('end');
      this.view.jolt(0.15);
      a.setLean({ back: 0 });
      this.fisher.lookAt(() => this.#eyeWorld(), 60);
      this.ending = { t: 0, outcome: 'dragged', after: 1.4 };
    }
  }

  // ------------------------------------------------------------------ loop
  #tick() {
    this.clock.update();
    const raw = this.clock.getDelta();
    if (this.paused || document.hidden) return; // nothing updates or renders
    this.#adaptResolution(raw);
    this.#frame(Math.min(raw, 1 / 30));
  }

  #adaptResolution(raw) {
    if (raw <= 0 || raw > 0.5) return;
    this._ft = this._ft ? this._ft * 0.97 + raw * 0.03 : raw;
    this._ftCheck = (this._ftCheck || 0) + raw;
    if (this._ftCheck < 2) return;
    this._ftCheck = 0;
    const pr = this.renderer.getPixelRatio();
    let next = pr;
    if (this._ft > 1 / 40 && pr > 0.75) next = Math.max(0.75, pr * 0.85);
    else if (this._ft < 1 / 57 && pr < this.quality.dpr) next = Math.min(this.quality.dpr, pr * 1.1);
    if (Math.abs(next - pr) > 0.01) { this.renderer.setPixelRatio(next); this.resize(this.size.w, this.size.h); }
  }

  #frame(dt) {
    const sim = this.truck.sim;
    this.conv.update(dt);
    // opening: final roll-in and braking (the conversation waits for it)
    if (this.opening) {
      const o = this.opening;
      o.t += dt;
      const u = Math.min(1, o.t / OPENING.seconds);
      const back = this.#placeOpening(u);
      if (u > 0.15 && !o.brake) { o.brake = true; sim.susp.pitchV += 0.16; this.audio.creak(0.05, 900); }
      // the head turns from the road ahead to him as the truck comes to a stop
      const k = THREE.MathUtils.smoothstep(u, 0.12, 1.0);
      this.view.setBase(THREE.MathUtils.lerp(OPENING.yaw0, this.#bearingToFisher(back) + (this.viewOffset ?? VIEW_OFFSET), k), VIEW_PITCH);
      if (u >= 1) { sim.susp.pitchV -= 0.22; this.opening = null; }
    }
    this.hook.update(dt);
    sim.step(dt);
    this.truck.root.updateMatrixWorld(true);

    // your body: braced by the truck's motion
    const acc = new THREE.Vector2(sim.vel.x - this.prevVel.x, sim.vel.y - this.prevVel.y).divideScalar(Math.max(dt, 1e-3));
    this.prevVel.copy(sim.vel);
    const accLocal = V(acc.x, 0, acc.y).applyAxisAngle(UP, -sim.yaw);
    this.driverAnim.lookTarget.copy(this.fisher.headWorld);
    this.driverAnim.update(dt, { truckAccel: accLocal, speechEnv: 0, speaking: false });

    // the fisherman
    const speaker = this.conv.speaker;
    if (this.textGestureT > 0) { this.textGestureT -= dt; if (this.textGestureT <= 0) this.fisher.setLeft(null); }
    this.#updateFinger(dt);
    if (this.leaving) {
      const L = this.leaving;
      L.t += dt;
      if (L.t > 0.7 && L.t < 3.6) this.fisher.walkVel.copy(L.dir).multiplyScalar(0.95 * Math.min(1, (L.t - 0.7) * 2));
      else this.fisher.walkVel.set(0, 0, 0);
    }
    this.fisher.update(dt, {
      lookTarget: this.#eyeWorld(),
      speechEnv: speaker === 'fisherman' ? this.conv.speakerEnv : 0,
      speaking: speaker === 'fisherman',
    });
    this.hook.updateLine(dt);

    // cab: camera, the loose cap
    const moving = !sim.stuck || sim.speed > 0.02;
    this.view.update(dt, { vibration: 0.12 + (moving ? 0.5 + sim.speed * 0.6 : 0) + this.hook.tension * 0.25, keys: this.input.keyLook() });
    this.dashProp.update(dt, new THREE.Vector2(accLocal.x, accLocal.z), sim.susp.roll + sim.susp.lift * sim.susp.liftSide);

    // world, effects, audio
    const focus = this.truck.root.position.clone().lerp(this.fisher.pos, 0.5);
    this.world.update(dt, focus);
    if (moving) this.effects.emitFromWheels(this.truck.wheels, dt, sim);
    this.effects.update(dt);
    const scrape = Math.min(1, (sim.slip.reduce((a, b) => a + b, 0) / 4) * 2.2);
    const eye = this.#eyeWorld();
    this.audio.update({
      engine: this.opening ? 1.5 : 0.8, enginePan: 0,
      water: Math.max(0, 1 - (Math.hypot(eye.x - POND.x, eye.z - POND.z) - 4) / 9),
      scrape: sim.stuck ? 0 : scrape * 0.8, roll: sim.stuck ? 0 : Math.min(1, sim.speed * 1.4),
      strain: this.hook.tension * 0.8, reel: this.fisher.reeling ? 0.6 : 0, reelLoad: this.hook.tension,
    });
    if (this.ending) {
      const e = this.ending;
      e.t += dt;
      if (e.t > e.after && !e.shown) {
        e.shown = true;
        this.ui.showEnd(e.outcome);
        track('game_completed', { outcome: e.outcome });
      }
    }
    this.renderer.render(this.scene, this.mode === 'shot' ? this.#shotCam() : this.debugCam ? this.#debugCam() : this.camera);
  }

  // ?debugcam=fisher[,distance,height,angleDeg]: a close camera on the fisherman (development)
  #debugCam() {
    const [, d = 1.4, h = 1.3, a = 20] = this.debugCam.split(',').map(Number);
    if (!this._dbgCam) { this._dbgCam = new THREE.PerspectiveCamera(40, this.camera.aspect, 0.02, 200); }
    const c = this._dbgCam, f = this.fisher;
    const dir = f.forward.applyAxisAngle(UP, THREE.MathUtils.degToRad(a));
    c.position.copy(f.pos).addScaledVector(dir, d).setY(h);
    c.lookAt(f.pos.clone().setY(1.15));
    return c;
  }

  // ?shot: the outside view used for the menu preview and the social image (tools/capture-previews.mjs).
  // The driver's head is shown again so the scene reads like the meme.
  #shotCam() {
    if (!this._shotCam) {
      this._shotCam = new THREE.PerspectiveCamera(38, this.camera.aspect, 0.05, 400);
      for (const n of ['head', 'hair', 'brows', 'mustache']) if (this.driver.meshes[n]) this.driver.meshes[n].visible = true;
      this.driver.bones.head.traverse((o) => { if (o.isMesh) o.visible = true; });
    }
    const [x = -2.6, y = 1.55, z = 4.1, tx = 0.25, ty = 1.25, tz = 0.9] = (this.debug.get('shot') || '').split(',').filter(Boolean).map(Number);
    const c = this._shotCam;
    c.aspect = this.camera.aspect; c.updateProjectionMatrix();
    c.position.copy(this.truck.root.localToWorld(V(x, y, z)));
    c.lookAt(this.truck.root.localToWorld(V(tx, ty, tz)));
    this.driverAnim.lookTarget.copy(this.fisher.headWorld);
    return c;
  }

  // ------------------------------------------------------------------ test / automation helpers
  get state() { return this.conv?.state ?? this.mode; }
  // development shortcut: skip the conversation and start the hook sequence now
  debugHook() {
    if (this.mode !== 'play' || this.hook.phase !== 'idle') return;
    this.opening = null;
    this.conv.reset();
    this.#onConversation('conversationDone');
  }
}
