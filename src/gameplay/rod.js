// First-person fishing rod (bending blank, guides, spinning reel, player's hand) and the
// fishing line: a verlet rope from the rod tip to the hook that sags when slack.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { patchMaterial } from '../scene/shading.js';

const ROD_LEN = 1.62;
const SEGS = 44, RADIAL = 8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Rod {
  /**
   * camera: the camera (first-person viewmodel, positioned by update()) or a scene/group
   * (a rod held by a character, positioned by updateHeld()). handGeo: optional first-person hand.
   */
  constructor(camera, handGeo) {
    this.camera = camera;
    this.viewmodel = !!camera.isCamera;
    this.group = new THREE.Group(); // in camera space (viewmodel) or parent space
    this.group.name = this.viewmodel ? 'viewmodel' : 'rod';
    camera.add(this.group);
    this.rodFrame = new THREE.Group(); // butt at origin, rod along -Z
    this.group.add(this.rodFrame);
    this.bend = new THREE.Vector3(); // tip deflection in rod frame
    this.bendTarget = new THREE.Vector3();
    this.aim = new THREE.Vector3(0.22, 0.80, -0.56).normalize();
    this.aimTarget = this.aim.clone();
    this.castAnim = 0; // 0..1 flick
    this.reelAngle = 0;
    this.sway = new THREE.Vector2();

    // blank
    const geo = new THREE.BufferGeometry();
    const nv = (SEGS + 1) * RADIAL;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(nv * 3);
    const idx = [];
    for (let i = 0; i < SEGS; i++) for (let j = 0; j < RADIAL; j++) {
      const a = i * RADIAL + j, b = i * RADIAL + (j + 1) % RADIAL, c = (i + 1) * RADIAL + j, d = (i + 1) * RADIAL + (j + 1) % RADIAL;
      idx.push(a, c, b, b, c, d);
    }
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      // cork handle, black reel seat, dark red blank with lighter tip section
      let c = [0.12, 0.03, 0.03];
      if (s < 0.17) c = [0.58, 0.42, 0.26];
      else if (s < 0.21) c = [0.05, 0.05, 0.05];
      else if (s > 0.86) c = [0.80, 0.80, 0.78];
      for (let j = 0; j < RADIAL; j++) col.set(c, (i * RADIAL + j) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.blankGeo = geo;
    const blankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 });
    this.blank = new THREE.Mesh(geo, blankMat);
    this.blank.frustumCulled = false;
    this.blank.castShadow = true;
    this.rodFrame.add(this.blank);

    // guides + tip top
    const guideMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.9, roughness: 0.25 });
    this.guides = [];
    for (const [s, r] of [[0.36, 0.014], [0.48, 0.011], [0.6, 0.009], [0.71, 0.007], [0.82, 0.006], [0.91, 0.005], [1.0, 0.003]]) {
      const g = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0011, 6, 14), guideMat);
      g.userData.s = s; g.userData.h = s < 1 ? r + 0.006 : 0;
      this.rodFrame.add(g);
      this.guides.push(g);
    }

    // spinning reel hanging under the seat
    this.reel = new THREE.Group();
    const reelBody = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.35, metalness: 0.6 });
    const reelSpool = new THREE.MeshStandardMaterial({ color: 0xb5402a, roughness: 0.3, metalness: 0.7 });
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.03), reelBody); stem.position.set(0, -0.03, 0);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.05, 16), reelBody); body.rotation.x = Math.PI / 2; body.position.set(0, -0.065, 0.01);
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.026, 18), reelSpool); spool.rotation.x = Math.PI / 2; spool.position.set(0, -0.065, -0.03);
    const lineOnSpool = new THREE.Mesh(new THREE.CylinderGeometry(0.0235, 0.0235, 0.018, 18), new THREE.MeshStandardMaterial({ color: 0xd8e3e0, roughness: 0.5 }));
    lineOnSpool.rotation.x = Math.PI / 2; lineOnSpool.position.set(0, -0.065, -0.03);
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0016, 6, 20, Math.PI), guideMat);
    bail.position.set(0, -0.065, -0.042); bail.rotation.set(0, 0, Math.PI / 2);
    this.reelHandle = new THREE.Group();
    this.reelHandle.position.set(-0.03, -0.065, 0.012);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.008), reelBody); arm.position.set(0, 0.022, 0);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.6 }));
    knob.rotation.z = Math.PI / 2; knob.position.set(-0.012, 0.045, 0);
    this.reelHandle.add(arm, knob);
    this.reel.add(stem, body, spool, lineOnSpool, bail, this.reelHandle);
    this.reel.position.set(0, 0, -0.30);
    this.rodFrame.add(this.reel);
    for (const m of this.reel.children) m.castShadow = true;

    // player's hand around the reel seat
    if (handGeo) {
      const handMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { vertexAO: true, skin: true, sss: 0.4, poreStrength: 0.06 });
      this.hand = new THREE.Mesh(handGeo, handMat);
      this.hand.position.set(0, 0, -0.27);
      this.hand.rotation.set(0, 0, Math.PI * 0.62);
      this.hand.castShadow = true;
      this.rodFrame.add(this.hand);
    }
    if (this.viewmodel) this.group.traverse((o) => { o.renderOrder = 1; });

    this.tipWorld = new THREE.Vector3();
    this.#rebuild();
  }

  // shape of the blank: s in [0,1] -> point in rod frame
  #point(s, out) {
    const shape = s * s * (3 - s) / 2;
    return out.set(this.bend.x * shape, this.bend.y * shape, -s * ROD_LEN + 0.5 * this.bend.lengthSq() * shape / ROD_LEN);
  }
  #radius(s) {
    if (s < 0.17) return 0.0135 - s * 0.01;
    if (s < 0.21) return 0.0105;
    return 0.0068 * (1 - (s - 0.21) / 0.79) + 0.0013;
  }

  #rebuild() {
    const pos = this.blankGeo.attributes.position.array, nrm = this.blankGeo.attributes.normal.array;
    const p = new THREE.Vector3(), p2 = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
    const ref = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= SEGS; i++) {
      const s = i / SEGS;
      this.#point(s, p);
      this.#point(Math.min(1, s + 0.01), p2);
      if (s >= 1) { this.#point(0.99, t); t.subVectors(p, t); } else t.subVectors(p2, p);
      t.normalize();
      n.crossVectors(ref, t).normalize();
      b.crossVectors(t, n).normalize();
      const r = this.#radius(s);
      for (let j = 0; j < RADIAL; j++) {
        const a = (j / RADIAL) * Math.PI * 2;
        const cx = Math.cos(a), cy = Math.sin(a);
        const k = (i * RADIAL + j) * 3;
        const nx = n.x * cx + b.x * cy, ny = n.y * cx + b.y * cy, nz = n.z * cx + b.z * cy;
        pos[k] = p.x + nx * r; pos[k + 1] = p.y + ny * r; pos[k + 2] = p.z + nz * r;
        nrm[k] = nx; nrm[k + 1] = ny; nrm[k + 2] = nz;
      }
    }
    this.blankGeo.attributes.position.needsUpdate = true;
    this.blankGeo.attributes.normal.needsUpdate = true;
    for (const g of this.guides) {
      const s = g.userData.s;
      this.#point(s, p);
      this.#point(Math.max(0, s - 0.01), p2);
      t.subVectors(p, p2).normalize();
      // guides hang below the blank
      n.crossVectors(ref, t).normalize(); b.crossVectors(t, n).normalize();
      g.position.copy(p).addScaledVector(b, -g.userData.h);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
    }
  }

  /**
   * dt, state: {tension 0..1, lineDirWorld (from tip toward hook), reeling, walking, aimWorld(optional)}
   */
  update(dt, st) {
    // where the rod points (camera space)
    const cam = this.camera;
    const base = new THREE.Vector3(0.22, 0.80, -0.56);
    if (st.lineDirWorld && st.tension > 0.02) {
      // lean the rod toward the line when it pulls
      const camQ = cam.getWorldQuaternion(new THREE.Quaternion()).invert();
      const ld = st.lineDirWorld.clone().applyQuaternion(camQ);
      base.lerp(ld.normalize().add(new THREE.Vector3(0.2, 0.9, 0)).normalize(), (st.heavy ? 0.38 : 0.25) * Math.min(1, st.tension * 2));
    }
    if (st.reeling) base.add(new THREE.Vector3(0.04, 0.12, 0.08));
    // casting flick: back over the shoulder then forward
    if (this.castAnim > 0) {
      this.castAnim = Math.max(0, this.castAnim - dt / 0.55);
      const c = 1 - this.castAnim;
      const back = c < 0.35 ? c / 0.35 : Math.max(0, 1 - (c - 0.35) / 0.25);
      const fwd = c > 0.35 ? Math.sin(Math.min(1, (c - 0.35) / 0.4) * Math.PI) : 0;
      base.add(new THREE.Vector3(0, 0.55 * back - 0.25 * fwd, 0.55 * back - 0.3 * fwd));
    }
    base.normalize();
    this.aim.lerp(base, 1 - Math.exp(-10 * dt)).normalize();
    // hand position with a little sway
    const sway = this.sway;
    const tm = performance.now() / 1000;
    sway.x = Math.sin(tm * 1.3) * 0.004 + (st.walking ? Math.sin(tm * 9) * 0.006 : 0);
    sway.y = Math.sin(tm * 1.7 + 1) * 0.003 + (st.walking ? Math.abs(Math.cos(tm * 9)) * 0.008 : 0);
    // keep the hand at the same place in the frame regardless of aspect ratio
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const H = new THREE.Vector3(0.70 * th * cam.aspect * 0.43 + sway.x, -0.80 * th * 0.43 + sway.y, -0.43);
    // orient the rod frame: -Z along aim, up roughly camera up
    const z = this.aim.clone().negate();
    const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
    const y = z.clone().cross(x).normalize();
    this.rodFrame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.rodFrame.position.copy(H).addScaledVector(this.aim, -0.27);
    // bending toward the line pull (in rod frame)
    this.bendTarget.set(0, -0.04, 0); // gravity sag
    if (st.lineDirWorld && st.tension > 0) {
      this.rodFrame.updateWorldMatrix(true, false);
      const inv = this.rodFrame.getWorldQuaternion(new THREE.Quaternion()).invert();
      const ld = st.lineDirWorld.clone().applyQuaternion(inv);
      ld.z = 0; // perpendicular component bends the blank
      if (ld.lengthSq() > 1e-6) this.bendTarget.addScaledVector(ld.normalize(), (st.heavy ? 0.95 : 0.62) * Math.pow(st.tension, 0.8));
    }
    this.bend.lerp(this.bendTarget, 1 - Math.exp(-14 * dt));
    // reel handle
    if (st.reeling) this.reelAngle -= dt * 14;
    this.reelHandle.rotation.x = this.reelAngle;
    this.#rebuild();
    // tip in world space
    this.rodFrame.updateWorldMatrix(true, false);
    this.#point(1, this.tipWorld).applyMatrix4(this.rodFrame.matrixWorld);
  }

  /**
   * Rod held in the world by a character. st: {butt (world), dir (world, butt -> tip), up (world hint),
   * tension, lineDirWorld, heavy, reeling, whip}. Bends toward the line like the viewmodel rod.
   */
  updateHeld(dt, st) {
    const z = st.dir.clone().normalize().negate();
    const x = (st.up || new THREE.Vector3(0, 1, 0)).clone().cross(z).normalize();
    const y = z.clone().cross(x).normalize();
    this.rodFrame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.rodFrame.position.copy(st.butt);
    this.bendTarget.set(0, -0.05, 0);
    if (st.lineDirWorld && st.tension > 0) {
      this.rodFrame.updateWorldMatrix(true, false);
      const inv = this.rodFrame.getWorldQuaternion(new THREE.Quaternion()).invert();
      const ld = st.lineDirWorld.clone().applyQuaternion(inv);
      ld.z = 0;
      if (ld.lengthSq() > 1e-6) this.bendTarget.addScaledVector(ld.normalize(), (st.heavy ? 0.95 : 0.62) * Math.pow(st.tension, 0.8));
    }
    if (st.whip) this.bendTarget.y += st.whip; // springy blank during a cast
    this.bend.lerp(this.bendTarget, 1 - Math.exp(-14 * dt));
    if (st.reeling) this.reelAngle -= dt * 14;
    this.reelHandle.rotation.x = this.reelAngle;
    this.#rebuild();
    this.rodFrame.updateWorldMatrix(true, false);
    this.#point(1, this.tipWorld).applyMatrix4(this.rodFrame.matrixWorld);
  }

  // world position of a point on the blank (s: 0 butt .. 1 tip)
  pointWorld(s, out = new THREE.Vector3()) {
    this.rodFrame.updateWorldMatrix(true, false);
    return this.#point(s, out).applyMatrix4(this.rodFrame.matrixWorld);
  }

  flick() { this.castAnim = 1; }
}

// ------------------------------------------------------------------------- line
export class FishingLine {
  constructor(scene, resolution) {
    this.n = 34;
    this.p = []; this.prev = [];
    for (let i = 0; i < this.n; i++) { this.p.push(new THREE.Vector3()); this.prev.push(new THREE.Vector3()); }
    this.length = 0.35;
    this.geo = new LineGeometry();
    this.positions = new Float32Array(this.n * 3);
    this.geo.setPositions(this.positions);
    this.mat = new LineMaterial({ color: 0xe9f2f0, linewidth: 1.6, worldUnits: false, transparent: true, opacity: 0.9, depthWrite: false });
    this.mat.resolution.copy(resolution);
    this.line = new Line2(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 3;
    scene.add(this.line);
    this.colliders = []; // fn(point) pushes the point out of solids
    this.endPinned = false;
    this.endMass = 1; // relative weight of the end (heavier when carrying the cap)
    this.inited = false;
  }

  reset(tip) {
    for (let i = 0; i < this.n; i++) {
      this.p[i].copy(tip).add(new THREE.Vector3(0, -(i / (this.n - 1)) * this.length, 0));
      this.prev[i].copy(this.p[i]);
    }
    this.inited = true;
  }

  // lay the line between two points with a gentle sag (used when attaching instantly)
  resetBetween(a, b) {
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      this.p[i].copy(a).lerp(b, t);
      this.p[i].y -= Math.sin(t * Math.PI) * 0.04;
      this.prev[i].copy(this.p[i]);
    }
    this.inited = true;
  }

  get end() { return this.p[this.n - 1]; }

  /** tip: world pos, endTarget: world pos when pinned, otherwise null (free hook) */
  simulate(dt, tip, endTarget) {
    if (!this.inited) this.reset(tip);
    const n = this.n, p = this.p, prev = this.prev;
    const steps = 2, h = dt / steps;
    const seg = this.length / (n - 1);
    for (let st = 0; st < steps; st++) {
      for (let i = 1; i < n; i++) {
        const v = _v.subVectors(p[i], prev[i]).multiplyScalar(0.985);
        prev[i].copy(p[i]);
        p[i].add(v).add(_v2.set(0, -9.8 * h * h, 0));
      }
      p[0].copy(tip);
      if (endTarget) p[n - 1].copy(endTarget);
      for (let it = 0; it < 22; it++) {
        for (let i = 0; i < n - 1; i++) {
          const a = p[i], b = p[i + 1];
          const d = _v.subVectors(b, a);
          const l = d.length() || 1e-6;
          if (l <= seg) continue; // rope: only resists stretching
          const diff = (l - seg) / l;
          let wa = i === 0 ? 0 : 0.5, wb = (i + 1 === n - 1) ? (endTarget ? 0 : 0.5 / this.endMass) : 0.5;
          if (wa + wb === 0) continue;
          const s = 1 / (wa + wb);
          a.addScaledVector(d, diff * wa * s);
          b.addScaledVector(d, -diff * wb * s);
        }
        for (const c of this.colliders) for (let i = 1; i < n - 1; i++) c(p[i]);
        p[0].copy(tip);
        if (endTarget) p[n - 1].copy(endTarget);
      }
    }
    for (let i = 0; i < n; i++) { this.positions[i * 3] = p[i].x; this.positions[i * 3 + 1] = p[i].y; this.positions[i * 3 + 2] = p[i].z; }
    this.geo.setPositions(this.positions);
  }

  // direction of the line leaving the rod tip / arriving at the end
  tipDir(out = new THREE.Vector3()) { return out.subVectors(this.p[3], this.p[0]).normalize(); }
  endDir(out = new THREE.Vector3()) { return out.subVectors(this.p[this.n - 4], this.p[this.n - 1]).normalize(); }
  // actual path length
  pathLength() { let L = 0; for (let i = 0; i < this.n - 1; i++) L += this.p[i].distanceTo(this.p[i + 1]); return L; }
}
