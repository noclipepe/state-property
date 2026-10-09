// Inside the cab: the seated first-person camera and one loose object on the dashboard.
import * as THREE from 'three';

const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

// Camera in the driver's seat. It rides on the truck body (suspension, roll, the drag) and turns
// by a base direction (scripted only during the 1 s opening) plus the player's own look offset,
// which is never overridden. Angles: yaw 0 = straight through the windshield, +90deg = out of
// the driver's window; pitch 0 = level.
export class DriverView {
  constructor(camera, truckBody, eyeLocal) {
    this.camera = camera;
    this.eye = eyeLocal.clone();
    camera.rotation.order = 'YXZ';
    truckBody.add(camera);
    this.reset(0, 0);
  }

  reset(baseYaw, basePitch) {
    this.base = { yaw: baseYaw, pitch: basePitch };
    this.user = { yaw: 0, pitch: 0 };
    this.vel = { yaw: 0, pitch: 0 }; // key look
    this.shake = 0;
    this.vib = 0;
    this.t = 0;
    this.apply();
  }

  setBase(yaw, pitch) { this.base.yaw = yaw; this.base.pitch = pitch; }

  /** player look input (radians). Clamped so you can look out of the windshield, the window and back over the shoulder. */
  look(dYaw, dPitch) {
    const y = this.base.yaw + this.user.yaw + dYaw;
    const cy = THREE.MathUtils.clamp(y, -1.45, 2.95);
    this.user.yaw += dYaw - (y - cy);
    const p = this.base.pitch + this.user.pitch + dPitch;
    const cp = THREE.MathUtils.clamp(p, -1.05, 0.75);
    this.user.pitch += dPitch - (p - cp);
  }

  get yaw() { return this.base.yaw + this.user.yaw; }
  get pitch() { return this.base.pitch + this.user.pitch; }

  /** impulse: a short jolt (restrained) */
  jolt(a) { this.shake = Math.min(1, this.shake + a); }

  update(dt, { vibration = 0, keys = { x: 0, y: 0 } } = {}) {
    this.t += dt;
    // arrow keys turn smoothly
    this.vel.yaw = damp(this.vel.yaw, keys.x * 1.6, 10, dt);
    this.vel.pitch = damp(this.vel.pitch, keys.y * 1.1, 10, dt);
    if (Math.abs(this.vel.yaw) + Math.abs(this.vel.pitch) > 1e-4) this.look(this.vel.yaw * dt, this.vel.pitch * dt);
    this.shake *= Math.exp(-7 * dt);
    this.vib = damp(this.vib, vibration, 6, dt);
    this.apply();
  }

  apply() {
    const cam = this.camera, t = this.t;
    // seated breathing sway + engine vibration + jolts; all small, phone-friendly
    const sx = Math.sin(t * 1.3) * 0.0016 + Math.sin(t * 2.9 + 1) * 0.0008;
    const sy = Math.sin(t * 1.7 + 2) * 0.0014;
    const v = this.vib * 0.0035 + this.shake * 0.012;
    const n1 = Math.sin(t * 61) * 0.6 + Math.sin(t * 37 + 1.3) * 0.4, n2 = Math.sin(t * 53 + 0.4) * 0.6 + Math.sin(t * 29) * 0.4;
    cam.position.copy(this.eye);
    cam.position.y += n2 * v * 0.4;
    cam.rotation.set(this.pitch + sy + n1 * v, this.yaw + Math.PI / 2 + sx + n2 * v, n1 * v * 0.5);
  }
}

// A loose object on the dashboard (the cap). It sits still until the cabin's acceleration beats
// static friction, then slides along the dash top and bumps against the ends.
export class DashProp {
  constructor(mesh, truckBody, rest) {
    this.mesh = mesh;
    this.rest = rest.clone();
    truckBody.add(mesh);
    this.reset();
  }
  reset() {
    this.p = new THREE.Vector2(this.rest.x, this.rest.z);
    this.v = new THREE.Vector2();
    this.spin = 0;
    this.yaw = Math.PI * 0.85;
    this.moving = false;
    this.#place();
  }
  /** acc: acceleration of the truck body in body-local axes (x, z), roll: body roll (rad) */
  update(dt, acc, roll) {
    const g = 9.81, muS = 0.32, muK = 0.22;
    // pseudo-force (object lags behind the cab) + slope from body roll (dash runs along z)
    const ax = -acc.x, az = -acc.y + Math.sin(roll) * g * 0.9;
    const a = Math.hypot(ax, az);
    if (!this.moving && a > muS * g) this.moving = true;
    if (this.moving) {
      this.v.x += ax * dt; this.v.y += az * dt;
      const sp = this.v.length();
      const fr = muK * g * dt;
      if (sp <= fr) { this.v.set(0, 0); if (a < muS * g) this.moving = false; } else this.v.multiplyScalar((sp - fr) / sp);
      this.p.addScaledVector(this.v, dt);
      this.spin += (this.v.y * 2.2 - this.spin) * Math.min(1, dt * 6);
    } else this.spin = damp(this.spin, 0, 6, dt);
    // stay on the dash top: windshield base in front, dash edge behind, pillars at the ends
    if (this.p.x < -0.90) { this.p.x = -0.90; this.v.x *= -0.2; }
    if (this.p.x > -0.74) { this.p.x = -0.74; this.v.x *= -0.2; }
    if (this.p.y < -0.66) { this.p.y = -0.66; this.v.y *= -0.3; }
    if (this.p.y > 0.70) { this.p.y = 0.70; this.v.y *= -0.3; }
    this.yaw += this.spin * dt;
    this.#place();
  }
  #place() {
    this.mesh.position.set(this.p.x, this.rest.y, this.p.y);
    this.mesh.rotation.set(0, this.yaw, 0);
  }
}
