// Game orchestrator: owns the scene, systems and the start / intro / play / reset flow.
import * as THREE from 'three';
import { createWorld } from './scene/world.js';
import { loadTruck, truckLineCollider } from './scene/truck.js';
import { Effects } from './scene/effects.js';
import { loadGrandpa } from './character/grandpa.js';
import { GrandpaAnimator } from './character/animator.js';
import { loadPack } from './util/pack.js';
import { patchMaterial } from './scene/shading.js';
import { AudioEngine } from './audio/audio.js';
import { Dialogue } from './audio/dialogue.js';
import { Player, START_POSE, SHOWCASE_POSE } from './gameplay/player.js';
import { Rod, FishingLine } from './gameplay/rod.js';
import { Fishing } from './gameplay/fishing.js';
import { Interactions, LINES } from './gameplay/interactions.js';
import { Input } from './input.js';
import { UI } from './ui/ui.js';

const BASE = new URL('../', import.meta.url).href;

export class Game {
  constructor({ renderer, stage, canvas, quality, isTouch }) {
    this.renderer = renderer; this.stage = stage; this.canvas = canvas; this.quality = quality; this.isTouch = isTouch;
    this.camera = new THREE.PerspectiveCamera(64, 9 / 16, 0.03, 600);
    this.size = { w: 1, h: 1 };
    this.mode = 'loading'; // loading | title | play  (the intro runs during play)
    this.introActive = false;
    this.clock = new THREE.Timer();
    this.ui = new UI(this);
    this.audio = new AudioEngine();
    this.dialogue = new Dialogue(this.audio, document.getElementById('subtitle'));
    this.recordMode = false;
    this.hot = null;
    this.idleTalkT = 25;
    this.debug = new URLSearchParams(location.search);
  }

  async load(progress) {
    const parts = { world: 0, truck: 0, grandpa: 0, props: 0, audio: 0 };
    const report = (k, v, label) => { parts[k] = v; const p = Object.values(parts).reduce((a, b) => a + b, 0) / 5; progress(p, label); };
    report('world', 0, 'Building the scene…');
    this.world = createWorld(this.renderer, this.quality);
    this.scene = this.world.scene;
    report('world', 1);
    const [truck, grandpa, props] = await Promise.all([
      loadTruck((p) => report('truck', p, 'Loading the pickup…')),
      loadGrandpa((p) => report('grandpa', p, 'Loading grandpa…')),
      loadPack(BASE + 'assets/meshes/props', (p) => report('props', p)),
      this.dialogue.load(BASE, (p) => report('audio', p, 'Loading dialogue…')),
    ]);
    report('props', 1); report('audio', 1);
    this.truck = truck; this.grandpa = grandpa;
    this.props = props.geos;
    this.scene.add(truck.root);
    // seat the driver
    grandpa.group.position.fromArray(grandpa.header.seat);
    truck.body.add(grandpa.group);
    this.animator = new GrandpaAnimator(grandpa);
    this.world.pondCenter = this.scene.getObjectByName ? null : null;
    this.world.pondCenter = new THREE.Vector3(11, 0, 6.5);

    // cabin fill: bounce light off the door/ground onto the driver's face
    const fill = new THREE.PointLight(0xffe2c4, 0.9, 1.6, 1.5);
    fill.position.set(-0.25, 1.38, 0.95);
    truck.body.add(fill);
    const fill2 = new THREE.SpotLight(0xdde8ff, 2.2, 3.2, 0.55, 0.8, 1.2);
    fill2.position.set(-0.3, 1.45, 1.9);
    fill2.target.position.set(-0.1, 1.55, 0.45);
    truck.body.add(fill2, fill2.target);
    this.fills = [fill, fill2];

    // camera + player + rod
    this.scene.add(this.camera);
    this.player = new Player(this.camera, this);
    this.rod = new Rod(this.camera, this.props.hand);
    this.line = new FishingLine(this.scene, new THREE.Vector2(1, 1));
    this.#setupLineColliders();
    this.fishing = new Fishing(this);
    this.interactions = new Interactions(this);
    this.fishing.onState = (s, t) => this.#onFishingState(s, t);
    this.effects = new Effects(this.scene, this.world.trample);
    this.input = new Input(this, this.canvas, this.stage);
    this.dialogue.onLineStart = (id) => { this.idleTalkT = 25; };
    this.pickRay = new THREE.Raycaster();
    // subtle ring that marks the target under the cursor
    const rc = document.createElement('canvas'); rc.width = rc.height = 128;
    const rg = rc.getContext('2d');
    rg.strokeStyle = 'rgba(255,211,77,0.95)'; rg.lineWidth = 7; rg.beginPath(); rg.arc(64, 64, 52, 0, Math.PI * 2); rg.stroke();
    rg.strokeStyle = 'rgba(0,0,0,0.35)'; rg.lineWidth = 3; rg.beginPath(); rg.arc(64, 64, 58, 0, Math.PI * 2); rg.stroke();
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rc), depthTest: false, transparent: true }));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.scene.add(this.ring);
    // warm up shaders
    this.renderer.compile(this.scene, this.camera);
    this.player.setPose(START_POSE);
    this.#frame(0);
  }

  makePropMesh(geo) {
    const m = new THREE.Mesh(geo, patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { vertexAO: true }));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  #setupLineColliders() {
    const body = truckLineCollider(this.truck);
    let frame = -1;
    const headC = new THREE.Vector3();
    this.line.colliders.push((p) => {
      if (frame !== this.frameNo) { frame = this.frameNo; body.begin(); this.grandpa.bones.head.getWorldPosition(headC); headC.y += 0.08; }
      if (p.y < 0.01) p.y = 0.01;
      body.apply(p);
      // keep the line off grandpa's face
      const d = p.distanceTo(headC);
      if (d < 0.13) p.sub(headC).multiplyScalar(0.13 / Math.max(d, 1e-4)).add(headC);
    });
  }

  resize(w, h) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep a similar horizontal coverage on wider screens
    this.camera.fov = w / h > 0.7 ? 56 : 64;
    this.camera.updateProjectionMatrix();
    this.line?.mat.resolution.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  start() {
    document.querySelector('.start-sub').textContent = this.isTouch ? 'Sound on · Drag to look · Tap a target to cast' : 'Sound on · Drag to look · Click a target to cast';
    this.ui.showLoading(false);
    this.ui.showStart(true);
    this.mode = 'title';
    window.__ready = true;
    // sound sleeps while the page is hidden (another app, a link, the series menu) and wakes on return
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend();
      else if (this.mode === 'play') this.audio.resume().catch(() => {});
    });
    addEventListener('pagehide', () => this.audio.suspend());
    const loop = () => { this.#tick(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    // autostart / camera override for automated checks
    if (this.debug.has('autostart')) this.go(this.debug.get('autostart') === 'skip');
    if (this.debug.has('cam')) {
      const [x, z, yaw, pitch, y] = this.debug.get('cam').split(',').map(Number);
      this.player.setPose({ x, z, yaw, pitch });
      if (!Number.isNaN(y)) this.player.eyeOverride = y;
    }
  }

  async go(skip = false) {
    if (this.mode !== 'title') return;
    this.ui.showStart(false);
    this.ui.showHud(true);
    // control is handed over immediately; the intro plays in the background
    this.#beginPlay();
    try { await this.audio.resume(); } catch (e) { console.warn('audio', e); }
    if (!skip) this.#runIntro();
  }
  onEnter() { if (this.mode === 'title') this.go(); }

  // Intro dialogue is background activity: no input lock, no camera or pose changes.
  #runIntro() {
    this.introActive = true;
    this.ui.showSkip(true);
    const a = this.animator;
    // gestures follow the actual lines: point at the ground ("here"), then "private property"
    a.play('intro', [
      [0.1, () => { a.setFace({ browAngry: 0.7, frown: 0.6 }); a.setArm('L', 'L_pointDown', { speed: 6 }); }],
      [1.3, () => a.setArm('R', 'R_open')],
      [2.3, () => { a.setArm('L', 'L_sill'); a.setArm('R', 'R_rest'); a.setFace({ browUp: 0.5, browAngry: 0.2 }); }],
      [4.2, () => { a.setFace({ browUp: 0, browAngry: 1, frown: 0.9 }); a.setArm('L', 'L_pointDown', { speed: 8 }); }],
      [5.6, () => a.setArm('L', 'L_pointOut', { speed: 8 })],
      [6.6, () => a.setArm('L', 'L_pointDown', { speed: 8 })],
      [7.4, () => { a.setArm('L', 'L_sill'); }],
    ], 7.8);
    const token = (this.introToken = (this.introToken || 0) + 1);
    this.dialogue.sequence(LINES.intro).then(() => { if (token === this.introToken) this.#endIntro(); });
  }

  #endIntro() {
    this.introActive = false;
    this.ui.showSkip(false);
  }

  skipIntro() {
    if (!this.introActive) return;
    this.introToken++;
    this.dialogue.skipSequence(); // a reaction queued meanwhile still plays
    if (this.animator.script?.name === 'intro') { this.animator.script = null; this.animator.idlePose(); }
    this.#endIntro();
  }

  replayIntro() {
    if (this.mode !== 'play') return;
    this.skipIntro();
    this.dialogue.stop();
    this.#runIntro();
  }

  #beginPlay() {
    this.mode = 'play';
    this.ui.setControls(true);
    this.input.enabled = true;
    this.animator.idlePose();
    this.idleTalkT = 25;
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.ui.setMuted(this.audio.muted);
  }

  /** Modes -> Back to games: silence everything first, then leave for the series menu */
  backToGames() {
    this.audio.suspend();
    location.href = './';
  }

  onEscape() {
    if (this.recordMode) this.setRecordMode(false);
    this.ui.closeMenu();
  }

  setRecordMode(on) {
    this.recordMode = on;
    this.ui.setRecord(on);
    if (on) this.reset();
  }

  /**
   * Restart: stop speech, clear queued lines/timers/subtitles and reaction flags, restore the
   * truck, player and line, then play the original introduction again (once). Controls stay live.
   */
  reset({ intro = true } = {}) {
    this.introToken = (this.introToken || 0) + 1; // invalidates callbacks of a previous intro
    this.dialogue.reset();
    this.fishing.reset();
    this.interactions.reset();
    this.truck.sim.reset();
    this.truck.setMirrorAngle(0);
    this.animator.reset();
    this.animator.idlePose();
    this.effects.reset();
    this.player.setPose(START_POSE);
    this.line.inited = false;
    this.showcase = false;
    if (this.introActive) this.#endIntro();
    this.idleTalkT = 25;
    if (intro && this.mode === 'play') this.#runIntro();
  }

  startShowcase() {
    if (this.mode === 'title') { this.ui.showStart(false); this.ui.showHud(true); this.audio.resume(); }
    this.reset({ intro: false });
    if (this.mode !== 'play') this.#beginPlay();
    this.showcase = true;
    this.player.setPose(SHOWCASE_POSE);
    this.#frame(0);
    this.fishing.attachNow(this.interactions.byId.truck);
  }

  onTap(x, y) {
    if (this.mode !== 'play') return;
    const t = this.#pick(x, y, true);
    if (t) this.fishing.cast(t);
    else this.ui.setHint(this.isTouch ? 'Tap a highlighted target to cast' : 'Click a highlighted target to cast');
  }
  onRelease() { if (this.fishing.hooked || this.fishing.state === 'casting') this.fishing.release('player'); }
  onReelChanged(on) { this.fishing.reeling = on; }

  // generous picking: screen-space distance to each target's anchor; area targets (rear door)
  // are hit-tested so the hook lands where you clicked. commit=true fixes the aim for a cast.
  #pick(x, y, commit = false) {
    const v = new THREE.Vector3();
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    let best = null, bestD = Infinity;
    const area = this.#pickArea(x, y, commit);
    for (const t of this.interactions.targets) {
      if (!t.enabled() || t.region) continue;
      t.anchor(v);
      const dist = v.distanceTo(camPos);
      if (dist > 8) continue;
      const r = t.hitRadius;
      const edge = v.clone().add(this.camera.up.clone().applyQuaternion(this.camera.quaternion).multiplyScalar(r));
      v.project(this.camera); edge.project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * this.size.w, sy = (-v.y * 0.5 + 0.5) * this.size.h;
      const ex = (edge.x * 0.5 + 0.5) * this.size.w, ey = (-edge.y * 0.5 + 0.5) * this.size.h;
      const rad = Math.max(Math.hypot(ex - sx, ey - sy), this.isTouch ? 46 : 34);
      const d = Math.hypot(sx - x, sy - y);
      if (d < rad && d / rad < bestD) { bestD = d / rad; best = t; }
    }
    // a small target right under the cursor wins over the big rear-door area
    if (area && !(best && bestD < 0.6)) {
      if (commit) area.t.setAim(area.local);
      area.t.hoverLocal = area.local;
      return area.t;
    }
    return best;
  }

  #pickArea(x, y, refine) {
    const ndc = new THREE.Vector2((x / this.size.w) * 2 - 1, -(y / this.size.h) * 2 + 1);
    this.pickRay.setFromCamera(ndc, this.camera);
    const body = this.truck.body;
    body.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    for (const t of this.interactions.targets) {
      if (!t.region || !t.enabled()) continue;
      const ray = this.pickRay.ray.clone().applyMatrix4(inv);
      const hit = ray.intersectBox(t.region, new THREE.Vector3());
      if (!hit || hit.distanceTo(ray.origin) > 8) continue;
      let local = null;
      if (refine) {
        // exact surface point on the body mesh
        const hits = this.pickRay.intersectObject(this.truck.bodyMesh, false);
        for (const h of hits) {
          const lp = h.point.clone().applyMatrix4(inv);
          const r = t.region.clone().expandByScalar(0.02);
          if (r.containsPoint(lp)) { local = lp; break; }
          if (h.distance > hit.distanceTo(ray.origin) + 0.3) break;
        }
      }
      if (!local) {
        // snap the box hit onto the door skin / side glass plane
        local = hit.clone();
        const D = this.truck.dims, TH = this.truck.tumble;
        local.z = local.y > D.belt ? TH.a[0] - (local.y - TH.a[1]) * TH.n[1] / TH.n[0] : D.halfW;
      }
      return { t, local };
    }
    return null;
  }

  #onFishingState(state, target) {
    if (state === 'hooked' && target) this.ui.setHint('');
  }

  // ------------------------------------------------------------------------ loop
  #tick() {
    this.clock.update();
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 1 / 30);
    this.#adaptResolution(raw);
    this.#frame(dt);
  }

  // lower the render resolution a little if the device can't keep up
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
    this.frameNo = (this.frameNo || 0) + 1;
    this.input?.update();
    if (this.mode === 'play') this.player.update(dt, this.input.move);
    else this.player.update(dt, { x: 0, y: 0 });
    // world-space focus for shadows: between player and truck
    const focus = this.truck.root.position.clone().lerp(this.player.pos, 0.35);
    this.world.update(dt, focus);

    // fishing + targets
    this.fishing.reeling = this.input.reeling;
    this.rod.update(dt, {
      tension: this.fishing.tension,
      lineDirWorld: this.line.tipDir(new THREE.Vector3()),
      reeling: this.input.reeling && (this.fishing.hooked || this.fishing.state === 'retrieving'),
      walking: this.player.vel.lengthSq() > 0.05,
      heavy: !!this.fishing.target?.movesTruck,
    });
    // truck physics (before the line so attach points are current)
    const prevVel = this.truck.sim.vel.clone();
    this.truck.sim.step(dt);
    this.truck.root.updateMatrixWorld(true);
    this.fishing.update(dt);
    this.interactions.update(dt);
    this.dialogue.update();

    // character
    const acc = dt > 0 ? new THREE.Vector3((this.truck.sim.vel.x - prevVel.x) / dt, 0, (this.truck.sim.vel.y - prevVel.y) / dt) : new THREE.Vector3();
    // acceleration in the character's frame (truck local)
    acc.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.truck.sim.yaw);
    if (!this.animator.lookOverride) this.animator.lookTarget.copy(this.camera.getWorldPosition(new THREE.Vector3()));
    this.animator.update(dt, { truckAccel: acc, speechEnv: this.dialogue.envelope(), speaking: this.dialogue.speaking });

    // idle remark if the player just stands around
    if (this.mode === 'play' && !this.fishing.hooked && !this.dialogue.speaking && !this.animator.busy) {
      this.idleTalkT -= dt;
      if (this.idleTalkT < 0) {
        this.idleTalkT = 30 + Math.random() * 15;
        const id = this.dialogue.say(LINES.idle, { lineCooldown: 25 });
        if (id === 'g_road') { const a = this.animator; a.play('idleTalk', [[0, () => a.setArm('L', 'L_thumbBack', { speed: 8 })], [1.3, () => a.setArm('L', 'L_sill')]], 1.8); }
      }
    }

    // effects + audio parameters
    const sim = this.truck.sim;
    if (!sim.stuck || sim.speed > 0.01) this.effects.emitFromWheels(this.truck.wheels, dt, sim);
    this.effects.update(dt);
    const scrape = Math.min(1, (sim.slip.reduce((a, b) => a + b, 0) / 4) * 2.2);
    const toTruck = this.truck.root.position.clone().sub(this.player.pos);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pondD = this.player.pos.distanceTo(this.world.pondCenter);
    this.audio.update({
      engine: 1, enginePan: toTruck.normalize().dot(right) * 0.6,
      water: Math.max(0, 1 - (pondD - 4) / 9),
      scrape: sim.stuck ? 0 : scrape, roll: sim.stuck ? 0 : Math.min(1, sim.speed * 1.6),
      strain: this.fishing.hooked ? this.fishing.tension : 0,
      reel: this.input.reeling && (this.fishing.hooked || this.fishing.state === 'retrieving') ? 1 : 0,
      reelLoad: this.fishing.hooked ? this.fishing.tension * (this.fishing.target?.movesTruck ? 1 : 0.5) : 0,
    });

    // UI
    if (this.mode === 'play') {
      const hp = this.input.hover;
      this.hot = hp ? this.#pick(hp.x, hp.y) : null;
      this.canvas.classList.toggle('can-cast', !!this.hot);
      this.ring.visible = !!this.hot && !this.recordMode && this.fishing.target !== this.hot;
      if (this.ring.visible) {
        if (this.hot.region && this.hot.hoverLocal) this.truck.worldPoint(this.ring.position.copy(this.hot.hoverLocal), this.ring.position);
        else this.hot.anchor(this.ring.position);
        const s = this.hot.hitRadius * 1.5 * (1 + 0.06 * Math.sin(performance.now() / 160));
        this.ring.scale.set(s, s, s);
      }
      this.#updateHint();
    }
    const hooked = this.fishing.hooked ? this.fishing.target : null;
    this.ui.update({
      camera: this.camera, targets: this.interactions.targets, hot: this.hot, hooked,
      tension: this.fishing.tension, showLabels: this.mode === 'play' && !this.recordMode, w: this.size.w, h: this.size.h,
      hookedState: hooked ? this.#hookedLabel(hooked) : '',
    });
    this.renderer.render(this.scene, this.camera);
  }

  #hookedLabel(t) {
    if (t.movesTruck) return this.truck.sim.stuck ? (this.fishing.tension > 0.6 ? t.label + ' · straining' : t.label) : 'Truck moving!';
    if (t.id === 'cap' && t.state === 'hanging') return 'Got the cap';
    return t.label;
  }

  #updateHint() {
    const touch = this.isTouch;
    const f = this.fishing;
    let h = '';
    if (f.state === 'idle' || f.state === 'retrieving') h = touch ? 'Tap a target to cast · drag to look · stick to move' : 'Click a target to cast · drag to look · WASD to move';
    else if (f.state === 'casting') h = '';
    else if (f.hooked) {
      const t = f.target;
      if (t.movesTruck && !this.truck.sim.stuck) h = touch ? 'Keep reeling! Back up with the stick' : 'Keep reeling! Back up with S';
      else h = touch ? 'Hold REEL to pull · Release to unhook' : 'Hold SPACE (or REEL) to pull · X to release';
    }
    this.ui.setHint(h);
  }
}
