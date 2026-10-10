import * as THREE from 'three';
import { createWorld } from '../scene/world.js';
import { loadTruck } from '../scene/truck.js';
import { loadGrandpa, loadFisherman } from '../character/grandpa.js';
import { GrandpaAnimator } from '../character/animator.js';
import { Effects } from '../scene/effects.js';
import { Fisherman } from '../driver/fisherman.js';
import { Hook } from '../driver/hook.js';
import { Conversation } from '../driver/conversation.js';
import { HOME, FISHER_LOCAL, BUCKET_LOCAL, POND } from '../driver/layout.js';
import { Bucket, WaterView, WATER, REST } from './bucket.js';
import { FishAudio } from './audio.js';
import { FishInput } from './input.js';
import { FishUI } from './ui.js';
import { BucketSpill } from './spill.js';

const V = (x, y, z) => new THREE.Vector3(x,y,z);
const UP = V(0,1,0);
const homeWorld = (p) => p.clone().applyAxisAngle(UP, HOME.yaw).add(V(HOME.x,0,HOME.z));
const smooth = THREE.MathUtils.smoothstep;

export class FishGame {
  constructor({ renderer, stage, canvas, quality }) {
    Object.assign(this, { renderer, stage, canvas, quality });
    this.mode = 'loading'; this.paused = false;
    this.params = new URLSearchParams(location.search);
    this.showcase = this.params.has('showcase');
    this.audio = new FishAudio();
    this.ui = new FishUI(this);
    this.input = new FishInput(this, canvas, document.getElementById('btn-swim'));
    this.camera = new THREE.PerspectiveCamera(88, 9/16, 0.015, 250);
    this.camera.rotation.order = 'YXZ';
    this.clips = {};
    this.size = { w: 1, h: 1 };
    this.exited = false;
  }

  async load() {
    this.ui.progress(0.05, 'Finding the bucket…');
    this.world = createWorld(this.renderer, this.quality, { grass: { x: -1.5, z: 6, r: 17 }, grassScale: 1.6 });
    this.scene = this.world.scene;
    const [truck, driver, fisherman] = await Promise.all([
      loadTruck((p) => this.ui.progress(0.1 + p * 0.2, 'Loading the pickup…')),
      loadGrandpa(), loadFisherman(), this.loadClips(),
    ]);
    this.truck = truck; this.driver = driver;
    this.scene.add(truck.root);
    const sim = truck.sim;
    sim.home = { ...HOME }; sim.maxSpeed = 1.3; sim.maxYawRate = 0.12;
    sim.bounds = { x0: -9, x1: 2.4, z0: 2.5, z1: 12 };
    sim.avoid = [{ x: -6.5, z: 4.5, r: 3 }, { x: 3, z: 11, r: 2.4 }];
    sim.reset();
    driver.group.position.fromArray(driver.header.seat);
    truck.body.add(driver.group);
    this.driverAnim = new GrandpaAnimator(driver, { glances: [] });
    this.fisher = new Fisherman(fisherman, this.scene);
    const fp = homeWorld(V(...FISHER_LOCAL)), eye = this.eyeWorld();
    this.fisher.setHome(fp, Math.atan2(eye.x - fp.x, eye.z - fp.z));
    const fill = new THREE.PointLight(0xffe2c4, 0.6, 1.8, 1.5);
    fill.position.set(-0.3,1.5,0.6); truck.body.add(fill);
    const bounce = new THREE.PointLight(0xffefd9, 1.3, 5, 1.4);
    bounce.position.copy(fp).add(V(0,1.8,0)); this.scene.add(bounce);
    this.effects = new Effects(this.scene, this.world.trample);
    this.hook = new Hook({ scene: this.scene, truck, fisherman: this.fisher, audio: this.audio, pond: POND, resolution: new THREE.Vector2(1,1) });
    this.conv = new Conversation({
      audio: this.audio, clips: this.clips, ui: this.ui, automatic: true,
      onAction: (...args) => this.perform(...args),
      onEvent: (event) => { if (event === 'conversationDone') this.hook.start((e) => this.onHook(e)); },
    });
    // The pail sits beside the fisherman, where the sliding pickup will catch its rim.
    this.bucket = new Bucket(this.scene, homeWorld(V(...BUCKET_LOCAL)));
    this.spill = new BucketSpill(this);
    const landingArea=this.bucket.home.clone().add(homeWorld(V(0,0,2)).sub(homeWorld(V(0,0,0))));
    const grassMatrix = new THREE.Matrix4(), grassPos = V(0,0,0);
    for (let i = 0; i < this.world.grass.count; i++) {
      this.world.grass.getMatrixAt(i, grassMatrix);
      grassPos.setFromMatrixPosition(grassMatrix);
      if (Math.hypot(grassPos.x - this.bucket.root.position.x, grassPos.z - this.bucket.root.position.z) < 0.52 || Math.hypot(grassPos.x-landingArea.x,grassPos.z-landingArea.z)<0.85) {
        grassMatrix.elements[13] = -2;
        this.world.grass.setMatrixAt(i, grassMatrix);
      }
    }
    this.world.grass.instanceMatrix.needsUpdate = true;
    this.waterView = new WaterView(this.renderer);
    this.target = homeWorld(V(-0.44,1.58,1.22));
    bounce.position.copy(this.bucket.root.position).lerp(fp, 0.5).setY(2.1);
    bounce.intensity = 2.4;
    const d = this.target.clone().sub(this.bucket.root.position.clone().setY(REST));
    this.baseYaw = Math.atan2(-d.x, -d.z);
    this.basePitch = Math.atan2(d.y, Math.hypot(d.x,d.z));
    this.bucket.handle.rotation.y = this.baseYaw + 0.2;
    this.cameraBack = V(0,0,0.085).applyAxisAngle(UP,this.baseYaw);
    this.bucket.school.rotation.y = this.baseYaw;
    this.reset(false);
    this.renderer.compile(this.scene, this.camera);
    this.ui.progress(1, 'Ready');
    this.mode = 'play'; this.go();
    window.__ready = true;
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    addEventListener('pagehide', () => this.stop());
    addEventListener('pageshow', (e) => { if (e.persisted) { this.exited = false; this.paused = true; this.ui.showPause(true); } });
    let previous = performance.now();
    const loop = (now) => {
      const raw = (now - previous) / 1000; previous = now;
      if (!document.hidden && !this.paused && !this.exited) {
        this.adapt(raw);
        this.frame(Math.min(raw, 0.05));
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async loadClips() {
    const res = await fetch('assets/audio/driver_dialogue.json');
    if (!res.ok) throw new Error('Dialogue unavailable');
    const lines = await res.json();
    await Promise.all(Object.entries(lines).map(async ([id,line]) => {
      this.clips[id] = { line, buffer: await this.audio.decode(line.file) };
    }));
  }

  get active() { return this.mode === 'play' && !this.paused && !this.ending?.shown; }
  get state() { return this.conv?.state ?? this.mode; }
  eyeWorld() {
    this.truck.root.updateMatrixWorld(true);
    return this.driver.bones.eyeL.getWorldPosition(V(0,0,0));
  }

  go(showcase = this.showcase) {
    if (this.mode === 'loading') return;
    this.showcase = showcase; this.mode = 'play';
    this.audio.unlock();
    this.reset();
    this.ui.begin();
  }

  reset(begin = true) {
    this.conv.reset(); this.hook.reset(); this.audio.flushSfx();
    this.truck.sim.reset(); this.fisher.reset(); this.driverAnim.reset(); this.driverAnim.idlePose();
    this.effects.reset(); this.world.trample.clear(); this.spill.reset(); this.bucket.reset(); this.input.reset();
    this.time = 0; this.ending = null; this.nextBubble = 3.6; this.jump = null; this.cooldown = 0;
    this.height = REST; this.velocity = 0; this.lookYaw = 0; this.lookPitch = 0;
    this.swimOffset = V(0,0,0); this.swimVelocity = V(0,0,0);
    this.splashAt = -10; this.sceneDone = false;
    this.yaw = this.baseYaw; this.pitch = this.basePitch; this.wet = 1;
    this.paused = false; this.ui.reset();
    this.audio.setDepth(1);
    if (begin && this.mode === 'play') {
      this.audio.unlock(); this.conv.begin(0); this.ui.begin();
    }
    this.placeCamera(0);
    const forward = this.camera.getWorldDirection(V(0,0,0)).setY(0).normalize();
    const right = forward.clone().cross(UP);
    for (let i = 0; i < 4; i++) {
      const b = this.bucket.bubbles[i];
      b.mesh.position.copy(forward).multiplyScalar(0.12 + i * 0.027).addScaledVector(right, (i - 1.5) * 0.035);
      b.mesh.position.y = REST - 0.03 - i * 0.016;
      b.speed = 0.028 + i * 0.009;
    }
  }

  look(yaw, pitch) {
    if (!this.active || this.showcase || this.spill.active) return;
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw + yaw, -Math.PI, Math.PI);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + pitch, -1.4, 0.9);
  }

  splash(directed = false) {
    if (!this.active || this.ending || this.spill.active || (this.showcase && !directed) || this.jump || this.cooldown > 0) return false;
    this.jump = { t: 0, from: this.height, entered: false };
    this.bucket.splash(0.65,this.swimOffset.clone().add(this.cameraBack)); this.audio.splash(0.65);
    this.cooldown = 1.8;
    return true;
  }

  placeCamera(dt) {
    const move=this.showcase ? {x:0,y:0} : this.input.movement;
    const targetVelocity=V(move.x*Math.cos(this.yaw)+move.y*Math.sin(this.yaw),0,-move.x*Math.sin(this.yaw)+move.y*Math.cos(this.yaw)).multiplyScalar(0.14);
    this.swimVelocity.lerp(targetVelocity,1-Math.exp(-6*dt));
    this.swimOffset.addScaledVector(this.swimVelocity,dt);
    if(this.swimOffset.length()>0.125) {
      this.swimOffset.setLength(0.125);
      const normal=this.swimOffset.clone().normalize(), outward=this.swimVelocity.dot(normal);
      if(outward>0) this.swimVelocity.addScaledVector(normal,-outward);
    }
    let target = this.input.rising ? WATER + 0.085 : REST;
    if (this.showcase) {
      // Fixed, repeatable rise on “STATE?!”, then a dip and a second rise for his name.
      const t = this.time;
      const lift = (smooth(t, 3.1, 4.7) - smooth(t, 7.4, 9.2)) + (smooth(t, 16, 17.8) - smooth(t, 20.5, 22));
      target = REST + lift * 0.205;
      if (t > 24.2 && !this.showJump) { this.showJump = true; this.splash(true); }
    }
    if (this.ending) target = REST;
    const old = this.height, landing = !!this.jump;
    if (this.jump) {
      this.jump.t += dt;
      const u = Math.min(1, this.jump.t / 1.28);
      this.height = THREE.MathUtils.lerp(this.jump.from, REST, u) + Math.sin(Math.PI * u) * 0.62;
      this.velocity = 0;
      if (u >= 1) this.jump = null;
    } else {
      this.velocity += ((target - this.height) * 22 - this.velocity * 8) * dt;
      this.height += this.velocity * dt;
    }
    if (old >= WATER && this.height < WATER) {
      this.bucket.splash(landing ? 1.65 : 0.65,this.swimOffset.clone().add(this.cameraBack)); this.audio.splash(landing ? 2 : 0.75);
      if(landing) this.splashAt=this.bucket.time.value;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.yaw = THREE.MathUtils.damp(this.yaw, this.baseYaw + this.lookYaw, 8, dt);
    const jumpPitch = smooth(this.height, WATER + 0.04, WATER + 0.42) * 0.12;
    this.pitch = THREE.MathUtils.damp(this.pitch, this.basePitch + this.lookPitch - jumpPitch, 8, dt);
    this.camera.position.copy(this.bucket.root.position).add(this.cameraBack).add(this.swimOffset);
    this.camera.position.x += Math.sin(this.time * 0.65) * 0.018;
    this.camera.position.z += Math.sin(this.time * 0.5) * 0.014;
    this.camera.position.y = this.height + Math.sin(this.time * 1.5) * 0.004;
    this.camera.rotation.set(THREE.MathUtils.clamp(this.pitch, -1.15, 1.3), this.yaw, Math.sin(this.time * 0.8) * 0.003);
    this.wet = 1 - smooth(this.camera.position.y, WATER - 0.012, WATER + 0.012);
    this.audio.setDepth(this.wet);
  }

  perform(who, action, arg, extra) {
    const f = this.fisher;
    if (who === 'd') {
      if (action === 'arm') {
        if (arg === 'R_pocket') {
          this.driverAnim.setArm('R', null, { dyn: () => {
            this.driver.bones.chest.updateWorldMatrix(true, false);
            const w = this.driver.group.worldToLocal(V(0.085,0.1,0.2).applyMatrix4(this.driver.bones.chest.matrixWorld));
            return { w, f: V(-0.2,0.55,0.8), n: V(0.3,-0.2,-0.9), p: V(0.3,-1,-0.5) };
          }, hand: 'pinch', speed: 5 });
        } else this.driverAnim.setArm(arg[0], arg, { speed: extra ?? 7 });
      }
      return;
    }
    if (action === 'listen') f.lookAt(() => this.eyeWorld(), 60);
    if (action === 'face') f.setFace(arg);
    if (action === 'gesture') f.setLeft(arg);
    if (action === 'nod') f.nod();
    if (action === 'lean') f.setLean(arg);
    if (action === 'prepare') { f.setHold('ready',3); f.lookAt(() => this.hook.hookWorld(),1.2); }
  }

  onHook(event) {
    if (event === 'moving') {
      this.conv.setState('pull');
      this.driverAnim.setArm('L','L_grabSill',{speed:10});
      this.driverAnim.setArm('R','R_wheel',{speed:10});
      this.driverAnim.setLean({back:0.5});
    }
    if (event === 'stopped') {
      this.conv.setState('end'); this.driverAnim.setLean({back:0});
      this.sceneDone = true;
    }
  }

  frame(dt) {
    if (this.active && !this.spill.active) { this.input.update(dt); this.placeCamera(dt); }
    if (this.active && this.audio.running) {
      this.time += dt;
      this.conv.update(dt);
      this.hook.update(dt); this.truck.sim.step(dt);
      this.truck.root.updateMatrixWorld(true);
      this.spill.checkContact();
      if (this.time > this.nextBubble && !this.spill.active) {
        this.bucket.bubble(); this.audio.bubble(); this.nextBubble += 4.7;
      }
    }
    const speaker = this.conv.speaker, env = this.conv.speakerEnv;
    this.driverAnim.lookTarget.copy(this.fisher.headWorld);
    this.driverAnim.update(dt, { speechEnv: speaker === 'driver' ? env : 0, speaking: speaker === 'driver' });
    this.fisher.update(dt, { lookTarget: this.eyeWorld(), speechEnv: speaker === 'fisherman' ? env : 0, speaking: speaker === 'fisherman' });
    this.hook.updateLine(dt);
    this.world.update(dt, this.truck.root.position);
    if (this.truck.sim.speed > 0.02) this.effects.emitFromWheels(this.truck.wheels, dt, this.truck.sim);
    this.effects.update(dt); this.bucket.update(dt);
    if(this.active && this.audio.running) this.spill.update(dt);
    if (this.audio.running) this.audio.update({ engine: 0.35, enginePan: 0, water: 0.5 + this.wet * 0.75, scrape: this.truck.sim.speed * 0.25,
      roll: this.truck.sim.speed * 0.3, strain: this.hook.tension * 0.35, reel: this.fisher.reeling ? 0.3 : 0, reelLoad: this.hook.tension });
    if (!this.ending && this.sceneDone && this.spill.t > 4.2) {
      this.ending = { shown: true }; this.input.reset(); this.ui.showEnd(); this.audio.suspend();
    }
    this.ui.update();
    const splashAge=this.bucket.time.value-this.splashAt;
    this.waterView.render(this.scene, this.camera, this.bucket.time.value, this.wet,splashAge<1.3 ? Math.exp(-splashAge*3.5) : 0);
  }

  resize(w,h) {
    this.size = {w,h}; this.renderer.setSize(w,h,false);
    this.camera.aspect = w/h;
    this.camera.fov = w/h < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(0.54) / (w/h))) : 68;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.waterView?.resize(Math.round(w*dpr),Math.round(h*dpr));
    this.hook?.line.mat.resolution.set(w*dpr,h*dpr);
  }
  adapt(raw) {
    if (raw <= 0 || raw > 0.3 || this.mode !== 'play') return;
    this.frameTime = (this.frameTime || raw) * 0.97 + raw * 0.03;
    this.adaptTime = (this.adaptTime || 0) + raw;
    if (this.adaptTime < 2) return;
    this.adaptTime = 0;
    const pr = this.renderer.getPixelRatio();
    if (this.frameTime > 1/38 && pr > 0.8) { this.renderer.setPixelRatio(Math.max(0.8,pr*0.85)); this.resize(this.size.w,this.size.h); }
  }
  pause() {
    if (this.mode !== 'play' || this.paused || this.ending?.shown) return;
    this.paused = true; this.input.reset(); this.audio.suspend(); this.ui.showPause(true);
  }
  resume() {
    if (!this.paused) return;
    this.paused = false; this.audio.unlock(); this.ui.showPause(false);
  }
  toggleMute() { this.audio.setMuted(!this.audio.muted); this.ui.update(); }
  stop() { this.paused = true; this.exited = true; this.input.reset(); this.conv.reset(); this.audio.flushSfx(); this.audio.setMuted(true); this.audio.suspend(); }
  backToGames() { this.stop(); location.href = './'; }
}
