// The witness's perch: a pondside tree with one long branch over the water, the foliage around
// the seat (with a natural gap toward the argument), the player's legs, sleeves, hands and the
// binoculars. Everything is built in one "perch frame": origin at the hips on the branch, -Z toward
// the argument, +X to the player's right, the ground at y = -SEAT.y.
import * as THREE from 'three';
import { V, UP, capsule } from '../god/common.js';

export const POND = { x: 11, z: 6.5, rx: 4.6 * 1.3, rz: 4.6, y: 0.02 };
export const inWater = (x, z, margin = 0) => ((x - POND.x) / (POND.rx - margin)) ** 2 + ((z - POND.z) / (POND.rz - margin)) ** 2 < 1;
// Over the water near the north-west bank, 3 m up, about 9 m from the pickup.
export const SEAT = V(7.2, 3.12, 9.0);
export const EYE = V(0, 0.72, 0.05);
// Camera offsets from EYE: lowered = leaning back behind the leaves, raised = leaning into the gap.
export const HIDE = V(0, -0.08, 0.2);
export const PEEK = V(0, 0.03, -0.07);
const CRACK = V(-0.78, -0.13, 0);
const TRUNK = V(-2.42, -SEAT.y, 0.08);

// Seeded, so the foliage (and the view through it) is the same on every visit.
let seed = 0x7ee5;
const random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = (a, b) => a + random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// A bark tube along a smooth curve whose radius tapers from r0 to r1.
function taperedTube(points, r0, r1, segs = 18, radial = 9) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, k = r * (1 + 0.07 * Math.sin(a * 3 + i * 1.9));
      pos.push(p.x + (Math.cos(a) * N.x + Math.sin(a) * B.x) * k, p.y + (Math.cos(a) * N.y + Math.sin(a) * B.y) * k, p.z + (Math.cos(a) * N.z + Math.sin(a) * B.z) * k);
      uv.push(j / radial, t * 4);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1); // counter-clockwise from outside: the bark faces out
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function barkMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x55442f, roughness: 0.96 });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBarkUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvBarkUv = uv;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vBarkUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float ridge = sin(vBarkUv.x * 62.0 + sin(vBarkUv.y * 9.0) * 1.7) * 0.5 + 0.5;
        diffuseColor.rgb *= 0.72 + 0.38 * ridge + 0.08 * sin(vBarkUv.y * 41.0);`);
  };
  m.customProgramCacheKey = () => 'witness-bark';
  return m;
}

// A tube along a smooth curve with a radius profile [[t, r], …] (t from 0 at the start to 1 at the end).
function profiledTube(points, profile, segs = 26, radial = 14) {
  const curve = new THREE.CatmullRomCurve3(points), pos = [], idx = [], uv = [];
  const radius = (t) => { let i = 1; while (i < profile.length - 1 && profile[i][0] < t) i++; const [t0, r0] = profile[i - 1], [t1, r1] = profile[i]; const u = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1); return r0 + (r1 - r0) * u * u * (3 - 2 * u); };
  // frames that do not twist: keep "side" close to the leg's own left-right axis
  let side = V(1, 0, 0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), T = curve.getTangentAt(t);
    const N = side.clone().addScaledVector(T, -side.dot(T)).normalize(), Bn = T.clone().cross(N).normalize(); side = N;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, r = radius(t) * (1 + 0.035 * Math.sin(a * 2 + t * 9)); // a little cloth unevenness
      pos.push(p.x + (Math.cos(a) * N.x + Math.sin(a) * Bn.x) * r, p.y + (Math.cos(a) * N.y + Math.sin(a) * Bn.y) * r, p.z + (Math.cos(a) * N.z + Math.sin(a) * Bn.z) * r);
      uv.push(j / radial * 2, t * 4);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Denim: a fine diagonal twill with faded patches, drawn once on a small canvas.
function denimTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#44557a'; g.fillRect(0, 0, 128, 128);
  for (let i = -128; i < 128; i += 3) { g.strokeStyle = i % 6 ? 'rgba(20,30,55,0.35)' : 'rgba(170,185,215,0.18)'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(190,205,230,${(0.02 + random() * 0.05).toFixed(3)})`; g.beginPath(); g.ellipse(random() * 128, random() * 128, 6 + random() * 18, 3 + random() * 8, random() * 3, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// A sneaker built along +Z (toes), origin at the ankle: sole, upper, toe cap, collar and laces.
function makeSneaker(m) {
  const g = new THREE.Group();
  const part = (geo, mat, p, s) => { const o = new THREE.Mesh(geo, mat); o.position.copy(p); if (s) o.scale.copy(s); o.castShadow = true; g.add(o); return o; };
  const along = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14).rotateX(Math.PI / 2);
  part(along(0.05, 0.2), m.sole, V(0, -0.068, 0.07), V(1.08, 0.38, 1));
  part(along(0.046, 0.17), m.upper, V(0, -0.035, 0.065), V(0.98, 0.78, 1));
  part(new THREE.SphereGeometry(0.046, 16, 10), m.upper, V(0, -0.045, 0.165), V(0.98, 0.62, 0.9));
  part(new THREE.TorusGeometry(0.04, 0.009, 8, 18).rotateX(Math.PI / 2), m.upper, V(0, 0.0, -0.005), V(1, 1, 1.15));
  for (let i = 0; i < 3; i++) part(new THREE.BoxGeometry(0.05, 0.006, 0.008), m.lace, V(0, 0.002 - i * 0.007, 0.045 + i * 0.03));
  return g;
}

// One continuous sleeve from the wrist through the elbow to a shoulder out of view. The vertex
// buffer is allocated once and refilled each frame along a smooth curve, so the elbow bends
// instead of showing a joint. A hoodie cuff thickens it just above the wrist.
class Sleeve {
  constructor(material, segs = 18, radial = 12) {
    Object.assign(this, { segs, radial });
    const n = (segs + 1) * (radial + 1), idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geometry, material); this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.curve = new THREE.CatmullRomCurve3([V(), V(), V()], false, 'centripetal');
  }
  static radius(t) { // wrist → cuff → forearm → elbow → upper arm
    if (t < 0.08) return 0.03 + (t / 0.08) * 0.016;
    if (t < 0.16) return 0.046 - ((t - 0.08) / 0.08) * 0.008;
    return t < 0.5 ? 0.038 + (t - 0.16) * 0.02 : 0.045 + (t - 0.5) * 0.02;
  }
  update(wrist, elbow, shoulder, side) {
    this.curve.points[0].copy(wrist); this.curve.points[1].copy(elbow); this.curve.points[2].copy(shoulder);
    const pos = this.geometry.attributes.position, { segs, radial } = this;
    let ref = side.clone();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, p = this.curve.getPoint(t), T = this.curve.getTangent(t);
      const N = ref.addScaledVector(T, -ref.dot(T)).normalize(), B = T.clone().cross(N);
      const r = Sleeve.radius(t);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
        pos.setXYZ(i * (radial + 1) + j, p.x + N.x * c + B.x * s, p.y + N.y * c + B.y * s, p.z + N.z * c + B.z * s);
      }
    }
    pos.needsUpdate = true; this.geometry.computeVertexNormals(); this.geometry.computeBoundingSphere();
  }
}

// Rubber-armoured roof-prism binoculars. Barrels run along -Z (the objectives face -Z).
export function makeBinoculars() {
  const g = new THREE.Group(); g.name = 'binoculars';
  const rubber = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.72 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x5c6166, roughness: 0.35, metalness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1d3a4c, roughness: 0.05, metalness: 0.2, clearcoat: 1, envMapIntensity: 2 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.034, 0.13, 20).rotateX(Math.PI / 2), rubber);
    barrel.position.set(0.039 * s, 0, -0.01); g.add(barrel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.005, 8, 24), metal);
    ring.position.set(0.039 * s, 0, -0.076); g.add(ring);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.029, 24).rotateY(Math.PI), glass);
    lens.position.set(0.039 * s, 0, -0.072); g.add(lens);
    const eyecup = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.022, 0.035, 16).rotateX(Math.PI / 2), rubber);
    eyecup.position.set(0.035 * s, 0.004, 0.07); g.add(eyecup);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.08), metal); bridge.position.set(0, 0.012, 0.012); g.add(bridge);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.026, 14).rotateZ(Math.PI / 2), rubber); wheel.position.set(0, 0.027, 0.03); g.add(wheel);
  const loop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.07, 0, 0.05), V(-0.08, -0.08, 0.08), V(0, -0.13, 0.1), V(0.08, -0.08, 0.08), V(0.07, 0, 0.05)]), 20, 0.004, 5), strap);
  g.add(loop);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

// A hand closed around a cylinder that runs along the hand's local Z axis: four finger arcs over
// the top, the palm on the +X side, the thumb underneath. Mirror with scale.x = -1 for the left.
function makeHand(skin, sleeve) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0115 - i * 0.0008, 7, 14, Math.PI * (1.05 - i * 0.04)), skin);
    f.rotation.z = -0.25; f.position.z = -0.032 + i * 0.021; f.castShadow = true; g.add(f);
  }
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
  palm.scale.set(0.026, 0.05, 0.055); palm.position.set(0.054, -0.01, 0.005); palm.castShadow = true; g.add(palm);
  capsule(g, V(0.05, -0.04, 0.035), V(0.012, -0.056, -0.022), 0.012, skin);
  g.userData.wrist = V(0.06, -0.025, 0.045); // inside the heel of the palm: the sleeve starts here
  return g;
}

export class Perch {
  constructor(scene, { look, leafMaterial, leafGeometry, quality }) {
    seed = 0x7ee5;
    this.frame = new THREE.Group(); this.frame.name = 'witnessPerch';
    this.frame.position.copy(SEAT);
    const f = look.clone().sub(SEAT).setY(0).normalize();
    this.frame.rotation.y = Math.atan2(-f.x, -f.z);
    scene.add(this.frame);
    this.frame.updateMatrixWorld(true);
    const bark = barkMaterial();
    this.bark = bark;

    // ---- trunk, the inner branch, the hinge where it will crack, and everything beyond it
    const trunk = new THREE.Mesh(taperedTube([TRUNK, TRUNK.clone().add(V(0.05, 2.2, 0)), TRUNK.clone().add(V(-0.1, 5.2, 0.15)), TRUNK.clone().add(V(0.15, 8.4, 0.05))], 0.34, 0.12, 20, 12), bark);
    const inner = new THREE.Mesh(taperedTube([V(-2.36, -0.44, 0.08), V(-1.65, -0.27, 0.04), CRACK.clone()], 0.15, 0.115), bark);
    this.pivot = new THREE.Group(); this.pivot.position.copy(CRACK); this.frame.add(this.pivot);
    this.seat = new THREE.Group(); this.seat.position.copy(CRACK).negate(); this.pivot.add(this.seat);
    const outer = new THREE.Mesh(taperedTube([CRACK.clone(), V(-0.1, -0.115, 0), V(0.65, -0.06, -0.02), V(1.55, 0.07, -0.08)], 0.115, 0.045), bark);
    const limb = new THREE.Mesh(taperedTube([V(-0.48, -0.12, 0), V(-0.17, -0.135, -0.5), V(0.0, -0.13, -0.95), V(0.22, -0.07, -1.42)], 0.075, 0.032), bark);
    // the splintered stub the break leaves behind (shown after the crack)
    this.stub = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.16, 7).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9a77a, roughness: 0.9 }));
    this.stub.position.copy(CRACK).add(V(0.04, 0, 0)); this.stub.visible = false;
    for (const m of [trunk, inner, outer, limb]) { m.castShadow = true; m.receiveShadow = true; }
    this.frame.add(trunk, inner, this.stub);
    this.seat.add(outer, limb);

    // ---- foliage: leaf clusters on twigs around the seat, a gap toward the argument, and the crown
    this.eyeRaised = EYE.clone().add(PEEK);
    const toMen = this.frame.worldToLocal(look.clone()).sub(this.eyeRaised).normalize();
    this.gapYaw = Math.atan2(-toMen.x, -toMen.z); this.gapPitch = Math.asin(toMen.y);
    const leafSpots = [], limbs = [];
    // Is a leaf (centre p, card scale s) clear of the view toward the argument and of your lap?
    // Checked from both eye positions, with the leaf's own angular size, so no card pokes into the gap.
    const eyeHidden = EYE.clone().add(HIDE);
    const blocks = (p, s) => [this.eyeRaised, eyeHidden].some((eye) => {
      const d = p.clone().sub(eye), dist = d.length(); d.divideScalar(dist);
      const ar = (0.6 * s) / dist;
      const yaw = wrap(Math.atan2(-d.x, -d.z) - this.gapYaw), pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) - this.gapPitch;
      if ((yaw / (0.36 + ar)) ** 2 + (pitch / (0.2 + ar)) ** 2 < 1) return true;
      return pitch < -0.18 + ar && Math.abs(yaw) < 0.62 + ar && dist < 2.2; // legs, hands and binoculars stay visible
    });
    // nothing right under the seat either: that is the way down
    const leaf = (p, s) => { if (!blocks(p, s) && !(p.y < 0.3 && Math.hypot(p.x, p.z) < 1.5)) leafSpots.push([p, s]); };
    // side limbs grow out of the trunk and the branch; leaves gather toward their ends
    for (let tries = 0; limbs.length < 15 && tries < 600; tries++) {
      const fromTrunk = limbs.length < 5;
      const base = fromTrunk ? TRUNK.clone().add(V(0.12, SEAT.y + rand(-0.9, 1.9), 0)) : V(rand(-1.9, 1.1), -0.11, 0);
      const dir = V(rand(-1, 1), rand(0.15, 1.1), rand(-1, 1)).normalize();
      if (fromTrunk) dir.x = Math.abs(dir.x) + 0.2;
      const len = rand(1.0, 2.2), end = base.clone().addScaledVector(dir.normalize(), len);
      if (blocks(end, 0.8) || blocks(base.clone().lerp(end, 0.5), 0.3)) continue;
      const mid = base.clone().lerp(end, 0.5).add(V(0, -0.12 * len, 0));
      limbs.push([base, mid, end]);
      for (const t of [0.55, 0.8, 1]) {
        const c = new THREE.CatmullRomCurve3([base, mid, end]).getPointAt(t);
        for (let i = 0; i < 9; i++) leaf(c.clone().add(V(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).multiplyScalar(0.3)), rand(0.3, 0.5));
      }
    }
    // leafy sprays that frame the gap: above it and to both sides, never below it (that's your lap)
    for (let i = 0, made = 0; made < 12 && i < 400; i++) {
      const a = rand(-0.35, Math.PI + 0.35), k = rand(1.25, 1.7), dist = rand(1.3, 2.4);
      const dir = V(0, 0, -1).applyEuler(new THREE.Euler(this.gapPitch + Math.sin(a) * 0.2 * k, this.gapYaw + Math.cos(a) * 0.36 * k, 0, 'YXZ'));
      const c = this.eyeRaised.clone().addScaledVector(dir, dist);
      const base = c.x < -0.6 ? TRUNK.clone().add(V(0.12, SEAT.y + THREE.MathUtils.clamp(c.y, -0.8, 1.6), 0)) : V(THREE.MathUtils.clamp(c.x, -0.7, 1.1), -0.1, 0);
      const mid = base.clone().lerp(c, 0.5).add(V(0, 0.15, 0));
      if (blocks(mid, 0.2) || base.distanceTo(c) > 2.6) continue;
      made++; // no visible twig: up close they read as sticks across the view
      for (let j = 0; j < 12; j++) leaf(c.clone().add(V(rand(-1, 1), rand(-0.5, 0.7), rand(-1, 1)).multiplyScalar(0.28)), rand(0.28, 0.45));
    }
    // the crown above
    const crownC = TRUNK.clone().add(V(0.35, 6.1, 0.1));
    for (let i = 0; i < 420; i++) {
      const u = rand(-1, 1), a = rand(0, Math.PI * 2), rr = 2.8 * Math.cbrt(rand(0.35, 1)), s = Math.sqrt(1 - u * u);
      leaf(crownC.clone().add(V(Math.cos(a) * s * rr * 1.15, u * rr * 0.72, Math.sin(a) * s * rr * 1.15)), rand(0.8, 1.3));
    }
    const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, leafSpots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    leafSpots.forEach(([p, sc], i) => { q.setFromEuler(e.set(rand(0, 3.14), rand(0, 3.14), rand(0, 3.14))); m.compose(p, q, s.set(sc, sc, sc)); leaves.setMatrixAt(i, m); });
    leaves.castShadow = true; leaves.frustumCulled = false;
    this.frame.add(leaves); this.leaves = leaves;
    for (const [a, b, c, thin] of limbs) { const pts = [a, b, c]; const l = new THREE.Mesh(taperedTube(pts, thin ? 0.026 : 0.045, thin ? 0.007 : 0.012, 10, 6), bark); l.castShadow = true; (pts[0].x > CRACK.x && pts[0].y < 0 ? this.seat : this.frame).add(l); }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshStandardMaterial({ color: 0x223817, roughness: 1 }));
    core.scale.set(2.2, 1.5, 2.2); core.position.copy(crownC).add(V(-0.2, 0.4, 0)); core.castShadow = true; this.frame.add(core);

    // ---- the player: legs along the forked limb, sleeves, hands, binoculars
    const jeans = new THREE.MeshStandardMaterial({ map: denimTexture(), color: 0xc8d0e0, roughness: 0.95 });
    const shoe = { sole: new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 0.8 }), upper: new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.75 }),
      lace: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.8 }), sock: new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.95 }) };
    this.skin = new THREE.MeshStandardMaterial({ color: 0xc9967a, roughness: 0.6 });
    this.sleeve = new THREE.MeshStandardMaterial({ color: 0x4a5536, roughness: 0.95 });
    // Two different poses: the left leg stretched along the fork, heel on it, toes up; the right
    // knee drawn up a little with that foot hanging beside the fork. Thigh, knee, calf and ankle
    // taper like a real leg in loose jeans; each leg swings gently from the hip.
    this.legs = new THREE.Group(); this.seat.add(this.legs);
    this.legParts = [];
    for (const [sd, knee, ankle, toes, swing] of [
      [-1, V(-0.135, 0.135, -0.47), V(-0.07, 0.0, -0.95), V(-0.12, 0.3, -1), 0.008],
      [1, V(0.155, 0.25, -0.37), V(0.05, -0.03, -0.74), V(0.22, 0.05, -1), 0.03],
    ]) {
      const hip = V(0.1 * sd, 0.05, 0.03), leg = new THREE.Group(); leg.position.copy(hip); this.legs.add(leg);
      const k = knee.clone().sub(hip), a = ankle.clone().sub(hip);
      const thighMid = k.clone().multiplyScalar(0.5).add(V(0.012 * sd, 0.012, 0)), calf = k.clone().lerp(a, 0.42).add(V(0, -0.012, 0.012));
      const mesh = new THREE.Mesh(profiledTube([V(0, 0, 0), thighMid, k, calf, a], [[0, 0.084], [0.2, 0.078], [0.44, 0.06], [0.5, 0.058], [0.62, 0.06], [0.84, 0.052], [1, 0.05]]), jeans);
      mesh.castShadow = true; leg.add(mesh);
      // a rolled hem and a bit of sock, then the sneaker
      const shin = a.clone().sub(k).normalize();
      const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.06, 0.045, 16), jeans); hem.position.copy(a).addScaledVector(shin, -0.03); hem.quaternion.setFromUnitVectors(UP, shin); leg.add(hem);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.05, 12), shoe.sock); sock.position.copy(a).addScaledVector(shin, 0.012); sock.quaternion.setFromUnitVectors(UP, shin); leg.add(sock);
      const sneaker = makeSneaker(shoe), fwd = toes.clone().normalize(), up = shin.clone().negate().addScaledVector(fwd, shin.dot(fwd)).normalize();
      sneaker.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(fwd).normalize(), up, fwd));
      sneaker.position.copy(a).addScaledVector(shin, 0.03); leg.add(sneaker);
      this.legParts.push({ leg, swing, side: sd, ankle: a.clone() });
    }
    // hips and a hoodie torso below the eyes: look straight down and you see your own lap and belly
    const hips = capsule(this.legs, V(-0.11, 0.07, 0.05), V(0.11, 0.07, 0.05), 0.105, jeans); hips.scale.set(1, 0.9, 1.1);
    const torso = capsule(this.legs, V(0, 0.13, 0.12), V(0, 0.34, 0.17), 0.145, this.sleeve); torso.scale.set(1.2, 1, 0.82);
    this.binoculars = makeBinoculars();
    scene.add(this.binoculars);
    this.hands = [1, -1].map((side) => {
      const h = makeHand(this.skin, this.sleeve);
      h.scale.x = side; h.userData.side = side; scene.add(h);
      // the whole sleeve, wrist to a shoulder behind the camera: the arm always leaves the frame
      const sleeve = new Sleeve(this.sleeve), arm = sleeve.mesh; scene.add(arm);
      return { group: h, arm, sleeve, side, pos: V(), quat: new THREE.Quaternion(), ready: false };
    });
    this.reset();
  }

  reset() {
    this.bend = 0; this.bendTarget = 0; this.bendVel = 0; this.broken = false; this.time = 0;
    this.pivot.rotation.set(0, 0, 0); this.pivot.visible = true; this.stub.visible = false;
    this.legs.visible = true;
    this.handMode = 'hold';
    this.loose = null; // the falling binoculars
    this.sinking = false; // the ending places them in front of the camera
    this.handsVisible = true;
    this.binoculars.visible = true;
    for (const h of this.hands) { h.group.visible = true; h.arm.visible = true; h.ready = false; h.ready2 = false; }
  }

  // ------------------------------------------------------------------ branch
  crack() {
    this.broken = true; this.stub.visible = true;
    this.bendTarget = 0.34; this.bendVel = 1.1; // a sudden drop, but not a camera jolt
  }
  snap() { this.bendTarget = 1.15; this.bendVel -= 1.5; }
  update(dt, reduced) {
    this.time += dt;
    // a light spring: the bend overshoots a little when the load changes suddenly
    const k = this.broken ? 22 : 60, c = this.broken ? 7 : 11;
    this.bendVel += ((this.bendTarget - this.bend) * k - this.bendVel * c) * dt;
    this.bend += this.bendVel * dt;
    const sway = reduced ? 0 : Math.sin(this.time * 0.83) * 0.0045 + Math.sin(this.time * 1.91 + 1.2) * 0.002;
    this.pivot.rotation.z = -this.bend + sway;
    this.pivot.rotation.x = reduced ? 0 : Math.sin(this.time * 0.61 + 0.4) * 0.003;
    for (const { leg, swing, side } of this.legParts) {
      leg.rotation.x = reduced ? 0 : Math.sin(this.time * 1.25 + side) * swing;
      leg.rotation.z = reduced ? 0 : Math.sin(this.time * 0.9 + 1.3 * side) * swing * 0.5;
    }
    this.frame.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ the player's body
  /** world-space eye for a raise amount (0 lowered behind the leaves, 1 leaning into the gap) */
  eyeWorld(raise, extra = null, out = V()) {
    out.copy(HIDE).lerp(PEEK, raise).add(EYE);
    if (extra) out.add(extra);
    return this.seat.localToWorld(out);
  }

  dropBinoculars(velocity) {
    this.loose = { vel: velocity.clone(), spin: V(rand(-4, 4), rand(-3, 3), rand(-5, 5)) };
  }

  /** mode: 'hold' (binoculars between lap and eyes), 'reach' (grabbing the branch), 'flail' (falling) */
  updateBody(dt, camera, raise, body = null) {
    // the torso turns and leans with the look; arms and the lowered binoculars go with it
    const torso = (p) => (body ? p.applyAxisAngle(UP, body.yaw * 0.6).add(V(body.x, body.y, body.z * 0.6)) : p);
    const B = this.binoculars;
    if (this.sinking) {
      // the ending moves them; nothing else to do here
    } else if (this.loose) {
      const L = this.loose;
      L.vel.y -= 9.8 * dt; B.position.addScaledVector(L.vel, dt);
      B.rotation.x += L.spin.x * dt; B.rotation.y += L.spin.y * dt; B.rotation.z += L.spin.z * dt;
      if (B.position.y < POND.y) B.visible = false;
    } else if (B.visible) {
      // lowered: held at the chest, objectives tipped down. Raised: at the eyes.
      const low = this.seat.localToWorld(torso(V(-0.01, 0.25, -0.17)));
      const lowQ = this.seat.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.78, 0.05 + (body ? body.yaw * 0.6 : 0), 0.04)));
      const high = camera.localToWorld(V(0, -0.028, -0.085));
      const e = raise * raise * (3 - 2 * raise);
      B.position.copy(low).lerp(high, e);
      B.quaternion.copy(lowQ).slerp(camera.quaternion, e);
    }
    B.updateMatrixWorld(true);
    const seatQ = this.seat.getWorldQuaternion(new THREE.Quaternion());
    for (const h of this.hands) {
      let p, q;
      if (this.handMode === 'hold') {
        p = B.localToWorld(V(0.039 * h.side, 0, 0));
        q = B.quaternion.clone();
      } else if (this.handMode === 'reach') {
        // clutching the branch either side of the hips
        p = this.seat.localToWorld(V(0.3 * h.side, -0.02, -0.07));
        q = seatQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)));
      } else {
        // falling: both hands up toward the branch that is getting away
        p = camera.localToWorld(V(0.17 * h.side, 0.1, -0.55));
        q = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, -0.5 * h.side)));
      }
      const k = !h.ready || this.handMode === 'hold' ? 1 : 1 - Math.exp(-14 * dt);
      h.pos.lerp(p, k); h.quat.slerp(q, k); h.ready = true;
      h.group.position.copy(h.pos); h.group.quaternion.copy(h.quat); h.group.updateMatrixWorld(true);
      // the sleeve runs from the wrist back to an elbow beside the body
      const wrist = h.group.localToWorld(h.group.userData.wrist.clone());
      const elbow = this.handMode === 'flail' ? camera.localToWorld(V(0.3 * h.side, -0.24, -0.16))
        : this.handMode === 'reach' ? this.seat.localToWorld(torso(V(0.33 * h.side, 0.24, 0.02)))
        : this.seat.localToWorld(torso(V(0.21 * h.side, 0.19 + 0.3 * raise, -0.05 - 0.06 * raise)));
      // the shoulder sits beside and just behind the eyes; while falling it is wherever the camera is
      const shoulder = this.handMode === 'flail' ? camera.localToWorld(V(0.21 * h.side, -0.3, 0.14)) : camera.localToWorld(V(0.2 * h.side, -0.26, 0.12)).lerp(this.seat.localToWorld(torso(V(0.2 * h.side, 0.5, 0.2))), this.handMode === 'reach' ? 0.6 : 0);
      // elbows and shoulders follow as smoothly as the hands, so a change of pose never snaps
      if (!h.elbowPos || !h.ready2) { h.elbowPos = elbow.clone(); h.shoulderPos = shoulder.clone(); h.ready2 = true; }
      const ke = this.handMode === 'hold' ? 1 : 1 - Math.exp(-10 * dt);
      elbow.copy(h.elbowPos.lerp(elbow, ke)); shoulder.copy(h.shoulderPos.lerp(shoulder, ke));
      h.sleeve.update(wrist, elbow, shoulder, V(1, 0, 0).applyQuaternion(camera.quaternion));
    }
    // nothing of the body should sit in front of the lenses while you look through them
    const through = this.handMode === 'hold' && raise > 0.82 && !this.loose;
    for (const h of this.hands) { h.group.visible = this.handsVisible && !through; h.arm.visible = this.handsVisible && !through; }
    if (!this.loose && !this.sinking) B.visible = !through;
  }
}
