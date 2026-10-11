// First-person player: small walkable area beside the truck, look, collisions, handheld feel.
import * as THREE from 'three';

export const START_POSE = { x: -0.30, z: 1.74, yaw: -0.17, pitch: -0.27 };
export const SHOWCASE_POSE = { x: -4.95, z: 5.55, yaw: -0.64, pitch: -0.13 };
const EYE = 1.64;
const RADIUS = 0.3;

export class Player {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.lookVel = new THREE.Vector2();
    this.time = 0;
    this.walk = 0;
    this.shake = 0;
    camera.rotation.order = 'YXZ';
    this.setPose(START_POSE);
  }

  setPose(p) {
    this.pos.set(p.x, 0, p.z);
    this.vel.set(0, 0, 0);
    this.yaw = p.yaw; this.pitch = p.pitch;
    this.lookVel.set(0, 0);
    this.#apply(0);
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.15, 0.95);
  }

  update(dt, move) {
    this.time += dt;
    // movement relative to view yaw
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3().addScaledVector(fwd, move.y).addScaledVector(right, move.x);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(1.5);
    this.vel.lerp(want, 1 - Math.exp(-10 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.#collide();
    const speed = this.vel.length();
    this.walk += speed * dt * 6.2;
    this.#apply(dt, speed);
  }

  #collide() {
    const t = this.game.truck;
    // truck footprint as an oriented box in the truck root frame
    const root = t.root;
    const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
    const dx = this.pos.x - root.position.x, dz = this.pos.z - root.position.z;
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    const scale = root.scale.x;
    const hx = (t.collisionHalf?.x ?? 2.86) * scale + RADIUS, hz = (t.collisionHalf?.z ?? 1.0) * scale + RADIUS;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
      const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
      if (px < pz) lx = (Math.sign(lx) || 1) * hx; else lz = (Math.sign(lz) || 1) * hz;
    }
    // mirror head sticks out on the driver side
    const ma = t.mirrorAngle || 0;
    const mx = -0.80 - Math.sin(ma) * 0.25, mz = 1.0 + Math.cos(ma) * 0.25;
    const ddx = lx - mx, ddz = lz - mz, dd = Math.hypot(ddx, ddz), mr = 0.16 + RADIUS;
    if (!t.gru && dd < mr && dd > 1e-4) { lx = mx + ddx / dd * mr; lz = mz + ddz / dd * mr; }
    this.pos.x = root.position.x + lx * c + lz * s;
    this.pos.z = root.position.z - lx * s + lz * c;
    // play area: stay near the truck, out of the pond, off the road
    const ax = this.pos.x + 0.5, az = this.pos.z - 1.0;
    const r = Math.hypot(ax, az), maxR = 9;
    if (r > maxR) { this.pos.x = -0.5 + ax / r * maxR; this.pos.z = 1.0 + az / r * maxR; }
    const pc = this.game.world.pondCenter;
    if (pc) {
      const px = (this.pos.x - pc.x) / 1.3, pz = this.pos.z - pc.z, pr = Math.hypot(px, pz), lim = 4.9 + RADIUS;
      if (pr < lim) { this.pos.x = pc.x + px / pr * lim * 1.3; this.pos.z = pc.z + pz / pr * lim; }
    }
    this.pos.z = Math.max(this.pos.z, -8.6);
    // Walk around the upright pail instead of through its metal wall.
    const bucket = this.game.bucket;
    if (bucket && !bucket.spilled) {
      const dx = this.pos.x-bucket.home.x, dz = this.pos.z-bucket.home.z, d = Math.hypot(dx,dz), r = 0.33*bucket.root.scale.x+RADIUS;
      if (d < r) { this.pos.x=bucket.home.x+(d>1e-4 ? dx/d : 1)*r; this.pos.z=bucket.home.z+(d>1e-4 ? dz/d : 0)*r; }
    }
    // tree trunks near the play area
    for (const [tx, tz, th] of this.game.world.trees?.list || []) {
      const r = 0.28 * (th / 9) + RADIUS;
      const dx = this.pos.x - tx, dz = this.pos.z - tz, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-4) { this.pos.x = tx + dx / d * r; this.pos.z = tz + dz / d * r; }
    }
  }

  #apply(dt, speed = 0) {
    const cam = this.camera;
    const t = this.time;
    // subtle handheld motion (very small), plus a gentle step bob while walking
    const hx = (Math.sin(t * 0.9) * 0.6 + Math.sin(t * 2.3 + 1.3) * 0.3) * 0.0028;
    const hy = (Math.sin(t * 1.1 + 2) * 0.6 + Math.sin(t * 2.9) * 0.25) * 0.0024;
    const bob = Math.sin(this.walk) * 0.012 * Math.min(1, speed);
    const sway = Math.cos(this.walk * 0.5) * 0.008 * Math.min(1, speed);
    this.shake *= Math.exp(-6 * dt);
    const sk = this.shake * (Math.random() - 0.5) * 0.01;
    cam.position.set(this.pos.x + sway * Math.cos(this.yaw), (this.eyeOverride ?? EYE) + bob, this.pos.z - sway * Math.sin(this.yaw));
    cam.rotation.set(this.pitch + hy + sk, this.yaw + hx + sk, 0);
    cam.updateMatrixWorld();
  }
}
