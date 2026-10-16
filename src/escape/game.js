// FISH ESCAPE: an endless hop-the-crossings run. The fish jumps out of the familiar bucket by the
// pickup and flops along the lake shore: crabs scuttle across sandy rows, buckets block cells,
// and if you stop making progress the fisherman casts his hook at you.
//
// The first run opens on the series' familiar shot: the fisherman at the pickup's window, "Who told
// you you could fish here?", and in the bucket beside them the fish already jumping. Then a quick
// move to the bucket as it jumps out, while the argument carries on in the background.
//
// States: loading → ready (PLAY) → scene → intro → play → (pinched | flattened | swept | hooked →
// returning) → results; restart() → play.
import * as THREE from 'three';
import { createWorld } from '../scene/world.js';
import { loadTruck } from '../scene/truck.js';
import { loadGrandpa, loadFisherman } from '../character/grandpa.js';
import { GrandpaAnimator } from '../character/animator.js';
import { Fisherman } from '../driver/fisherman.js';
import { HOME, FISHER_LOCAL, BUCKET_LOCAL } from '../driver/layout.js';
import { toWorld } from '../ant/layout.js';
import { Bucket, WATER } from '../fish/bucket.js';
import { ESCAPE } from './config.js';
import { Course } from './course.js';
import { PlayerFish } from './fish.js';
import { HookThreat } from './hook.js';
import { EscapeInput } from './input.js';
import { EscapeAudio } from './audio.js';
import { EscapeUI } from './ui.js';
import { EscapeDialogue } from './dialogue.js';

const C = ESCAPE.cell, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smoothstep, clamp = THREE.MathUtils.clamp;
const MOVES = { f: [1, 0], b: [-1, 0], l: [0, -1], r: [0, 1] };
const BEST_KEY = 'state-property.escape.best';
// the familiar shot, in the pickup's coordinates: behind the fisherman, the driver at his window
const SHOT = { pos: V(-3.3, 1.9, 4.7), focus: V(-0.35, 1.25, 0.9), fov: 38 };
const TO_BUCKET = 0.5; // seconds from the shot to the bucket

export class EscapeGame {
  constructor(options) {
    Object.assign(this, options);
    this.state = 'loading'; this.destroyed = false; this.paused = false; this.time = 0;
    this.abort = new AbortController();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 220);
    this.size = { w: 1, h: 1 };
    this.audio = new EscapeAudio();
    this.ui = new EscapeUI(this);
    this.input = new EscapeInput(this);
    this.dialogue = new EscapeDialogue(this.audio, this.ui);
    this.params = new URLSearchParams(location.search);
    try { this.best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { this.best = 0; }
    document.addEventListener('visibilitychange', () => { this.paused = document.hidden; if (this.paused) this.audio.suspend(); else if (this.audio.started) this.audio.unlock(); }, { signal: this.abort.signal });
    addEventListener('pagehide', () => this.destroy(), { signal: this.abort.signal });
  }

  async load() {
    this.ui.progress(0.05, 'Filling the bucket…');
    // the start keeps the real staging: the pickup, the fisherman and his bucket. The course runs
    // from the bucket along the lake shore (the pickup's left-to-right axis), away from the pickup.
    const origin = toWorld(V(0.45, 0, 3.3));
    this.world = createWorld(this.renderer, { ...this.quality, grass: Math.min(4000, this.quality.grass) }, { grass: { ...toWorld(V(-0.6, 0, 0.6)), r: 3.2 }, grassScale: 1 });
    this.scene = this.world.scene;
    const [truck, driver, fisher] = await Promise.all([
      loadTruck((p) => this.ui.progress(0.1 + p * 0.6, 'Parking the pickup…')), loadGrandpa(), loadFisherman(), this.dialogue.load()]);
    if (this.destroyed) return;
    this.truck = truck; this.driver = driver;
    this.scene.add(truck.root); truck.sim.home = { ...HOME }; truck.sim.reset();
    driver.group.position.fromArray(driver.header.seat); truck.body.add(driver.group);
    this.driverAnim = new GrandpaAnimator(driver, { glances: [] }); this.driverAnim.idlePose();
    this.fisher = new Fisherman(fisher, this.scene);
    // he starts facing the driver (the argument); once the fish is out he turns to watch it
    const fp = toWorld(V(...FISHER_LOCAL)), eye = this.eyeWorld(); this.fisher.setHome(fp, Math.atan2(eye.x - fp.x, eye.z - fp.z));
    this.bucket = new Bucket(this.scene, toWorld(V(...BUCKET_LOCAL)));
    // course space: -Z forward along the pickup's +Z (its driver side), +X to the right
    this.courseRoot = new THREE.Group(); this.courseRoot.position.copy(origin);
    const fwd = toWorld(V(0.45, 0, 4.3)).sub(origin).normalize();
    this.courseRoot.rotation.y = Math.atan2(-fwd.x, -fwd.z); this.scene.add(this.courseRoot); this.courseRoot.updateMatrixWorld(true);
    const local = (x, z) => this.courseRoot.localToWorld(V(x, 0, z));
    const pondK = (x, z) => { const w = local(x, z); return ((w.x - 11) / (4.6 * 1.3)) ** 2 + ((w.z - 6.5) / 4.6) ** 2; };
    const inPond = (x, z) => { const w = local(x, z); return ((w.x - 11) / (6.2 * 1.3)) ** 2 + ((w.z - 6.5) / 6.2) ** 2 < 1; };
    this.#clearCorridor();
    // crabs come out of the lake: inside the water they walk below the surface
    this.course = new Course(this.courseRoot, { leafMaterial: this.world.trees.leaves.material, leafGeometry: this.world.trees.leaves.geometry, inPond, depth: (x, z) => 0.3 * (1 - smooth(pondK(x, z), 0.75, 1.0)) });
    this.fish = new PlayerFish(this.courseRoot);
    this.hook = new HookThreat(this.courseRoot);
    this.bucketLocal = this.courseRoot.worldToLocal(this.bucket.root.position.clone());
    const sc = this.world.sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.far = 50; sc.updateProjectionMatrix();
    const shot = (v) => this.courseRoot.worldToLocal(truck.root.localToWorld(v.clone()));
    truck.root.updateMatrixWorld(true); this.shot = { pos: shot(SHOT.pos), focus: shot(SHOT.focus) };
    this.restart(false);
    this.state = 'ready'; this.fish.pivot.visible = false; // still in the bucket
    this.resize(this.size.w, this.size.h);
    this.renderer.compile(this.scene, this.camera);
    this.ui.progress(1, 'Ready'); this.ui.loaded();
    window.__ready = true;
    let previous = null, acc = 0;
    const loop = (now) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(loop);
      const dt = previous === null ? 0 : Math.min((now - previous) / 1000, 0.1); previous = now;
      if (document.hidden || this.paused) return;
      // fixed steps for the rules; rendering interpolates nothing it doesn't need to
      acc += dt;
      while (acc >= ESCAPE.step) { this.step(ESCAPE.step); acc -= ESCAPE.step; }
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** world trees, bushes and the guardrail that stand where the course runs are removed */
  #clearCorridor() {
    const inv = new THREE.Matrix4().copy(this.courseRoot.matrixWorld).invert(), m = new THREE.Matrix4(), p = V();
    const T = this.world.trees;
    for (const im of [T.leaves, T.trunks, T.branches, T.cores]) {
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m); p.setFromMatrixPosition(m).applyMatrix4(inv);
        // the course, its edges and the space the camera flies through above and behind the start
        if (Math.abs(p.x) < 11 && p.z < 9) { m.makeScale(0, 0, 0); im.setMatrixAt(i, m); }
      }
      im.instanceMatrix.needsUpdate = true;
    }
    for (const o of this.scene.children) if (o.isGroup && o.children.some((c) => c.geometry?.parameters?.width === 60)) o.visible = false;
  }

  // ------------------------------------------------------------------ flow
  restart(play = true) {
    const seed = Number(this.params.get('seed')) || ((Math.random() * 1e9) | 0);
    this.seed = seed;
    this.course.reset(seed); this.course.update(0);
    this.fish.reset(0, 0); this.hook.reset(); this.input.clear();
    this.time = 0; this.score = 0; this.furthest = 0; this.stall = 0; this.buffered = null; this.end = null; this.moves = 0;
    this.intro = null; this.scene0 = null; this.cam = null;
    this.bucket.reset();
    this.ui.reset(); this.dialogue.reset();
    if (play) { this.state = 'play'; this.audio.unlock(); this.audio.flushSfx(); this.ui.cinema(false); this.ui.hud(true); }
  }

  /** PLAY: sound on, the familiar shot and the opening lines */
  begin() {
    if (this.state !== 'ready') return;
    this.audio.unlock(); this.ui.ready(); this.ui.cinema(true);
    this.state = 'scene'; this.scene0 = { t: 0, jump: 0.35 };
    // the shot lasts the first line; the rest of the exchange plays on behind the run
    const len = this.dialogue.opening();
    this.scene0.length = len ? len + 0.1 : 2.2;
    this.#inBucket(0);
  }

  /** the fish in the bucket's water (y: metres above the surface) */
  #inBucket(y) {
    const b = this.bucketLocal; this.fish.pivot.visible = true;
    this.fish.pos.x = b.x / C; this.fish.pos.z = -b.z / C; this.fish.pos.y = (WATER + y) / C;
  }

  #startIntro() {
    this.state = 'intro'; this.intro = { t: -TO_BUCKET }; this.ui.cinema(false);
    this.fish.reset(0, 0); this.fish.yawTarget = this.fish.yaw = Math.PI / 2; this.#inBucket(-0.04);
    this.fisher.setLeft(null); this.fisher.faceToward(() => this.fish.pivot.getWorldPosition(V()));
  }

  #finishIntro() {
    if (this.state !== 'intro' && this.state !== 'scene') return;
    if (this.state === 'scene') { this.fisher.setLeft(null); this.fisher.faceToward(() => this.fish.pivot.getWorldPosition(V())); }
    this.intro = null; this.scene0 = null; this.fish.reset(0, 0); this.fish.anim = null; this.state = 'play'; this.ui.cinema(false); this.ui.hud(true);
  }

  /** skip the opening scene (the lines keep playing) */
  skip() { this.#finishIntro(); }

  eyeWorld() { this.truck.root.updateMatrixWorld(true); return this.driver.bones.eyeL.getWorldPosition(V()); }

  /** a move request from the keyboard, a tap or a swipe */
  move(dir) {
    if (this.state === 'ready') { this.begin(); return; }
    if (this.state === 'intro' || this.state === 'scene') this.#finishIntro();
    if (this.state !== 'play') return;
    if (this.fish.busy) { this.buffered = dir; return; } // one move waits; a newer one replaces it
    this.#hop(dir);
  }

  #hop(dir) {
    // in a stream the fish drifts between columns: a hop lands on the nearest whole one
    const [dr, dc] = MOVES[dir], to = { r: this.fish.cell.r + dr, c: Math.round(this.fish.pos.x) + dc };
    this.moves++; this.ui.moved(this.moves);
    if (this.course.open(to.r, to.c)) { this.fish.start(dir, to); this.audio.hop(); return; }
    // blocked: a bucket, boulder or bush (it wobbles) or the edge of the course
    this.fish.start(dir, to, true);
    const kind = this.course.row(to.r)?.props.find((p) => p.c === to.c)?.kind;
    if (kind) { this.course.bump(to.r, to.c); kind === 'bucket' ? this.audio.clank() : kind === 'bush' ? this.audio.rustle() : this.audio.edge(); } else this.audio.edge();
  }

  /** put the fish on a cell as if it had hopped there (tests and debugging) */
  teleport(r, c) {
    if (this.state === 'ready') this.begin();
    this.#finishIntro(); this.fish.reset(r, c); this.furthest = Math.max(this.furthest, r); this.score = this.furthest; this.stall = 0;
    this.course.update(this.furthest); this.cam = null;
  }

  // ------------------------------------------------------------------ fixed step
  step(dt) {
    if (this.state === 'scene') this.#sceneStep(dt);
    if (this.state === 'intro') this.#introStep(dt);
    if (!['play', 'pinched', 'flattened', 'swept', 'hooked', 'returning'].includes(this.state)) return;
    this.time += dt;
    if (this.state === 'play') {
      const event = this.fish.step(dt);
      if (event === 'landed') {
        if (this.course.flow(this.fish.cell.r)) this.audio.splash(0.35); else this.audio.land();
        if (this.fish.cell.r > this.furthest) {
          this.furthest = this.fish.cell.r; this.score = this.furthest; this.stall = 0;
          if (this.hook.active) { this.hook.retract(); this.audio.miss(); }
          this.hook.retry = 0;
          this.course.update(this.furthest);
        }
      }
      // a buffered move goes as soon as the current hop ends
      if (!this.fish.busy && this.buffered) { const d = this.buffered; this.buffered = null; this.#hop(d); }
      // streams carry a fish that is not hopping; off the edge it is swept away
      const flow = this.fish.busy ? 0 : this.course.flow(this.fish.cell.r);
      if (flow) {
        this.fish.pos.x += flow * dt; this.fish.cell.c = this.fish.pos.x;
        if (Math.abs(this.fish.pos.x) > ESCAPE.columns + 0.45) return this.#swept(Math.sign(flow));
      }
      // crabs and trucks: a hop is not a jump over them
      const hit = this.course.hit(this.fish.pos.x, this.fish.pos.z, this.time);
      if (hit) return hit.kind === 'road' ? this.#runOver(hit) : this.#pinched(hit);
      // the hook: only stalling (no new furthest row) brings it
      this.stall += dt;
      if (this.stall >= ESCAPE.hook.stall && this.hook.state === 'idle' && this.hook.retry <= 0) { this.hook.cast(this.fish.occupied); this.audio.cast(); this.ui.warn(true); }
      const h = this.hook.step(dt, this.fish.occupied);
      if (h === 'missed') { this.audio.miss(); this.ui.warn(false); }
      if (h === 'caught') this.#hooked();
      if (!this.hook.active) this.ui.warn(false);
    } else this.#endStep(dt);
  }

  #sceneStep(dt) {
    const S = this.scene0; S.t += dt;
    // while they argue, the fish keeps leaping up out of the bucket (big enough to see on a phone)
    S.jump -= dt;
    if (S.jump <= 0 && !S.leap) { S.leap = { t: 0, yaw: Math.PI / 2 + (Math.random() - 0.5) * 2 }; this.bucket.splash(0.7); this.audio.splash(0.25); }
    if (S.leap) {
      const L = S.leap, u = Math.min(1, (L.t += dt) / 0.6);
      this.#inBucket(Math.sin(Math.PI * u) * 0.42 - 0.04); this.fish.yaw = this.fish.yawTarget = L.yaw;
      this.fish.anim = { kind: 'flip', u };
      if (u >= 1) { S.leap = null; S.jump = 0.25 + Math.random() * 0.2; this.fish.anim = null; this.bucket.splash(0.9); this.audio.splash(0.3); }
    } else this.#inBucket(-0.04 + Math.sin(S.t * 9) * 0.01);
    if (S.t >= S.length) this.#startIntro();
  }

  #introStep(dt) {
    const I = this.intro; I.t += dt;
    if (I.t < 0) return; // the camera is still on its way from the shot to the bucket (the fish waits in it)
    if (!I.splashed) { I.splashed = true; this.bucket.splash(1.1); }
    // out of the water, over the rim, onto the first row
    const u = clamp((I.t - 0.25) / 0.75, 0, 1), from = this.bucketLocal.clone().add(V(0, WATER, 0));
    const x = from.x * (1 - u), z = from.z * (1 - u);
    this.fish.pos.x = x / C; this.fish.pos.z = -z / C; this.fish.pos.y = (from.y * (1 - u) + Math.sin(Math.PI * u) * 0.75) / C;
    this.fish.anim = u > 0 && u < 1 ? { kind: 'flip', u } : null;
    if (u >= 1 && !I.landed) { I.landed = true; this.fish.flop = 0.2; this.audio.land(); }
    if (I.t > 1.15) this.#finishIntro();
  }

  #pinched(hit) {
    this.state = 'pinched'; this.end = { cause: 'crab', t: 0, dir: hit.dir, x0: this.fish.pos.x };
    this.fish.hop = null; this.fish.anim = { kind: 'tumble', t: 0 }; this.audio.pinch(); this.dialogue.end('crab'); this.ui.warn(false); this.hook.retract();
  }

  #runOver(hit) {
    this.state = 'flattened'; this.end = { cause: 'car', t: 0, dir: hit.dir };
    this.fish.hop = null; this.fish.pos.y = 0; this.fish.anim = { kind: 'squash', t: 0 }; this.audio.honk(); this.dialogue.end('car'); this.ui.warn(false); this.hook.retract();
  }

  #swept(dir) {
    this.state = 'swept'; this.end = { cause: 'swept', t: 0, dir, x0: this.fish.pos.x };
    this.fish.anim = { kind: 'tumble', t: 0 }; this.audio.splash(0.8); this.dialogue.end('swept'); this.ui.warn(false); this.hook.retract();
  }

  #hooked() {
    this.state = 'hooked'; this.end = { cause: 'hook', t: 0 };
    this.fish.hop = null; this.fish.anim = { kind: 'hooked' }; this.audio.reel(); this.dialogue.end('hook'); this.ui.warn(false);
  }

  #endStep(dt) {
    const E = this.end; E.t += dt;
    if (this.state === 'flattened') {
      // flat as a pancake for a moment (no gore: just a very surprised, very flat fish)
      this.fish.anim.t = E.t;
      if (E.t > 1.1) this.#results();
    } else if (this.state === 'swept') {
      // carried off down the stream, rolling
      this.fish.anim.t = E.t * 0.6;
      this.fish.pos.x = E.x0 + E.dir * E.t * 2.2;
      if (E.t > 1.1) this.#results();
    } else if (this.state === 'pinched') {
      // knocked along by the crab, tumbling, then the result
      this.fish.anim.t = E.t;
      const u = Math.min(1, E.t / 0.7);
      this.fish.pos.x = E.x0 + E.dir * 0.9 * (1 - (1 - u) ** 2); this.fish.pos.y = Math.sin(u * Math.PI) * 0.6;
      if (E.t > 1.25) this.#results();
    } else if (this.state === 'hooked') {
      // hauled straight up out of view, wriggling
      const u = E.t / ESCAPE.hook.lift;
      this.fish.pos.y = (0.35 + u * u * 9) / C;
      this.hook.hook.position.y = this.fish.pos.y * C + 0.12;
      if (u >= 1) { this.state = 'returning'; E.t = 0; this.fish.anim = { kind: 'drop' }; }
    } else if (this.state === 'returning') {
      // …and back into the bucket by the pickup
      const b = this.bucketLocal, u = Math.min(1, E.t / 0.6);
      this.fish.pos.x = b.x / C; this.fish.pos.z = -b.z / C; this.fish.pos.y = (WATER + 2.4 * (1 - u * u)) / C;
      this.hook.hook.visible = false;
      if (u >= 1 && !E.splashed) { E.splashed = true; this.bucket.splash(1.3); this.audio.splash(); this.fish.pivot.visible = false; }
      if (E.t > 1.55) this.#results();
    }
  }

  #results() {
    if (this.state === 'results') return;
    const record = this.score > this.best;
    if (record) { this.best = this.score; try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* no storage */ } this.audio.record(); }
    this.state = 'results'; this.ui.results(this.end.cause, this.score, this.best, record);
  }

  // ------------------------------------------------------------------ per frame
  frame(dt) {
    this.fish.swimming = this.state === 'play' && !this.fish.busy && !!this.course.flow(this.fish.cell.r);
    this.fish.render(dt);
    this.#expressBells();
    this.dialogue.update(dt, ['play', 'intro', 'scene'].includes(this.state));
    this.hook.render(this.time);
    this.course.render(dt, this.time, Math.round(this.fish.pos.z));
    this.bucket.update(dt);
    this.#placeCamera(dt);
    // the argument: they talk to each other (mouths and faces follow the recording)
    if (this.state === 'ready' || this.state === 'scene') {
      const { speaker, env } = this.dialogue.speech();
      this.driverAnim.lookTarget.copy(this.fisher.headWorld);
      this.driverAnim.update(dt, { speechEnv: speaker === 'driver' ? env : 0, speaking: speaker === 'driver' });
      this.fisher.update(dt, { lookTarget: this.eyeWorld(), speechEnv: speaker === 'fisherman' ? env : 0, speaking: speaker === 'fisherman' });
    }
    // the people at the start keep an eye on their runaway fish while they are on screen
    else if (this.furthest < 30) {
      // …and still argue in the background, mouths following the lines
      const fw = this.fish.pivot.getWorldPosition(V()), { speaker, env } = this.dialogue.speech();
      this.fisher.anim.lookTarget.copy(fw); this.fisher.update(dt, { lookTarget: fw, speechEnv: speaker === 'fisherman' ? env : 0, speaking: speaker === 'fisherman' });
      this.driverAnim.lookTarget.copy(fw); this.driverAnim.update(dt, { speechEnv: speaker === 'driver' ? env : 0, speaking: speaker === 'driver' });
    }
    const focus = this.courseRoot.localToWorld(V(this.fish.pos.x * C, 0, -this.fish.pos.z * C));
    this.world.update(dt, focus);
    this.world.sky.position.copy(this.camera.position);
    this.world.ground.position.set(focus.x, 0, focus.z);
    if (this.audio.started) this.audio.update({ engine: 0, water: this.furthest < 25 ? 0.5 : 0.15 });
    this.ui.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** a bell when an express truck is about to come through a nearby road */
  #expressBells() {
    if (this.state !== 'play') return;
    const r0 = Math.round(this.fish.pos.z);
    for (let r = r0 - 2; r <= r0 + 8; r++) {
      const L = this.course.row(r)?.lane; if (!L?.express) continue;
      const soon = this.course.expressIn(L, this.time) < ESCAPE.car.express.warn;
      if (soon && !L.ringing) this.audio.bell();
      L.ringing = soon;
    }
  }

  /** the gameplay view for the fish at (x, z) cells, in course space */
  #gameplayPose(x, z) {
    const portrait = this.size.w < this.size.h, a = this.size.w / this.size.h;
    const fov = portrait ? 60 : 46, el = THREE.MathUtils.degToRad(portrait ? 57 : 52);
    // portrait (a phone held upright): close in, about 7 cells across the fish's row, and follow
    // the fish sideways more so the edges come into view as it gets near them; landscape: a
    // comfortable fixed distance with the whole width in view
    const P = ESCAPE.camera.portrait;
    const dist = portrait ? clamp(P.halfWidth / (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * a), P.minDist, 13) : 8.2;
    const focus = V(x * C * (portrait ? P.sideFollow : ESCAPE.camera.sideFollow), 0, -z * C - (portrait ? P.ahead : 1.9));
    return { fov, pos: focus.clone().add(V(0, Math.sin(el), Math.cos(el)).multiplyScalar(dist)), focus };
  }

  #placeCamera(dt) {
    const c = this.camera, f = this.fish;
    let pose;
    if (this.state === 'returning' || this.state === 'results' && this.end?.cause === 'hook') {
      // a quick cut to the bucket by the pickup
      const b = this.bucketLocal; pose = { fov: 50, pos: b.clone().add(V(-0.95, 1.35, 1.75)), focus: b.clone().add(V(0.05, 0.25, -0.15)) };
      this.cam = { pos: pose.pos.clone(), focus: pose.focus.clone() };
    } else {
      pose = this.#gameplayPose(f.pos.x, Math.max(f.pos.z, 0));
      if (this.state === 'ready' || this.state === 'scene') {
        // the familiar shot, creeping in a little while they argue
        pose = this.#shotPose(this.scene0?.t || 0);
        this.cam = { pos: pose.pos.clone(), focus: pose.focus.clone() };
      } else if (this.state === 'intro' && this.intro.t < 0) {
        // from the shot down to the bucket, where the fish is about to jump
        const k = smooth(this.intro.t, -TO_BUCKET, 0), from = this.#shotPose(this.scene0?.length || 0), to = this.#bucketPose();
        pose = { fov: THREE.MathUtils.lerp(from.fov, to.fov, k), pos: from.pos.lerp(to.pos, k), focus: from.focus.lerp(to.focus, k) };
        this.cam = { pos: pose.pos.clone(), focus: pose.focus.clone() };
      } else if (this.state === 'intro') {
        // start beside the bucket with the pickup and the fisherman in view, then settle in
        const k = smooth(this.intro.t, 0.35, 1.15);
        // close above the bucket (the fisherman beside it, the pickup just behind), then the same
        // direction pulled back and up into the gameplay view: no swing, no spin
        const start = this.#bucketPose();
        pose = { fov: THREE.MathUtils.lerp(start.fov, pose.fov, k), pos: start.pos.lerp(pose.pos, k), focus: start.focus.lerp(pose.focus, k) };
        this.cam = { pos: pose.pos.clone(), focus: pose.focus.clone() };
      } else if (!this.cam || !dt) this.cam = { pos: pose.pos.clone(), focus: pose.focus.clone() };
      else {
        // follow smoothly (forward faster than sideways); the view never rotates during play
        const k = 1 - Math.exp(-ESCAPE.camera.follow * dt);
        this.cam.pos.lerp(pose.pos, k); this.cam.focus.lerp(pose.focus, k);
      }
    }
    c.position.copy(this.courseRoot.localToWorld(this.cam.pos.clone()));
    c.lookAt(this.courseRoot.localToWorld(this.cam.focus.clone()));
    if (Math.abs(c.fov - pose.fov) > 0.01) { c.fov = pose.fov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld(true);
  }

  /** the familiar shot (course space); on a narrow screen it steps back and widens to keep both men */
  #shotPose(t) {
    const a = this.size.w / this.size.h, back = a < 1 ? 1.25 + (1 - a) * 0.9 : 1, push = 1 - Math.min(t, 8) * 0.012;
    const focus = this.shot.focus.clone(), pos = this.shot.pos.clone().sub(focus).multiplyScalar(back * push).add(focus);
    // lean toward the bucket so the jumping fish is in view (more on a narrow screen)
    const lean = this.bucketLocal.clone().add(V(0, 0.55, 0)).sub(focus).multiplyScalar(a < 1 ? 0.45 : 0.18); focus.add(lean); pos.add(lean);
    return { fov: a < 1 ? 52 : SHOT.fov, pos, focus };
  }

  #bucketPose() { const b = this.bucketLocal; return { fov: 50, pos: b.clone().add(V(0.7, 2.5, 1.7)), focus: b.clone().add(V(0.25, 0.2, -0.75)) }; }

  project(local) {
    const p = this.courseRoot.localToWorld(local.clone()).project(this.camera);
    return { x: (p.x + 1) * this.size.w / 2, y: (1 - p.y) * this.size.h / 2, inside: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1 };
  }

  resize(w, h) {
    this.size = { w, h }; this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.course) this.cam = null;
  }

  toggleMute() { this.audio.unlock(); this.audio.setMuted(!this.audio.muted); this.ui.update(); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; cancelAnimationFrame(this.raf); this.abort.abort(); this.resizeObserver?.disconnect();
    try { this.audio.ctx.close(); } catch { /* closed */ }
    const g = new Set(), m = new Set(), t = new Set();
    this.scene?.traverse((o) => { if (o.geometry) g.add(o.geometry); for (const x of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) { m.add(x); for (const v of Object.values(x)) if (v?.isTexture) t.add(v); } });
    g.forEach((x) => x.dispose()); m.forEach((x) => x.dispose()); t.forEach((x) => x.dispose()); this.renderer.dispose();
  }
}
