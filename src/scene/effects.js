// Grass clippings kicked up by the tyres, and tyre tracks pressed into the lawn
// (painted into the trample map that flattens grass blades and darkens the soil).
import * as THREE from 'three';

export class Effects {
  constructor(scene, trample) {
    this.trample = trample;
    this.max = 420;
    const g = new THREE.PlaneGeometry(0.05, 0.016);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
    this.parts = new THREE.InstancedMesh(g, m, this.max);
    this.parts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.parts.frustumCulled = false;
    this.parts.count = 0;
    scene.add(this.parts);
    this.pool = [];
    this.last = [];
    this.tmpM = new THREE.Matrix4();
  }

  reset() {
    this.pool.length = 0;
    this.parts.count = 0;
    this.last = [];
    this.trample.clear();
  }

  // wheel contact points (world), slip speeds, rolling speed
  emitFromWheels(wheels, dt, sim) {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const p = w.pivot.getWorldPosition(new THREE.Vector3());
      p.y = 0.02;
      const slip = sim.slip[i] || 0;
      const roll = sim.speed;
      const rate = Math.min(60, slip * 90 + roll * 26) * dt;
      let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
      while (n-- > 0 && this.pool.length < this.max) {
        const side = new THREE.Vector3((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
        const v = new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.4);
        v.x -= sim.vel.x * 0.9; v.z -= sim.vel.y * 0.9;
        const shade = 0.75 + Math.random() * 0.55;
        const c = Math.random() < 0.35 ? [0.30 * shade, 0.22 * shade, 0.12 * shade] : [0.22 * shade, 0.42 * shade, 0.09 * shade];
        this.pool.push({ p: p.clone().add(side), v, life: 0.7 + Math.random() * 0.9, age: 0, rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), spin: (Math.random() - 0.5) * 22, c });
      }
      // tracks: stamp along the path travelled since the last frame
      const last = this.last[i];
      if (last) {
        const d = p.distanceTo(last);
        if (d > 0.025) {
          const steps = Math.ceil(d / 0.05);
          const amt = Math.min(0.45, 0.12 + slip * 0.8 + roll * 0.1);
          for (let k = 1; k <= steps; k++) {
            const q = last.clone().lerp(p, k / steps);
            this.trample.stamp(q.x, q.z, 0.15, amt);
          }
          this.last[i] = p.clone();
        }
      } else this.last[i] = p.clone();
    }
  }

  update(dt) {
    const m = this.tmpM, q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const pt = this.pool[i];
      pt.age += dt;
      if (pt.age > pt.life || pt.p.y < 0) { this.pool.splice(i, 1); continue; }
      pt.v.y -= 9.8 * dt;
      pt.v.multiplyScalar(Math.exp(-1.5 * dt));
      pt.p.addScaledVector(pt.v, dt);
      pt.rot.x += pt.spin * dt; pt.rot.y += pt.spin * 0.7 * dt;
    }
    let k = 0;
    for (const pt of this.pool) {
      const sc = 1 - Math.max(0, pt.age / pt.life - 0.7) / 0.3;
      q.setFromEuler(pt.rot); s.set(sc, sc, sc);
      m.compose(pt.p, q, s);
      this.parts.setMatrixAt(k, m);
      this.parts.instanceColor.setXYZ(k, pt.c[0], pt.c[1], pt.c[2]);
      k++;
    }
    this.parts.count = k;
    this.parts.instanceMatrix.needsUpdate = true;
    this.parts.instanceColor.needsUpdate = true;
  }
}
