// Bakes the seated grandpa character: skeleton + skinned meshes sculpted with SDFs.
// Coordinate space ("char space"): truck axes (truck front = -X, driver's left = +Z,
// up = +Y) with the origin at the driver's hip point. Output: assets/meshes/grandpa.{json,bin}
import * as THREE from 'three';
import { Prim, Model, mat, smin } from './lib/sdf.mjs';
import { surfaceNets, sdfAO } from './lib/surfacenets.mjs';
import { writePack, fixWinding } from './lib/writer.mjs';
import { createNoise3D, fbm } from './lib/noise.mjs';
import { simplifyMesh } from './lib/simplify.mjs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../assets/meshes/grandpa', import.meta.url));
const noise = createNoise3D(7);
const noise2 = createNoise3D(19);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const deg = Math.PI / 180;
const yawLeft = (d) => V(-Math.cos(d * deg), 0, Math.sin(d * deg));

// ------------------------------------------------------------------ skeleton
const bones = [];
const boneMap = {};
function frame(pos, yDir, zHint) {
  const Y = yDir.clone().normalize();
  const Z = zHint.clone().sub(Y.clone().multiplyScalar(zHint.dot(Y))).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  m.setPosition(pos);
  return m;
}
function addBone(name, parent, world) {
  const b = { name, parent, world, index: bones.length };
  bones.push(b); boneMap[name] = b;
  return b;
}
const axis = (b, i) => new THREE.Vector3().setFromMatrixColumn(b.world, i);
const posOf = (b) => new THREE.Vector3().setFromMatrixPosition(b.world);
const toWorld = (b, p) => V(...p).applyMatrix4(b.world);

// torso
const F = V(-1, 0, 0), U = V(0, 1, 0);
const pelvis = addBone('pelvis', null, frame(V(0, 0, 0), U, F));
const spine = addBone('spine', 'pelvis', frame(V(0.02, 0.09, 0.0), V(0.10, 1, 0.08), yawLeft(8)));
const chestPos = posOf(spine).add(axis(spine, 1).multiplyScalar(0.17));
const chest = addBone('chest', 'spine', frame(chestPos, V(0.12, 1, 0.13), yawLeft(26)));
const neckPos = posOf(chest).add(axis(chest, 1).multiplyScalar(0.205)).add(axis(chest, 2).multiplyScalar(0.005));
const neck = addBone('neck', 'chest', frame(neckPos, axis(chest, 1).add(axis(chest, 2).multiplyScalar(0.42)), yawLeft(42)));
const headPos = posOf(neck).add(axis(neck, 1).multiplyScalar(0.075));
const headZ = yawLeft(66).add(V(0, -0.06, 0));
const head = addBone('head', 'neck', frame(headPos, V(0, 1, 0).add(headZ.clone().multiplyScalar(0.12)), headZ));

// face bones (positions in head-local space)
const HL = (p) => toWorld(head, p);
const headFrame = (p) => { const m = head.world.clone(); m.setPosition(HL(p)); return m; };
const EYE = { y: 0.088, z: 0.0765, x: 0.032, r: 0.0122 };
const MOUTH_Y = 0.0158;
addBone('jaw', 'head', headFrame([0, 0.058, 0.012]));
addBone('mouthL', 'head', headFrame([0.026, MOUTH_Y, 0.092]));
addBone('mouthR', 'head', headFrame([-0.026, MOUTH_Y, 0.092]));
addBone('browInL', 'head', headFrame([0.015, 0.108, 0.092]));
addBone('browOutL', 'head', headFrame([0.046, 0.106, 0.080]));
addBone('browInR', 'head', headFrame([-0.015, 0.108, 0.092]));
addBone('browOutR', 'head', headFrame([-0.046, 0.106, 0.080]));
addBone('cheekL', 'head', headFrame([0.036, 0.064, 0.082]));
addBone('cheekR', 'head', headFrame([-0.036, 0.064, 0.082]));
addBone('eyeL', 'head', headFrame([EYE.x, EYE.y, EYE.z]));
addBone('eyeR', 'head', headFrame([-EYE.x, EYE.y, EYE.z]));
addBone('lidUpL', 'head', headFrame([EYE.x, EYE.y, EYE.z]));
addBone('lidLoL', 'head', headFrame([EYE.x, EYE.y, EYE.z]));
addBone('lidUpR', 'head', headFrame([-EYE.x, EYE.y, EYE.z]));
addBone('lidLoR', 'head', headFrame([-EYE.x, EYE.y, EYE.z]));

// arms
const ARM = { upper: 0.30, fore: 0.255 };
function buildArmBones(side, elbowTarget, foreDir, fingerDir, backNormal, curl) {
  const s = side === 'L' ? 1 : -1;
  const sh = posOf(chest).add(axis(chest, 0).multiplyScalar(0.172 * s)).add(axis(chest, 1).multiplyScalar(0.162)).add(axis(chest, 2).multiplyScalar(-0.025));
  const elbow = sh.clone().add(elbowTarget.clone().sub(sh).normalize().multiplyScalar(ARM.upper));
  const fd = foreDir.clone().normalize();
  const wrist = elbow.clone().add(fd.clone().multiplyScalar(ARM.fore));
  const bn = backNormal.clone().normalize();
  const fdir = fingerDir.clone().normalize();
  // upper arm: Y toward shoulder, Z toward bend direction
  addBone('upperArm' + side, 'chest', frame(sh, sh.clone().sub(elbow), fd));
  // forearm: X ~ back of hand
  const foreX = bn.clone().multiplyScalar(s);
  const foreY = fd.clone().negate();
  addBone('forearm' + side, 'upperArm' + side, frame(elbow, foreY, new THREE.Vector3().crossVectors(foreX, foreY)));
  const handY = fdir.clone().negate();
  const handX = bn.clone().multiplyScalar(s);
  const hand = addBone('hand' + side, 'forearm' + side, frame(wrist, handY, new THREE.Vector3().crossVectors(handX, handY)));
  // fingers: [name, knuckle(local), length prox, length dist, splay deg]
  const fingers = [
    ['Index', [0, -0.092, 0.029], 0.044, 0.050, 4],
    ['Middle', [0, -0.096, 0.009], 0.048, 0.054, 0],
    ['Ring', [0, -0.092, -0.010], 0.045, 0.050, -4],
    ['Pinky', [0, -0.084, -0.027], 0.035, 0.040, -9],
  ];
  for (const [fn, kn, lp, ld, splay] of fingers) {
    const kp = [kn[0] * s, kn[1], kn[2]];
    const base = mat(kp, [0, 0, 0], hand.world);
    // curl about local Z: towards palm (-X for left)
    const c1 = curl[fn][0], c2 = curl[fn][1];
    const prox = base.clone().multiply(mat([0, 0, 0], [splay * 0.0 + 0, 0, -c1 * s]))
      .multiply(mat([0, 0, 0], [splay, 0, 0]));
    addBone(fn + side + '1', 'hand' + side, prox);
    const dist = prox.clone().multiply(mat([0, -lp, 0], [0, 0, -c2 * s]));
    addBone(fn + side + '2', fn + side + '1', dist);
    boneMap[fn + side + '1'].len = lp; boneMap[fn + side + '2'].len = ld;
  }
  // thumb
  const tb = mat([-0.008 * s, -0.022, 0.026], [0, 0, 0], hand.world)
    .multiply(mat([0, 0, 0], [-38, 0, -curl.Thumb[0] * s - 18 * s]));
  addBone('Thumb' + side + '1', 'hand' + side, tb);
  const td = tb.clone().multiply(mat([0, -0.045, 0], [12, 0, -curl.Thumb[1] * s]));
  addBone('Thumb' + side + '2', 'Thumb' + side + '1', td);
  boneMap['Thumb' + side + '1'].len = 0.045; boneMap['Thumb' + side + '2'].len = 0.05;
}
// left arm rests on the window sill (sill top is ~0.32 above the hip point, door inner face z~0.47)
buildArmBones('L', V(0.08, 0.35, 0.50), V(-0.86, -0.03, 0.30), V(-0.30, -0.62, 0.72), V(0.05, 0.78, 0.62),
  { Index: [18, 22], Middle: [22, 26], Ring: [26, 28], Pinky: [30, 30], Thumb: [8, 10] });
buildArmBones('R', V(0.02, 0.18, -0.26), V(-0.75, -0.05, 0.42), V(-0.62, -0.38, 0.45), V(0.15, 0.85, -0.45),
  { Index: [28, 30], Middle: [34, 36], Ring: [38, 40], Pinky: [42, 44], Thumb: [10, 12] });

// legs
function buildLeg(side, knee, ankle) {
  const s = side === 'L' ? 1 : -1;
  const hip = posOf(pelvis).add(V(0.0, -0.01, 0.095 * s));
  addBone('thigh' + side, 'pelvis', frame(hip, hip.clone().sub(knee), U));
  addBone('shin' + side, 'thigh' + side, frame(knee, knee.clone().sub(ankle), F));
  addBone('foot' + side, 'shin' + side, frame(ankle, U, F));
}
buildLeg('L', V(-0.43, 0.06, 0.16), V(-0.56, -0.40, 0.17));
buildLeg('R', V(-0.43, 0.06, -0.14), V(-0.58, -0.40, -0.16));

const B = boneMap;
const bw = (name) => B[name].world;

// ------------------------------------------------------------------ helpers
function prim(model, shape, params, bone, pos = [0, 0, 0], rot = [0, 0, 0], opts = {}) {
  const m = mat(pos, rot, bw(bone));
  return model.add(new Prim(shape, params, m, { bone, ...opts }));
}
function cone(model, boneA, a, boneB, b, ra, rb, opts = {}) {
  const pa = toWorld(B[boneA], a), pb = toWorld(B[boneB], b);
  return model.add(new Prim('rcone', { a: pa.toArray(), b: pb.toArray(), ra, rb }, null, { bone: opts.bone ?? boneA, ...opts }));
}
const C = {
  skin: [0.80, 0.58, 0.53],
  skinArm: [0.78, 0.53, 0.44],
  shirt: [0.25, 0.36, 0.62],
  pants: [0.20, 0.21, 0.24],
  shoe: [0.15, 0.12, 0.10],
  hair: [0.88, 0.87, 0.84],
};

// shirt fabric displacement: broad folds + fine creases
const shirtDisp = (amp) => (x, y, z) =>
  amp * (fbm(noise, x * 9, y * 16, z * 9, 3) * 0.8 + 0.25 * noise2(x * 40, y * 22, z * 40));

// ================================================================== TORSO (shirt + pants)
function buildTorso() {
  const m = new Model();
  const sd = shirtDisp(0.0045);
  const shirt = { mat: 'shirt', color: C.shirt, disp: sd, dispAmp: 0.006 };
  // pants / hips
  prim(m, 'ellipsoid', { rx: 0.185, ry: 0.12, rz: 0.15 }, 'pelvis', [0, 0.03, 0.0], [0, 0, 0], { mat: 'pants', color: C.pants, k: 0.04, sigma: 0.06 });
  for (const s of ['L', 'R']) {
    cone(m, 'thigh' + s, [0, 0, 0], 'thigh' + s, [0, -0.44, 0], 0.088, 0.062, { mat: 'pants', color: C.pants, k: 0.05, sigma: 0.07 });
    cone(m, 'shin' + s, [0, 0.0, 0], 'shin' + s, [0, -0.40, 0], 0.058, 0.045, { mat: 'pants', color: C.pants, k: 0.03, sigma: 0.05 });
    prim(m, 'box', { hx: 0.05, hy: 0.04, hz: 0.13, r: 0.035 }, 'foot' + s, [0, -0.04, 0.07], [0, 0, 0], { mat: 'shoe', color: C.shoe, k: 0.01, sigma: 0.03 });
  }
  // belt
  prim(m, 'torus', { R: 0.158, r: 0.02 }, 'pelvis', [0, 0.12, 0.005], [0, 0, 0], { mat: 'belt', color: [0.22, 0.13, 0.07], k: 0.006, sigma: 0.06 });
  // belly / back (shirt)
  prim(m, 'ellipsoid', { rx: 0.172, ry: 0.15, rz: 0.165 }, 'spine', [0, 0.06, 0.055], [0, 0, 0], { ...shirt, k: 0.06, sigma: 0.08 });
  prim(m, 'ellipsoid', { rx: 0.165, ry: 0.16, rz: 0.12 }, 'spine', [0, 0.08, -0.03], [0, 0, 0], { ...shirt, k: 0.06, sigma: 0.08 });
  // chest
  prim(m, 'ellipsoid', { rx: 0.188, ry: 0.15, rz: 0.125 }, 'chest', [0, 0.07, 0.015], [0, 0, 0], { ...shirt, k: 0.06, sigma: 0.08 });
  for (const s of [1, -1]) {
    prim(m, 'ellipsoid', { rx: 0.08, ry: 0.065, rz: 0.05 }, 'chest', [0.072 * s, 0.10, 0.075], [0, 0, 0], { ...shirt, k: 0.04, sigma: 0.06 });
  }
  // shoulder girdle / trapezius
  cone(m, 'chest', [0.15, 0.155, -0.02], 'chest', [-0.15, 0.155, -0.02], 0.068, 0.068, { ...shirt, k: 0.06, sigma: 0.08 });
  cone(m, 'chest', [0, 0.17, -0.02], 'neck', [0, 0.02, -0.005], 0.085, 0.07, { ...shirt, k: 0.05, sigma: 0.05 });
  // sleeves
  for (const s of ['L', 'R']) {
    const sl = { ...shirt, bone: 'upperArm' + s, k: 0.035, sigma: 0.045 };
    prim(m, 'sphere', { r: 0.072 }, 'upperArm' + s, [0, -0.01, 0], [0, 0, 0], { ...sl, sigma: 0.06 });
    cone(m, 'upperArm' + s, [0, -0.01, 0], 'upperArm' + s, [0, -0.175, 0.004], 0.07, 0.061, { ...sl, uv: 'limb' });
    // hem opening
    cone(m, 'upperArm' + s, [0, -0.168, 0.004], 'upperArm' + s, [0, -0.30, 0.004], 0.05, 0.05, { op: 'sub', k: 0.006, bone: 'upperArm' + s });
  }
  // collar band + points
  prim(m, 'torus', { R: 0.066, r: 0.0125 }, 'neck', [0, 0.015, 0.006], [16, 0, 0], { ...shirt, disp: null, dispAmp: 0, k: 0.012, sigma: 0.03, bone: 'neck', weightBias: 0.0 });
  for (const s of [1, -1]) {
    prim(m, 'box', { hx: 0.03, hy: 0.04, hz: 0.004, r: 0.0035 }, 'chest', [0.035 * s, 0.205, 0.095], [-48, 22 * s, 32 * s], { ...shirt, disp: null, dispAmp: 0, k: 0.008, sigma: 0.03 });
  }
  // pocket on his left chest + pen
  prim(m, 'box', { hx: 0.054, hy: 0.06, hz: 0.006, r: 0.004 }, 'chest', [0.085, 0.095, 0.128], [-6, 20, 0], { ...shirt, disp: null, dispAmp: 0, k: 0.004, sigma: 0.05, tag: 'pocket' });
  prim(m, 'cyl', { r: 0.0055, h: 0.03, rr: 0.002 }, 'chest', [0.105, 0.150, 0.130], [-6, 20, 0], { mat: 'pen', color: [0.85, 0.85, 0.86], k: 0.0, sigma: 0.05 });
  prim(m, 'box', { hx: 0.0015, hy: 0.018, hz: 0.002, r: 0.001 }, 'chest', [0.105, 0.150, 0.137], [-6, 20, 0], { mat: 'pen', color: [0.75, 0.75, 0.78], k: 0.0, sigma: 0.05 });
  return m;
}

// ================================================================== ARMS (skin)
function buildArm(side) {
  const m = new Model();
  const s = side === 'L' ? 1 : -1;
  const sk = { mat: 'skin', color: C.skinArm };
  const ua = 'upperArm' + side, fa = 'forearm' + side, hd = 'hand' + side;
  cone(m, ua, [0, -0.04, 0], ua, [0, -0.30, 0], 0.050, 0.041, { ...sk, k: 0.02, sigma: 0.05 });
  prim(m, 'ellipsoid', { rx: 0.042, ry: 0.075, rz: 0.044 }, ua, [0.0, -0.17, 0.012], [0, 0, 0], { ...sk, k: 0.03, sigma: 0.05 });
  // forearm
  cone(m, fa, [0, 0.0, 0], fa, [0, -0.25, 0], 0.044, 0.028, { ...sk, k: 0.025, sigma: 0.05 });
  prim(m, 'ellipsoid', { rx: 0.047, ry: 0.085, rz: 0.040 }, fa, [0.004 * s, -0.075, 0.0], [0, 0, 0], { ...sk, k: 0.03, sigma: 0.05 });
  prim(m, 'sphere', { r: 0.03 }, fa, [0, 0.005, -0.018], [0, 0, 0], { ...sk, k: 0.02, sigma: 0.04 }); // elbow
  // wrist + palm
  cone(m, fa, [0, -0.235, 0], hd, [0, -0.02, 0], 0.028, 0.025, { ...sk, bone: hd, k: 0.012, sigma: 0.03 });
  prim(m, 'box', { hx: 0.0165, hy: 0.05, hz: 0.043, r: 0.015 }, hd, [0.001 * s, -0.052, 0.001], [0, 0, 0], { ...sk, k: 0.014, sigma: 0.025 });
  prim(m, 'ellipsoid', { rx: 0.014, ry: 0.03, rz: 0.017 }, hd, [-0.010 * s, -0.036, 0.022], [0, 0, 12 * s], { ...sk, k: 0.01, sigma: 0.02 }); // thenar
  prim(m, 'ellipsoid', { rx: 0.012, ry: 0.034, rz: 0.012 }, hd, [-0.009 * s, -0.055, -0.03], [0, 0, 0], { ...sk, k: 0.01, sigma: 0.02 }); // hypothenar
  for (const fn of ['Index', 'Middle', 'Ring', 'Pinky']) {
    const b1 = fn + side + '1', b2 = fn + side + '2';
    const lp = B[b1].len, ld = B[b2].len;
    const r0 = fn === 'Pinky' ? 0.0078 : fn === 'Index' ? 0.0092 : 0.0095;
    cone(m, b1, [0, 0.006, 0], b1, [0, -lp, 0], r0 + 0.0008, r0 * 0.94, { ...sk, k: 0.006, sigma: 0.012 });
    // knuckle bump
    prim(m, 'sphere', { r: r0 * 1.05 }, b1, [0.003 * s, 0.0, 0], [0, 0, 0], { ...sk, k: 0.005, sigma: 0.01 });
    // distal: middle + distal phalanx with a small fixed bend
    const mid = ld * 0.55;
    cone(m, b2, [0, 0, 0], b2, [0, -mid, 0], r0 * 0.94, r0 * 0.86, { ...sk, k: 0.004, sigma: 0.008 });
    const tip = toWorld(B[b2], [-0.004 * s, -ld, 0]);
    const midW = toWorld(B[b2], [0, -mid, 0]);
    m.add(new Prim('rcone', { a: midW.toArray(), b: tip.toArray(), ra: r0 * 0.86, rb: r0 * 0.78 }, null, { ...sk, bone: b2, k: 0.004, sigma: 0.008 }));
    // fingernail (subtle flat)
    prim(m, 'box', { hx: 0.0015, hy: 0.006, hz: r0 * 0.62, r: 0.0012 }, b2, [r0 * 0.78 * s, -ld + 0.005, 0], [0, 0, 0], { mat: 'nail', color: [0.86, 0.66, 0.60], k: 0.002, sigma: 0.006, weightBias: 0.0 });
  }
  // thumb
  const t1 = 'Thumb' + side + '1', t2 = 'Thumb' + side + '2';
  cone(m, hd, [-0.004 * s, -0.016, 0.022], t1, [0, -0.045, 0], 0.016, 0.0105, { ...sk, bone: t1, k: 0.012, sigma: 0.02 });
  cone(m, t2, [0, 0, 0], t2, [0, -0.046, 0], 0.0105, 0.0085, { ...sk, k: 0.004, sigma: 0.01 });
  prim(m, 'box', { hx: 0.0015, hy: 0.007, hz: 0.0065, r: 0.0012 }, t2, [0.0072 * s, -0.04, 0], [0, 0, 0], { mat: 'nail', color: [0.86, 0.66, 0.60], k: 0.002, sigma: 0.006 });
  return m;
}

// ================================================================== HEAD
const hp = (model, shape, params, pos, rot, opts) => prim(model, shape, params, 'head', pos, rot, opts);
function buildHead() {
  const m = new Model();
  const sk = { mat: 'skin', color: C.skin };
  // cranium & face masses
  hp(m, 'ellipsoid', { rx: 0.074, ry: 0.092, rz: 0.098 }, [0, 0.110, -0.016], [8, 0, 0], { ...sk, k: 0.02 });
  hp(m, 'ellipsoid', { rx: 0.066, ry: 0.064, rz: 0.058 }, [0, 0.122, 0.030], [0, 0, 0], { ...sk, k: 0.03 }); // forehead
  hp(m, 'ellipsoid', { rx: 0.056, ry: 0.068, rz: 0.062 }, [0, 0.050, 0.030], [0, 0, 0], { ...sk, k: 0.03 }); // midface
  // brow ridge
  for (const s of [1, -1]) {
    hp(m, 'ellipsoid', { rx: 0.024, ry: 0.0105, rz: 0.013 }, [0.031 * s, 0.1035, 0.0875], [0, 0, -9 * s], { ...sk, k: 0.014 });
    // under-eye bags
    hp(m, 'ellipsoid', { rx: 0.0135, ry: 0.0058, rz: 0.006 }, [0.033 * s, 0.0745, 0.0835], [0, 0, 6 * s], { ...sk, k: 0.008 });
  }
  hp(m, 'ellipsoid', { rx: 0.011, ry: 0.013, rz: 0.011 }, [0, 0.099, 0.0925], [0, 0, 0], { ...sk, k: 0.012 }); // glabella
  // cheekbones, cheeks, jowls
  for (const s of [1, -1]) {
    hp(m, 'ellipsoid', { rx: 0.022, ry: 0.016, rz: 0.022 }, [0.050 * s, 0.068, 0.062], [0, 20 * s, 0], { ...sk, k: 0.02 });
    hp(m, 'ellipsoid', { rx: 0.022, ry: 0.026, rz: 0.019 }, [0.036 * s, 0.042, 0.068], [0, 15 * s, 0], { ...sk, k: 0.02 });
    hp(m, 'ellipsoid', { rx: 0.021, ry: 0.026, rz: 0.024 }, [0.044 * s, 0.006, 0.045], [0, 15 * s, 0], { ...sk, k: 0.022 });
    cone(m, 'head', [0.024 * s, -0.026, 0.072], 'head', [0.056 * s, -0.006, 0.006], 0.018, 0.019, { ...sk, k: 0.02 });
    cone(m, 'head', [0.056 * s, -0.006, 0.006], 'head', [0.064 * s, 0.045, -0.012], 0.019, 0.018, { ...sk, k: 0.02 });
  }
  // nose
  cone(m, 'head', [0, 0.090, 0.093], 'head', [0, 0.056, 0.1155], 0.0068, 0.0098, { ...sk, k: 0.008 });
  hp(m, 'sphere', { r: 0.0125 }, [0, 0.049, 0.117], [0, 0, 0], { ...sk, k: 0.008 });
  for (const s of [1, -1]) {
    hp(m, 'ellipsoid', { rx: 0.0085, ry: 0.0078, rz: 0.0095 }, [0.0135 * s, 0.0465, 0.106], [0, 15 * s, 0], { ...sk, k: 0.006 });
  }
  // upper lip, lower lip, chin
  hp(m, 'ellipsoid', { rx: 0.024, ry: 0.012, rz: 0.012 }, [0, 0.027, 0.1], [0, 0, 0], { ...sk, k: 0.012 });
  hp(m, 'ellipsoid', { rx: 0.0185, ry: 0.0062, rz: 0.0076 }, [0, 0.0096, 0.0982], [0, 0, 0], { ...sk, k: 0.009, mat: 'lip' });
  hp(m, 'ellipsoid', { rx: 0.026, ry: 0.022, rz: 0.021 }, [0, -0.023, 0.0875], [0, 0, 0], { ...sk, k: 0.016 });
  hp(m, 'ellipsoid', { rx: 0.018, ry: 0.012, rz: 0.011 }, [0, -0.009, 0.0935], [0, 0, 0], { ...sk, k: 0.012 }); // mentalis
  // under-chin / wattle
  hp(m, 'ellipsoid', { rx: 0.040, ry: 0.028, rz: 0.036 }, [0, -0.036, 0.035], [-20, 0, 0], { ...sk, k: 0.03 });
  // neck
  cone(m, 'head', [0, 0.03, -0.012], 'neck', [0, -0.01, 0.0], 0.056, 0.064, { ...sk, bone: 'neck', k: 0.03, sigma: 0.05 });
  // ears
  for (const s of [1, -1]) {
    const eo = { ...sk, mat: 'ear', k: 0.006 };
    hp(m, 'ellipsoid', { rx: 0.009, ry: 0.035, rz: 0.021 }, [0.079 * s, 0.072, -0.016], [-12, 22 * s, 7 * s], eo);
    hp(m, 'torus', { R: 0.0185, r: 0.0042 }, [0.084 * s, 0.078, -0.018], [0, 22 * s, 90 * s + 8 * s], { ...eo, k: 0.004 });
    hp(m, 'ellipsoid', { rx: 0.007, ry: 0.012, rz: 0.009 }, [0.081 * s, 0.039, -0.008], [0, 0, 0], { ...eo, k: 0.006 }); // lobe
    hp(m, 'ellipsoid', { rx: 0.007, ry: 0.016, rz: 0.011 }, [0.089 * s, 0.072, -0.014], [-12, 22 * s, 7 * s], { op: 'sub', k: 0.004 }); // concha
  }
  // eye sockets
  for (const s of [1, -1]) {
    hp(m, 'sphere', { r: 0.0150 }, [EYE.x * s, EYE.y, EYE.z + 0.0015], [0, 0, 0], { op: 'sub', k: 0.004 });
  }
  // nostrils
  for (const s of [1, -1]) {
    hp(m, 'ellipsoid', { rx: 0.0036, ry: 0.0026, rz: 0.0048 }, [0.0072 * s, 0.0405, 0.110], [20, 0, 0], { op: 'sub', k: 0.002 });
  }
  // nasolabial folds
  for (const s of [1, -1]) {
    cone(m, 'head', [0.019 * s, 0.050, 0.1045], 'head', [0.031 * s, 0.008, 0.0925], 0.0026, 0.002, { op: 'sub', k: 0.007 });
  }
  // mouth slit (slightly downturned corners)
  hp(m, 'box', { hx: 0.0175, hy: 0.0009, hz: 0.012, r: 0.0008 }, [0, MOUTH_Y, 0.108], [0, 0, 0], { op: 'sub', k: 0.0016 });
  for (const s of [1, -1]) {
    hp(m, 'box', { hx: 0.007, hy: 0.0009, hz: 0.011, r: 0.0008 }, [0.019 * s, MOUTH_Y - 0.0012, 0.101], [0, 0, 10 * s], { op: 'sub', k: 0.0016 });
  }
  return m;
}

// head-local surface query: z of the front surface at (x, y)
function surfZ(model, x, y, z0 = 0.16) {
  let z = z0;
  for (let i = 0; i < 200; i++) {
    const w = HL([x, y, z]);
    const d = model.eval(w.x, w.y, w.z);
    if (d < 0.0002) break;
    z -= Math.max(d * 0.8, 0.0002);
  }
  return z;
}

// skin wrinkle displacement & fine detail on head (applied as post-process along normal)
function headDetail(lp) {
  const [x, y, z] = lp;
  let d = 0;
  // forehead wrinkles
  const fore = smooth(0.098, 0.112, y) * (1 - smooth(0.15, 0.17, y)) * smooth(0.04, 0.07, z) * (1 - smooth(0.045, 0.06, Math.abs(x)));
  d += fore * 0.0010 * Math.sin(y * 480 + 2.0 * Math.sin(x * 60));
  // crow's feet
  for (const s of [1, -1]) {
    const dx = x - 0.052 * s, dy = y - 0.088;
    const r = Math.hypot(dx, dy);
    const cf = Math.exp(-r * r / (0.012 * 0.012)) * (Math.abs(x) > 0.045 ? 1 : 0);
    d += cf * 0.0006 * Math.sin(Math.atan2(dy, dx) * 9);
  }
  // neck rings
  const neckM = smooth(0.0, -0.03, y) * smooth(-0.02, 0.03, z);
  d += neckM * 0.0008 * Math.sin(y * 330 + 3.0 * Math.sin(x * 40));
  // general skin unevenness
  d += 0.00025 * fbm(noise, x * 120, y * 120, z * 120, 2);
  return d;
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ================================================================== extras: mustache, brows, hair
function buildMustache(headModel) {
  const m = new Model();
  const o = { mat: 'hair', color: C.hair, k: 0.006, disp: (x, y, z) => 0.0005 * noise(x * 420, y * 160, z * 420), dispAmp: 0.001 };
  // path along the upper lip, snapped to the skin, from the centre to the corners
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = 0.031 * t;
    const y = 0.0222 - 0.0040 * t * t - 0.006 * Math.max(0, t - 0.7) / 0.3;
    pts.push([x, y, surfZ(headModel, x, y) + 0.0030 - 0.0012 * t]);
  }
  for (const s of [1, -1]) {
    for (let i = 0; i < 8; i++) {
      const a = pts[i], b = pts[i + 1];
      const t = i / 8;
      const ra = 0.0062 - 0.0028 * t * t, rb = 0.0062 - 0.0028 * ((i + 1) / 8) ** 2;
      cone(m, 'head', [a[0] * s, a[1], a[2]], 'head', [b[0] * s, b[1], b[2]], ra, rb, o);
    }
  }
  return m;
}
function buildBrows(headModel) {
  const m = new Model();
  const o = { mat: 'hair', color: C.hair, k: 0.004, disp: (x, y, z) => 0.0005 * noise(x * 600, y * 250, z * 600), dispAmp: 0.001 };
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const P = [[0.011, 0.1075], [0.022, 0.1095], [0.033, 0.110], [0.044, 0.1075], [0.053, 0.1025]].map(([x, y]) => [x * s, y, surfZ(headModel, x * s, y) + 0.0010]);
    for (let i = 0; i < P.length - 1; i++) {
      const bone = i < 2 ? 'browIn' + side : 'browOut' + side;
      const ra = [0.0030, 0.0033, 0.0032, 0.0027, 0.0021][i], rb = [0.0033, 0.0032, 0.0027, 0.0021, 0.0016][i];
      cone(m, 'head', P[i], 'head', P[i + 1], ra, rb, { ...o, bone });
    }
  }
  return m;
}
// hair fringe region in head-local space (negative = hair)
function hairRegion(p) {
  const yTop = 0.124 + 0.03 * smooth(0.02, -0.09, p.z) + 0.004 * noise(p.x * 90, p.y * 90, p.z * 90);
  const yBot = 0.018 + 0.03 * smooth(-0.02, 0.03, p.z);
  const front = p.z - (0.036 - 0.02 * smooth(0.09, 0.125, p.y));
  const ear = Math.hypot(Math.abs(p.x) - 0.082, (p.y - 0.068) * 0.62, (p.z + 0.012) * 0.95) - 0.026;
  return Math.max(p.y - yTop, yBot - p.y, front, -ear);
}
function buildHair(headModel) {
  // short white fringe: thin shell over the sides and back of the skull, bald on top
  const m = new Model();
  const inv = new THREE.Matrix4().copy(B.head.world).invert();
  const f = (x, y, z) => {
    const p = V(x, y, z).applyMatrix4(inv);
    const hd = headModel.eval(x, y, z);
    const shell = Math.max(hd - 0.0024, -(hd + 0.0012));
    return Math.max(shell, hairRegion(p) - 0.004);
  };
  const cen = toWorld(B.head, [0, 0.1, -0.01]);
  m.add(new Prim('fn', { f, bound: 0.14, center: [0, 0, 0] }, new THREE.Matrix4().makeTranslation(0, 0, 0), { mat: 'hair', color: C.hair, bone: 'head', k: 0 }));
  m.prims[0].cx = cen.x; m.prims[0].cy = cen.y; m.prims[0].cz = cen.z; m.prims[0].R = 0.14;
  return m;
}

// ================================================================== bake
const headInv = new THREE.Matrix4().copy(B.head.world).invert();
function bake(name, model, h, opts = {}) {
  const t0 = Date.now();
  const bb = opts.bounds || model.bounds(0.015);
  let mesh = surfaceNets(model, { h, min: bb.min, max: bb.max, project: 3 });
  // optional detail displacement along normal
  if (opts.detail) {
    const P = mesh.positions, N = mesh.normals, nv = P.length / 3;
    for (let v = 0; v < nv; v++) {
      const wp = V(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      const lp = wp.clone().applyMatrix4(opts.detailInv);
      const dd = opts.detail([lp.x, lp.y, lp.z]);
      P[v * 3] -= N[v * 3] * dd; P[v * 3 + 1] -= N[v * 3 + 1] * dd; P[v * 3 + 2] -= N[v * 3 + 2] * dd;
    }
  }
  const rawTris = mesh.indices.length / 3;
  if (opts.tris) mesh = simplifyMesh(mesh, opts.tris, opts.err || 0.0004);
  const P = mesh.positions, N = mesh.normals;
  const nv = P.length / 3;
  const color = new Uint8Array(nv * 4);
  const skinIndex = new Uint8Array(nv * 4);
  const skinWeight = new Uint8Array(nv * 4);
  const uv = new Float32Array(nv * 2);
  const matId = new Uint8Array(nv);
  const MATS = ['skin', 'shirt', 'pants', 'shoe', 'hair', 'lip', 'ear', 'nail', 'pen', 'belt'];
  const aoModel = opts.aoModel || model;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const contrib = model.contributions(x, y, z);
    let dmin = 1e9, best = null;
    for (const [p, d] of contrib) { const dd = d + p.paintBias; if (dd < dmin) { dmin = dd; best = p; } }
    // weights
    const acc = {};
    let wmin = 1e9;
    for (const [p, d] of contrib) if (p.bone && !p.noWeight) wmin = Math.min(wmin, d + p.weightBias);
    for (const [p, d] of contrib) {
      if (!p.bone || p.noWeight) continue;
      const t = (d + p.weightBias - wmin) / p.sigma;
      if (t >= 1) continue;
      const w = (1 - t) * (1 - t);
      acc[p.bone] = (acc[p.bone] || 0) + w;
    }
    let wl = Object.entries(acc);
    if (opts.weightFn) wl = opts.weightFn(V(x, y, z), wl);
    wl.sort((a, b) => b[1] - a[1]);
    wl = wl.slice(0, 4);
    const sum = wl.reduce((s, e) => s + e[1], 0) || 1;
    const qs = wl.map((e) => Math.floor((e[1] / sum) * 255));
    let rem = 255 - qs.reduce((a, b) => a + b, 0);
    qs[0] += rem;
    for (let i = 0; i < wl.length; i++) {
      skinIndex[v * 4 + i] = B[wl[i][0]].index;
      skinWeight[v * 4 + i] = qs[i];
    }
    // color
    let col = best.color || [1, 0, 1];
    if (opts.paint) col = opts.paint(V(x, y, z), col, best);
    const ao = sdfAO(aoModel, x, y, z, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], opts.aoScale || 0.008, 5);
    color[v * 4] = Math.round(Math.min(1, col[0]) * 255);
    color[v * 4 + 1] = Math.round(Math.min(1, col[1]) * 255);
    color[v * 4 + 2] = Math.round(Math.min(1, col[2]) * 255);
    color[v * 4 + 3] = Math.round((opts.alphaFn ? opts.alphaFn(V(x, y, z)) : ao) * 255);
    matId[v] = Math.max(0, MATS.indexOf(best.mat));
    // uv for fabric
    if (opts.uv) { const [u, w] = opts.uv(V(x, y, z), best); uv[v * 2] = u; uv[v * 2 + 1] = w; }
  }
  const bad = fixWinding(P, N, mesh.indices);
  console.log(`${name}: ${nv} verts, ${mesh.indices.length / 3} tris (raw ${rawTris}), flipped-ratio ${bad.toFixed(3)} (${Date.now() - t0} ms)`);
  return {
    name,
    attributes: {
      position: { data: P, itemSize: 3, type: 'f32' },
      normal: { data: N, itemSize: 3, type: 'f32' },
      color: { data: color, itemSize: 4, type: 'u8', normalized: true },
      skinIndex: { data: skinIndex, itemSize: 4, type: 'u8' },
      skinWeight: { data: skinWeight, itemSize: 4, type: 'u8', normalized: true },
      uv: { data: uv, itemSize: 2, type: 'f32' },
      matId: { data: matId, itemSize: 1, type: 'u8' },
    },
    index: mesh.indices,
  };
}

// fabric uv: torso around chest axis, sleeves around arm axis
const chestInv = new THREE.Matrix4().copy(B.chest.world).invert();
const uaInv = { L: new THREE.Matrix4().copy(B.upperArmL.world).invert(), R: new THREE.Matrix4().copy(B.upperArmR.world).invert() };
function fabricUV(wp, best) {
  if (best.bone && best.bone.startsWith('upperArm')) {
    const side = best.bone.endsWith('L') ? 'L' : 'R';
    const lp = wp.clone().applyMatrix4(uaInv[side]);
    return [Math.atan2(lp.x, lp.z) * 0.066, lp.y];
  }
  const lp = wp.clone().applyMatrix4(chestInv);
  return [Math.atan2(lp.x, lp.z) * 0.17, lp.y];
}

// face weights
const W_FACE = (() => {
  const g = (p, c, r) => { const d2 = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; return Math.exp(-d2 / (r * r)); };
  return (wp, wl) => {
    const lp = wp.clone().applyMatrix4(headInv).toArray();
    const [x, y, z] = lp;
    const out = new Map(wl);
    const headW = out.get('head') || 0;
    if (headW <= 0) return wl;
    const ax = Math.abs(x);
    // jaw region: below the mouth line at the front, line rises towards the ear
    const lineY = MOUTH_Y + 0.0002 + Math.max(0, ax - 0.022) * 0.9 + Math.max(0, 0.07 - z) * 0.25;
    const band = 0.0025 + Math.max(0, ax - 0.02) * 0.35 + Math.max(0, 0.08 - z) * 0.15;
    let jaw = smooth(lineY + band * 0.2, lineY - band, y);
    jaw *= smooth(-0.01, 0.035, z) * (1 - smooth(0.062, 0.075, ax));
    // under-chin skin follows partially
    jaw = Math.max(jaw, 0.55 * smooth(-0.015, -0.035, y) * smooth(0.0, 0.04, z) * (1 - smooth(0.05, 0.07, ax)));
    const parts = { jaw };
    for (const [s, sd] of [[1, 'L'], [-1, 'R']]) {
      parts['mouth' + sd] = 0.85 * g(lp, [0.026 * s, MOUTH_Y, 0.093], 0.012);
      const above = smooth(EYE.y + 0.006, EYE.y + 0.014, y);
      parts['browIn' + sd] = 0.9 * g(lp, [0.016 * s, 0.108, 0.092], 0.013) * above;
      parts['browOut' + sd] = 0.9 * g(lp, [0.045 * s, 0.106, 0.080], 0.014) * above;
      parts['cheek' + sd] = 0.7 * g(lp, [0.036 * s, 0.064, 0.082], 0.013) * (1 - smooth(EYE.y - 0.012, EYE.y - 0.004, y));
    }
    let face = 0;
    for (const k in parts) face += parts[k];
    const scale = face > 1 ? 1 / face : 1;
    let used = 0;
    for (const k in parts) {
      const w = parts[k] * scale * headW;
      if (w > 0.002) { out.set(k, (out.get(k) || 0) + w); used += w; }
    }
    out.set('head', headW - used);
    return [...out.entries()].filter((e) => e[1] > 0.001);
  };
})();

function headPaint(wp, col, best) {
  const p = wp.clone().applyMatrix4(headInv);
  const g = (cx, cy, cz, r) => Math.exp(-((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2) / (r * r));
  let c = [...C.skin];
  const mix = (t, tgt) => { for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - t) + tgt[i] * t; };
  // scalp: lighter, pinker and a bit shiny
  mix(0.55 * smooth(0.13, 0.18, p.y), [0.86, 0.62, 0.55]);
  // ruddy cheeks, nose, ears
  for (const s of [1, -1]) mix(0.38 * g(0.042 * s, 0.05, 0.075, 0.024), [0.80, 0.45, 0.42]);
  mix(0.45 * g(0, 0.048, 0.112, 0.02), [0.80, 0.46, 0.43]);
  if (best.mat === 'ear') mix(0.45, [0.82, 0.45, 0.42]);
  if (best.mat === 'lip') mix(0.5, [0.70, 0.40, 0.40]);
  // around eyes slightly darker / purple
  for (const s of [1, -1]) mix(0.35 * g(EYE.x * s, EYE.y - 0.006, EYE.z + 0.01, 0.014), [0.62, 0.42, 0.42]);
  // neck a little tanned
  mix(0.35 * smooth(0.0, -0.05, p.y) * smooth(-0.02, 0.03, -p.z + 0.05), [0.74, 0.50, 0.40]);
  // short hair tint on the scalp under the fringe
  { const hr = hairRegion(p); const t = Math.max(0, Math.min(1, (-hr + 0.002) / 0.008)); mix(0.55 * t, [0.78, 0.74, 0.70]); }
  // age spots / freckles
  const sp = fbm(noise2, p.x * 90, p.y * 90, p.z * 90, 2);
  if (sp > 0.38) mix(Math.min(0.35, (sp - 0.38) * 3), [0.62, 0.42, 0.30]);
  // fine mottling
  const mn = noise(p.x * 300, p.y * 300, p.z * 300) * 0.035;
  c = c.map((v, i) => v + mn * (i === 0 ? 1 : 0.6));
  return c;
}
function armPaint(wp, col) {
  const n = fbm(noise2, wp.x * 70, wp.y * 70, wp.z * 70, 2);
  let c = [...col];
  if (n > 0.35) { const t = Math.min(0.3, (n - 0.35) * 2.5); c = c.map((v, i) => v * (1 - t) + [0.6, 0.4, 0.3][i] * t); }
  c[0] += noise(wp.x * 200, wp.y * 200, wp.z * 200) * 0.03;
  return c;
}

const torso = buildTorso();
const armL = buildArm('L'), armR = buildArm('R');
const headM = buildHead();
const all = new Model();
for (const mm of [torso, armL, armR, headM]) for (const p of mm.prims) if (p.op === 'add') all.add(p);

const meshes = [];
meshes.push(bake('torso', torso, 0.0055, { tris: 32000, err: 0.0012, uv: fabricUV, aoModel: all, aoScale: 0.02 }));
meshes.push(bake('armL', armL, 0.0024, { tris: 14000, err: 0.0006, aoModel: all, aoScale: 0.01, paint: armPaint }));
meshes.push(bake('armR', armR, 0.0024, { tris: 14000, err: 0.0006, aoModel: all, aoScale: 0.01, paint: armPaint }));
meshes.push(bake('head', headM, 0.0013, { tris: 34000, err: 0.00025, aoModel: all, aoScale: 0.006, weightFn: W_FACE, paint: headPaint, detail: headDetail, detailInv: headInv }));
const must = buildMustache(headM);
meshes.push(bake('mustache', must, 0.0009, { tris: 5000, err: 0.0003, weightFn: (wp, wl) => {
  const lp = wp.clone().applyMatrix4(headInv);
  const side = lp.x > 0 ? 'L' : 'R';
  const t = smooth(0.006, 0.026, Math.abs(lp.x));
  return [['head', 1 - 0.6 * t], ['mouth' + side, 0.6 * t]];
}, aoScale: 0.004 }));
meshes.push(bake('brows', buildBrows(headM), 0.0008, { tris: 2000, err: 0.0002, aoScale: 0.003 }));
meshes.push(bake('hair', buildHair(headM), 0.0012, { tris: 12000, err: 0.0004, alphaFn: (wp) => Math.max(0, Math.min(1, -hairRegion(wp.clone().applyMatrix4(headInv)) / 0.010 + 0.4)), bounds: (() => { const c = toWorld(B.head, [0, 0.1, -0.01]); return { min: [c.x - 0.13, c.y - 0.13, c.z - 0.13], max: [c.x + 0.13, c.y + 0.13, c.z + 0.13] }; })(), aoModel: all, aoScale: 0.004 }));

// skeleton export (local transforms)
const boneOut = bones.map((b) => {
  const parentWorld = b.parent ? B[b.parent].world : new THREE.Matrix4();
  const local = parentWorld.clone().invert().multiply(b.world);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  local.decompose(p, q, s);
  return { name: b.name, parent: b.parent, p: p.toArray().map((v) => +v.toFixed(6)), q: q.toArray().map((v) => +v.toFixed(6)) };
});
const r = writePack(OUT, meshes, {
  bones: boneOut,
  // where the hip point sits inside the truck (truck space)
  seat: [-0.10, 0.98, 0.40],
  eye: EYE, mouthY: MOUTH_Y,
});
console.log('wrote', OUT, (r.bytes / 1e6).toFixed(2), 'MB');

// debug: key joints in truck space
const seat = V(-0.10, 0.98, 0.40);
for (const n of ['head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'eyeL']) {
  console.log(n.padEnd(10), posOf(B[n]).add(seat).toArray().map((v) => v.toFixed(3)).join(', '));
}
