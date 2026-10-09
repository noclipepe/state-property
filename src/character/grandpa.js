// Runtime construction of the baked grandpa: skeleton, skinned meshes, eyes, lids,
// mouth interior and a small face rig (jaw, mouth corners, brows, cheeks, lids, gaze).
import * as THREE from 'three';
import { loadPack } from '../util/pack.js';
import { patchMaterial } from '../scene/shading.js';

const D2R = Math.PI / 180;

export async function loadGrandpa(onProgress) {
  const pack = await loadPack(new URL('../../assets/meshes/grandpa', import.meta.url).href, onProgress);
  return new Grandpa(pack);
}

// The standing fisherman (driver POV mode): same rig layout, solid clothes, brown eyes, a cap.
export async function loadFisherman(onProgress) {
  const pack = await loadPack(new URL('../../assets/meshes/fisherman', import.meta.url).href, onProgress);
  return new Grandpa(pack, {
    name: 'fisherman',
    matFor: { torso: 'cloth', armL: 'skin', armR: 'skin', head: 'skin', brows: 'hair', hair: 'hair', cap: 'cloth' },
    plaid: false,
    iris: ['vec3(0.10, 0.06, 0.035)', 'vec3(0.24, 0.14, 0.07)'],
    lidColor: [0.36, 0.23, 0.17],
    cavity: [0.017, 0.014, 0.018, 0.08],
  });
}

export class Grandpa {
  /** opts: {name, matFor, plaid, iris: [inner, outer] GLSL colours, lidColor} (defaults: the grandpa) */
  constructor({ header, geos }, opts = {}) {
    this.opts = opts;
    this.header = header;
    this.group = new THREE.Group();
    this.group.name = opts.name || 'grandpa';
    this.headScale = header.headScale ?? 1.07;
    // --- bones
    this.bones = {};
    const list = header.bones.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p);
      bone.quaternion.fromArray(b.q);
      this.bones[b.name] = bone;
      return bone;
    });
    header.bones.forEach((b, i) => {
      if (b.parent) this.bones[b.parent].add(list[i]);
      else this.group.add(list[i]);
    });
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(list);
    this.bind = {};
    this.bindPos = {};
    for (const b of list) { this.bind[b.name] = b.quaternion.clone(); this.bindPos[b.name] = b.position.clone(); }

    // --- materials
    this.mats = {
      skin: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0 }),
        { vertexAO: true, skin: true, sss: 0.35 }),
      cloth: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
        { vertexAO: true, plaid: opts.plaid ?? true, sss: 0.15 }),
      hair: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
        { vertexAO: true, hair: true, sss: 0.3, aoStrength: 0.6 }),
      fringe: patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 }),
        { vertexAO: true, hair: true, hairEdge: true, sss: 0.3, aoStrength: 0.0 }),
    };
    const matFor = opts.matFor || { torso: 'cloth', armL: 'skin', armR: 'skin', head: 'skin', mustache: 'hair', brows: 'hair', hair: 'fringe' };
    this.meshes = {};
    const ident = new THREE.Matrix4();
    for (const [name, geo] of Object.entries(geos)) {
      const m = new THREE.SkinnedMesh(geo, this.mats[matFor[name] || 'skin']);
      m.name = name;
      m.bind(this.skeleton, ident);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      this.meshes[name] = m;
    }
    for (const n of ['hair', 'brows', 'mustache']) if (this.meshes[n]) this.meshes[n].castShadow = false;

    this.#buildEyes();
    this.#buildMouth();

    this.face = { jaw: 0, smile: 0, frown: 0, browUp: 0, browAngry: 0, browSad: 0, squint: 0, blink: 0, sneer: 0, pucker: 0 };
    this.gazeTarget = new THREE.Vector3(0, 1.6, 2);
    this.gazeWeight = 1;
    this._eyeYaw = 0; this._eyePitch = 0;
  }

  #buildEyes() {
    const E = this.header.eye;
    const iris = this.opts.iris || ['vec3(0.16, 0.30, 0.42)', 'vec3(0.42, 0.58, 0.66)'];
    const lc = this.opts.lidColor || [0.80, 0.52, 0.47];
    const eyeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, color: 0xffffff });
    eyeMat.customProgramCacheKey = () => 'eye:' + iris.join(); // per-character iris colours
    eyeMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vEyeP;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 ep = normalize(vEyeP);
          float th = acos(clamp(ep.z, -1.0, 1.0));
          float ang = atan(ep.y, ep.x);
          vec3 sclera = vec3(0.80, 0.74, 0.70);
          sclera = mix(sclera, vec3(0.75, 0.42, 0.40), smoothstep(0.7, 1.4, th) * 0.5);
          float fib = 0.5 + 0.5 * sin(ang * 40.0 + sin(ang * 13.0) * 2.0);
          vec3 iris = mix(${iris[0]}, ${iris[1]}, smoothstep(0.08, 0.40, th) * (0.6 + 0.4 * fib));
          iris = mix(iris, vec3(0.05, 0.09, 0.12), smoothstep(0.36, 0.44, th));
          vec3 col = mix(iris, sclera, smoothstep(0.43, 0.47, th));
          col = mix(vec3(0.015), col, smoothstep(0.15, 0.19, th));
          diffuseColor.rgb = col;`);
    };
    this.eyes = {};
    for (const s of ['L', 'R']) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(E.r, 32, 24), eyeMat);
      eye.castShadow = false; eye.receiveShadow = true;
      this.bones['eye' + s].add(eye);
      this.eyes[s] = eye;
    }
    // eyelids: lathe shells with a rounded rim
    const lidMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { vertexAO: true, skin: true, sss: 0.55, poreStrength: 0.05 });
    const mkLid = (upper) => {
      const pts = [];
      const r0 = E.r + 0.0010, r1 = E.r + 0.0001;
      const edge = upper ? 73 : 107; // polar angle (deg) of the rim at rest
      const steps = 14;
      if (upper) {
        for (let i = 0; i <= steps; i++) { const t = (i / steps) * edge * D2R; pts.push(new THREE.Vector2(Math.sin(t) * r0, Math.cos(t) * r0)); }
        for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI; const t = edge * D2R; const rr = (r0 + r1) / 2 + Math.cos(a) * (r0 - r1) / 2; const tt = t + Math.sin(a) * 0.05; pts.push(new THREE.Vector2(Math.sin(tt) * rr, Math.cos(tt) * rr)); }
        for (let i = steps; i >= 0; i--) { const t = (i / steps) * edge * D2R; pts.push(new THREE.Vector2(Math.sin(t) * r1, Math.cos(t) * r1)); }
      } else {
        for (let i = steps; i >= 0; i--) { const t = Math.PI - (i / steps) * (180 - edge) * D2R; pts.push(new THREE.Vector2(Math.sin(t) * r0, Math.cos(t) * r0)); }
        for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI; const t = edge * D2R; const rr = (r0 + r1) / 2 + Math.cos(a) * (r0 - r1) / 2; const tt = t - Math.sin(a) * 0.05; pts.push(new THREE.Vector2(Math.sin(tt) * rr, Math.cos(tt) * rr)); }
        for (let i = 0; i <= steps; i++) { const t = Math.PI - (i / steps) * (180 - edge) * D2R; pts.push(new THREE.Vector2(Math.sin(t) * r1, Math.cos(t) * r1)); }
      }
      // lathe around Y but only the front half (azimuth facing +Z)
      const g = new THREE.LatheGeometry(pts, 28, -Math.PI * 0.62, Math.PI * 1.24);
      // lathe phi=0 faces +Z already (x = sin(phi), z = cos(phi))
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 4);
      const pos = g.attributes.position;
      for (let i = 0; i < n; i++) {
        const y = pos.getY(i);
        const rim = upper ? THREE.MathUtils.smoothstep(-y, -0.0045, -0.0025) : THREE.MathUtils.smoothstep(y, -0.006, -0.0040);
        col[i * 4] = lc[0] - rim * lc[0] * 0.56; col[i * 4 + 1] = lc[1] - rim * lc[1] * 0.6; col[i * 4 + 2] = lc[2] - rim * lc[2] * 0.6; col[i * 4 + 3] = 1 - rim * 0.4;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      const m = new THREE.Mesh(g, lidMat);
      m.castShadow = false; m.receiveShadow = true;
      return m;
    };
    this.lids = {};
    for (const s of ['L', 'R']) {
      const up = mkLid(true), lo = mkLid(false);
      this.bones['lidUp' + s].add(up);
      this.bones['lidLo' + s].add(lo);
      this.lids[s] = { up, lo };
    }
  }

  #buildMouth() {
    const head = this.bones.head, jaw = this.bones.jaw;
    const jp = this.bindPos.jaw; // jaw origin in head-local space
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a0f0f, roughness: 0.6 });
    const cav = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), dark);
    const cs = this.opts.cavity || [0.024, 0.016, 0.02, 0.079]; // radii + depth of the mouth interior
    cav.scale.set(cs[0], cs[1], cs[2]);
    cav.position.set(0, 0.014, cs[3]);
    head.add(cav);
    const teethMat = new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 0.35 });
    const mkTeeth = () => {
      const g = new THREE.TorusGeometry(0.017, 0.0036, 6, 16, Math.PI * 0.42);
      g.rotateZ(Math.PI * 0.29);
      g.rotateX(Math.PI / 2);
      g.scale(1, 1.25, 0.9);
      return new THREE.Mesh(g, teethMat);
    };
    const up = mkTeeth();
    up.position.set(0, 0.0205, 0.0745);
    head.add(up);
    const lo = mkTeeth();
    lo.position.set(0 - jp.x, 0.0105 - jp.y, 0.0725 - jp.z);
    jaw.add(lo);
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshStandardMaterial({ color: 0x8a3a3a, roughness: 0.5 }));
    tongue.scale.set(0.017, 0.006, 0.022);
    tongue.position.set(0 - jp.x, 0.006 - jp.y, 0.072 - jp.z);
    jaw.add(tongue);
    for (const m of [cav, up, lo, tongue]) { m.castShadow = false; m.receiveShadow = false; }
  }

  // ------------------------------------------------------------- face update
  resetPose() {
    for (const [n, b] of Object.entries(this.bones)) { b.quaternion.copy(this.bind[n]); b.position.copy(this.bindPos[n]); }
    this.bones.head.scale.setScalar(this.headScale);
  }

  applyFace(dt) {
    const f = this.face, B = this.bones, P = this.bindPos, Q = this.bind;
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    // jaw
    e.set(f.jaw * 0.32, 0, 0);
    B.jaw.quaternion.copy(Q.jaw).multiply(q.setFromEuler(e));
    B.jaw.position.copy(P.jaw).add(new THREE.Vector3(0, 0, -0.003 * f.jaw));
    // mouth corners
    for (const [s, sx] of [['L', 1], ['R', -1]]) {
      const b = B['mouth' + s];
      b.position.copy(P['mouth' + s]).add(new THREE.Vector3(
        sx * (0.0025 * f.smile - 0.003 * f.pucker + 0.001 * f.frown),
        0.0028 * f.smile - 0.0032 * f.frown - 0.004 * f.jaw + 0.0006 * f.sneer,
        -0.002 * f.smile + 0.0015 * f.pucker));
      // brows
      const bi = B['browIn' + s], bo = B['browOut' + s];
      bi.position.copy(P['browIn' + s]).add(new THREE.Vector3(-sx * 0.0035 * f.browAngry, 0.0045 * f.browUp - 0.0062 * f.browAngry + 0.0035 * f.browSad, 0.0022 * f.browAngry));
      bo.position.copy(P['browOut' + s]).add(new THREE.Vector3(0, 0.0038 * f.browUp - 0.0012 * f.browAngry - 0.0022 * f.browSad, 0.0006 * f.browAngry));
      const ch = B['cheek' + s];
      ch.position.copy(P['cheek' + s]).add(new THREE.Vector3(0, 0.0032 * f.squint + 0.0022 * f.smile + 0.0012 * f.sneer, 0.0012 * f.squint));
    }
    // eyes: aim at gaze target (in world) with limits
    const head = B.head;
    head.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
    const t = this.gazeTarget.clone().applyMatrix4(inv);
    const ec = new THREE.Vector3(0, this.header.eye.y, this.header.eye.z);
    const d = t.sub(ec);
    let yaw = Math.atan2(d.x, d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    yaw = THREE.MathUtils.clamp(yaw, -0.6, 0.6) * this.gazeWeight;
    pitch = THREE.MathUtils.clamp(pitch, -0.4, 0.35) * this.gazeWeight;
    const k = 1 - Math.exp(-dt * 25);
    this._eyeYaw += (yaw - this._eyeYaw) * k;
    this._eyePitch += (pitch - this._eyePitch) * k;
    for (const s of ['L', 'R']) {
      e.set(-this._eyePitch, this._eyeYaw, 0, 'YXZ');
      B['eye' + s].quaternion.copy(Q['eye' + s]).multiply(q.setFromEuler(e));
      // lids: upper follows pitch, blink closes, squint narrows
      const blink = f.blink;
      const upOpen = this._eyePitch * 0.55 + 0.16 * f.browUp - 0.15 * f.squint - 0.07 * f.browAngry;
      const upA = THREE.MathUtils.lerp(-upOpen, 0.95, blink);
      e.set(upA, this._eyeYaw * 0.25, 0, 'YXZ');
      B['lidUp' + s].quaternion.copy(Q['lidUp' + s]).multiply(q.setFromEuler(e));
      const loA = THREE.MathUtils.lerp(-this._eyePitch * 0.25 - 0.22 * f.squint - 0.06 * f.smile, -0.32, blink);
      e.set(loA, this._eyeYaw * 0.2, 0, 'YXZ');
      B['lidLo' + s].quaternion.copy(Q['lidLo' + s]).multiply(q.setFromEuler(e));
    }
  }
}
