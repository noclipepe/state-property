// Bakes the standing fisherman (the person filming in the original meme) for the driver POV
// mode: same SDF sculpting pipeline, face rig and bone names as the grandpa, so the runtime
// character class and the arm IK / face animation are shared.
// Look: matches the first-person hand of the fishing mode (dark skin, grey-green long sleeve),
// plus jeans, sneakers and an olive cap.
// Char space: origin on the ground between the feet, +Z forward, +X = his left, +Y up.
// Output: assets/meshes/fisherman.{json,bin}
import * as THREE from 'three';
import { Prim, Model, mat } from './lib/sdf.mjs';
import { surfaceNets, sdfAO } from './lib/surfacenets.mjs';
import { writePack, fixWinding } from './lib/writer.mjs';
import { createNoise3D, fbm } from './lib/noise.mjs';
import { simplifyMesh } from './lib/simplify.mjs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../assets/meshes/fisherman', import.meta.url));
const noise = createNoise3D(23);
const noise2 = createNoise3D(41);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

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

const F = V(0, 0, 1), U = V(0, 1, 0);
const pelvis = addBone('pelvis', null, frame(V(0, 0.93, 0), U, F));
const spine = addBone('spine', 'pelvis', frame(V(0, 1.03, -0.012), V(0, 1, 0.03), F));
const chest = addBone('chest', 'spine', frame(posOf(spine).add(axis(spine, 1).multiplyScalar(0.20)), V(0, 1, -0.03), F));
const neckPos = posOf(chest).add(axis(chest, 1).multiplyScalar(0.205)).add(axis(chest, 2).multiplyScalar(0.004));
const neck = addBone('neck', 'chest', frame(neckPos, V(0, 1, 0.16), F));
const head = addBone('head', 'neck', frame(posOf(neck).add(axis(neck, 1).multiplyScalar(0.075)), V(0, 1, 0.02), F));

// face bones: identical head-local layout to the grandpa (the runtime face rig depends on it)
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

// arms (same segment lengths as the grandpa: the runtime IK uses 0.30 / 0.255)
const ARM = { upper: 0.30, fore: 0.255 };
const BIND_CURL = {
  L: { Index: [30, 34], Middle: [34, 38], Ring: [38, 40], Pinky: [42, 44], Thumb: [12, 14] },
  R: { Index: [30, 34], Middle: [34, 38], Ring: [38, 40], Pinky: [42, 44], Thumb: [12, 14] },
};
function buildArmBones(side, elbowTarget, foreDir, fingerDir, backNormal, curl) {
  const s = side === 'L' ? 1 : -1;
  const sh = posOf(chest).add(axis(chest, 0).multiplyScalar(0.168 * s)).add(axis(chest, 1).multiplyScalar(0.158)).add(axis(chest, 2).multiplyScalar(-0.02));
  const elbow = sh.clone().add(elbowTarget.clone().sub(sh).normalize().multiplyScalar(ARM.upper));
  const fd = foreDir.clone().normalize();
  const wrist = elbow.clone().add(fd.clone().multiplyScalar(ARM.fore));
  const bn = backNormal.clone().normalize();
  const fdir = fingerDir.clone().normalize();
  addBone('upperArm' + side, 'chest', frame(sh, sh.clone().sub(elbow), fd));
  const foreX = bn.clone().multiplyScalar(s);
  const foreY = fd.clone().negate();
  addBone('forearm' + side, 'upperArm' + side, frame(elbow, foreY, new THREE.Vector3().crossVectors(foreX, foreY)));
  const handY = fdir.clone().negate();
  const handX = bn.clone().multiplyScalar(s);
  const hand = addBone('hand' + side, 'forearm' + side, frame(wrist, handY, new THREE.Vector3().crossVectors(handX, handY)));
  const fingers = [
    ['Index', [0, -0.090, 0.028], 0.043, 0.048, 4],
    ['Middle', [0, -0.094, 0.009], 0.047, 0.052, 0],
    ['Ring', [0, -0.090, -0.010], 0.044, 0.048, -4],
    ['Pinky', [0, -0.082, -0.026], 0.034, 0.038, -9],
  ];
  for (const [fn, kn, lp, ld, splay] of fingers) {
    const kp = [kn[0] * s, kn[1], kn[2]];
    const base = mat(kp, [0, 0, 0], hand.world);
    const prox = base.clone().multiply(mat([0, 0, 0], [0, 0, -curl[fn][0] * s])).multiply(mat([0, 0, 0], [splay, 0, 0]));
    addBone(fn + side + '1', 'hand' + side, prox);
    const dist = prox.clone().multiply(mat([0, -lp, 0], [0, 0, -curl[fn][1] * s]));
    addBone(fn + side + '2', fn + side + '1', dist);
    boneMap[fn + side + '1'].len = lp; boneMap[fn + side + '2'].len = ld;
  }
  const tb = mat([-0.008 * s, -0.022, 0.026], [0, 0, 0], hand.world).multiply(mat([0, 0, 0], [-38, 0, -curl.Thumb[0] * s - 18 * s]));
  addBone('Thumb' + side + '1', 'hand' + side, tb);
  const td = tb.clone().multiply(mat([0, -0.044, 0], [12, 0, -curl.Thumb[1] * s]));
  addBone('Thumb' + side + '2', 'Thumb' + side + '1', td);
  boneMap['Thumb' + side + '1'].len = 0.044; boneMap['Thumb' + side + '2'].len = 0.048;
}
// relaxed bind pose: elbows bent, forearms forward (close to how he holds the rod)
buildArmBones('L', V(0.20, 1.12, 0.03), V(-0.10, -0.45, 0.89), V(-0.12, -0.42, 0.90), V(0.92, 0.35, 0.05), BIND_CURL.L);
buildArmBones('R', V(-0.20, 1.12, 0.03), V(0.10, -0.45, 0.89), V(0.12, -0.42, 0.90), V(-0.92, 0.35, 0.05), BIND_CURL.R);

function buildLeg(side, knee, ankle) {
  const s = side === 'L' ? 1 : -1;
  const hip = posOf(pelvis).add(V(0.092 * s, -0.012, 0));
  addBone('thigh' + side, 'pelvis', frame(hip, hip.clone().sub(knee), F));
  addBone('shin' + side, 'thigh' + side, frame(knee, knee.clone().sub(ankle), F));
  addBone('foot' + side, 'shin' + side, frame(ankle, U, F));
}
buildLeg('L', V(0.10, 0.50, 0.012), V(0.11, 0.084, -0.012));
buildLeg('R', V(-0.10, 0.50, 0.012), V(-0.11, 0.084, -0.012));

const B = boneMap;
const bw = (name) => B[name].world;

// ------------------------------------------------------------------ helpers
function prim(model, shape, params, bone, pos = [0, 0, 0], rot = [0, 0, 0], opts = {}) {
  return model.add(new Prim(shape, params, mat(pos, rot, bw(bone)), { bone, ...opts }));
}
function cone(model, boneA, a, boneB, b, ra, rb, opts = {}) {
  const pa = toWorld(B[boneA], a), pb = toWorld(B[boneB], b);
  return model.add(new Prim('rcone', { a: pa.toArray(), b: pb.toArray(), ra, rb }, null, { bone: opts.bone ?? boneA, ...opts }));
}
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const C = {
  skin: [0.39, 0.26, 0.19],
  shirt: [0.25, 0.28, 0.23],
  jeans: [0.17, 0.22, 0.32],
  shoe: [0.20, 0.20, 0.21],
  sole: [0.82, 0.80, 0.76],
  hair: [0.05, 0.04, 0.035],
  cap: [0.30, 0.31, 0.22],
  belt: [0.14, 0.09, 0.06],
};
const fold = (amp, fx = 9, fy = 16) => (x, y, z) => amp * (fbm(noise, x * fx, y * fy, z * fx, 3) * 0.8 + 0.25 * noise2(x * 40, y * 22, z * 40));

// ================================================================== TORSO (shirt, sleeves, jeans, shoes)
function buildTorso() {
  const m = new Model();
  const shirt = { mat: 'shirt', color: C.shirt, disp: fold(0.0022, 7, 12), dispAmp: 0.004 };
  const jeans = { mat: 'pants', color: C.jeans, disp: fold(0.0025, 12, 10), dispAmp: 0.004 };
  prim(m, 'ellipsoid', { rx: 0.170, ry: 0.12, rz: 0.12 }, 'pelvis', [0, 0.02, -0.005], [0, 0, 0], { ...jeans, k: 0.04, sigma: 0.06 });
  for (const s of ['L', 'R']) {
    cone(m, 'thigh' + s, [0, 0, 0], 'thigh' + s, [0, -0.42, 0], 0.086, 0.058, { ...jeans, k: 0.05, sigma: 0.07 });
    prim(m, 'sphere', { r: 0.056 }, 'shin' + s, [0, 0.0, 0.004], [0, 0, 0], { ...jeans, k: 0.03, sigma: 0.05 }); // knee
    cone(m, 'shin' + s, [0, 0, 0], 'shin' + s, [0, -0.39, 0], 0.054, 0.050, { ...jeans, k: 0.03, sigma: 0.05 });
    // sneakers: upper + sole
    prim(m, 'box', { hx: 0.047, hy: 0.042, hz: 0.128, r: 0.036 }, 'foot' + s, [0, -0.035, 0.062], [0, 0, 0], { mat: 'shoe', color: C.shoe, k: 0.012, sigma: 0.03 });
    prim(m, 'box', { hx: 0.051, hy: 0.014, hz: 0.136, r: 0.012 }, 'foot' + s, [0, -0.072, 0.064], [0, 0, 0], { mat: 'shoe', color: C.sole, k: 0.004, sigma: 0.03 });
  }
  // untucked hem, belly, back, chest
  prim(m, 'ellipsoid', { rx: 0.168, ry: 0.07, rz: 0.135 }, 'pelvis', [0, 0.11, 0.0], [0, 0, 0], { ...shirt, k: 0.03, sigma: 0.06 });
  prim(m, 'ellipsoid', { rx: 0.158, ry: 0.17, rz: 0.118 }, 'spine', [0, 0.08, 0.012], [0, 0, 0], { ...shirt, k: 0.06, sigma: 0.08 });
  prim(m, 'ellipsoid', { rx: 0.172, ry: 0.15, rz: 0.112 }, 'chest', [0, 0.07, -0.002], [0, 0, 0], { ...shirt, k: 0.06, sigma: 0.08 });
  for (const s of [1, -1]) prim(m, 'ellipsoid', { rx: 0.075, ry: 0.06, rz: 0.045 }, 'chest', [0.07 * s, 0.10, 0.06], [0, 0, 0], { ...shirt, k: 0.04, sigma: 0.06 });
  cone(m, 'chest', [0.142, 0.150, -0.02], 'chest', [-0.142, 0.150, -0.02], 0.056, 0.056, { ...shirt, k: 0.06, sigma: 0.08 });
  cone(m, 'chest', [0, 0.165, -0.02], 'neck', [0, 0.02, -0.004], 0.08, 0.066, { ...shirt, k: 0.05, sigma: 0.05 });
  // crew collar
  prim(m, 'torus', { R: 0.062, r: 0.011 }, 'neck', [0, 0.01, 0.004], [14, 0, 0], { ...shirt, disp: null, dispAmp: 0, k: 0.012, sigma: 0.03, bone: 'neck' });
  // long sleeves following upper arm and forearm, with a cuff at the wrist
  for (const s of ['L', 'R']) {
    const ua = 'upperArm' + s, fa = 'forearm' + s;
    prim(m, 'sphere', { r: 0.060 }, ua, [0, -0.015, 0], [0, 0, 0], { ...shirt, bone: ua, k: 0.035, sigma: 0.06 });
    cone(m, ua, [0, -0.015, 0], ua, [0, -0.29, 0.004], 0.058, 0.048, { ...shirt, bone: ua, k: 0.035, sigma: 0.045 });
    prim(m, 'sphere', { r: 0.048 }, fa, [0, 0.004, -0.01], [0, 0, 0], { ...shirt, bone: fa, k: 0.03, sigma: 0.04 }); // elbow
    cone(m, fa, [0, 0, 0], fa, [0, -0.215, 0], 0.050, 0.040, { ...shirt, bone: fa, k: 0.03, sigma: 0.045 });
    prim(m, 'torus', { R: 0.034, r: 0.008 }, fa, [0, -0.215, 0], [0, 0, 0], { ...shirt, disp: null, dispAmp: 0, bone: fa, k: 0.012, sigma: 0.03 });
    // cuff opening (the hand mesh continues inside)
    cone(m, fa, [0, -0.21, 0], fa, [0, -0.32, 0], 0.03, 0.03, { op: 'sub', k: 0.006, bone: fa });
  }
  return m;
}

// ================================================================== HANDS (skin, from the cuff down)
function buildHand(side) {
  const m = new Model();
  const s = side === 'L' ? 1 : -1;
  const sk = { mat: 'skin', color: C.skin };
  const fa = 'forearm' + side, hd = 'hand' + side;
  cone(m, fa, [0, -0.17, 0], fa, [0, -0.235, 0], 0.031, 0.027, { ...sk, k: 0.012, sigma: 0.03 });
  cone(m, fa, [0, -0.235, 0], hd, [0, -0.02, 0], 0.027, 0.025, { ...sk, bone: hd, k: 0.012, sigma: 0.03 });
  prim(m, 'box', { hx: 0.0165, hy: 0.05, hz: 0.042, r: 0.015 }, hd, [0.001 * s, -0.052, 0.001], [0, 0, 0], { ...sk, k: 0.014, sigma: 0.025 });
  prim(m, 'ellipsoid', { rx: 0.014, ry: 0.03, rz: 0.017 }, hd, [-0.010 * s, -0.036, 0.022], [0, 0, 12 * s], { ...sk, k: 0.01, sigma: 0.02 });
  prim(m, 'ellipsoid', { rx: 0.012, ry: 0.034, rz: 0.012 }, hd, [-0.009 * s, -0.055, -0.03], [0, 0, 0], { ...sk, k: 0.01, sigma: 0.02 });
  for (const fn of ['Index', 'Middle', 'Ring', 'Pinky']) {
    const b1 = fn + side + '1', b2 = fn + side + '2';
    const lp = B[b1].len, ld = B[b2].len;
    const r0 = fn === 'Pinky' ? 0.0078 : fn === 'Index' ? 0.0092 : 0.0095;
    cone(m, b1, [0, 0.006, 0], b1, [0, -lp, 0], r0 + 0.0008, r0 * 0.94, { ...sk, k: 0.006, sigma: 0.012 });
    prim(m, 'sphere', { r: r0 * 1.05 }, b1, [0.003 * s, 0.0, 0], [0, 0, 0], { ...sk, k: 0.005, sigma: 0.01 });
    const mid = ld * 0.55;
    cone(m, b2, [0, 0, 0], b2, [0, -mid, 0], r0 * 0.94, r0 * 0.86, { ...sk, k: 0.004, sigma: 0.008 });
    const tip = toWorld(B[b2], [-0.004 * s, -ld, 0]), midW = toWorld(B[b2], [0, -mid, 0]);
    m.add(new Prim('rcone', { a: midW.toArray(), b: tip.toArray(), ra: r0 * 0.86, rb: r0 * 0.78 }, null, { ...sk, bone: b2, k: 0.004, sigma: 0.008 }));
    prim(m, 'box', { hx: 0.0015, hy: 0.006, hz: r0 * 0.62, r: 0.0012 }, b2, [r0 * 0.78 * s, -ld + 0.005, 0], [0, 0, 0], { mat: 'nail', color: [0.62, 0.48, 0.42], k: 0.002, sigma: 0.006 });
  }
  const t1 = 'Thumb' + side + '1', t2 = 'Thumb' + side + '2';
  cone(m, hd, [-0.004 * s, -0.016, 0.022], t1, [0, -0.044, 0], 0.016, 0.0105, { ...sk, bone: t1, k: 0.012, sigma: 0.02 });
  cone(m, t2, [0, 0, 0], t2, [0, -0.046, 0], 0.0105, 0.0085, { ...sk, k: 0.004, sigma: 0.01 });
  return m;
}

// ================================================================== HEAD (younger build, same rig layout)
const hp = (model, shape, params, pos, rot, opts) => prim(model, shape, params, 'head', pos, rot, opts);
function buildHead() {
  const m = new Model();
  const sk = { mat: 'skin', color: C.skin };
  hp(m, 'ellipsoid', { rx: 0.073, ry: 0.092, rz: 0.097 }, [0, 0.110, -0.016], [8, 0, 0], { ...sk, k: 0.02 });
  hp(m, 'ellipsoid', { rx: 0.065, ry: 0.062, rz: 0.058 }, [0, 0.122, 0.030], [0, 0, 0], { ...sk, k: 0.03 });
  hp(m, 'ellipsoid', { rx: 0.056, ry: 0.068, rz: 0.062 }, [0, 0.050, 0.030], [0, 0, 0], { ...sk, k: 0.03 });
  for (const s of [1, -1]) hp(m, 'ellipsoid', { rx: 0.024, ry: 0.0105, rz: 0.013 }, [0.031 * s, 0.1035, 0.0870], [0, 0, -9 * s], { ...sk, k: 0.014 });
  hp(m, 'ellipsoid', { rx: 0.011, ry: 0.013, rz: 0.011 }, [0, 0.099, 0.0920], [0, 0, 0], { ...sk, k: 0.012 });
  for (const s of [1, -1]) {
    hp(m, 'ellipsoid', { rx: 0.022, ry: 0.017, rz: 0.022 }, [0.050 * s, 0.068, 0.062], [0, 20 * s, 0], { ...sk, k: 0.02 });
    hp(m, 'ellipsoid', { rx: 0.022, ry: 0.025, rz: 0.019 }, [0.035 * s, 0.044, 0.068], [0, 15 * s, 0], { ...sk, k: 0.02 });
    hp(m, 'ellipsoid', { rx: 0.020, ry: 0.024, rz: 0.022 }, [0.041 * s, 0.008, 0.052], [0, 15 * s, 0], { ...sk, k: 0.022 });
    // firm jawline
    cone(m, 'head', [0.022 * s, -0.030, 0.074], 'head', [0.056 * s, -0.002, 0.008], 0.017, 0.018, { ...sk, k: 0.018 });
    cone(m, 'head', [0.056 * s, -0.002, 0.008], 'head', [0.063 * s, 0.045, -0.012], 0.018, 0.018, { ...sk, k: 0.02 });
  }
  // broader nose
  cone(m, 'head', [0, 0.090, 0.092], 'head', [0, 0.058, 0.112], 0.0072, 0.0105, { ...sk, k: 0.008 });
  hp(m, 'sphere', { r: 0.0135 }, [0, 0.050, 0.114], [0, 0, 0], { ...sk, k: 0.008 });
  for (const s of [1, -1]) hp(m, 'ellipsoid', { rx: 0.010, ry: 0.0085, rz: 0.0095 }, [0.0150 * s, 0.0470, 0.104], [0, 15 * s, 0], { ...sk, k: 0.006 });
  // fuller lips
  hp(m, 'ellipsoid', { rx: 0.023, ry: 0.011, rz: 0.012 }, [0, 0.027, 0.099], [0, 0, 0], { ...sk, k: 0.012 });
  hp(m, 'ellipsoid', { rx: 0.0175, ry: 0.0068, rz: 0.0085 }, [0, 0.0215, 0.1035], [0, 0, 0], { ...sk, k: 0.008, mat: 'lip' });
  hp(m, 'ellipsoid', { rx: 0.0185, ry: 0.0078, rz: 0.0085 }, [0, 0.0094, 0.0995], [0, 0, 0], { ...sk, k: 0.009, mat: 'lip' });
  hp(m, 'ellipsoid', { rx: 0.025, ry: 0.022, rz: 0.021 }, [0, -0.024, 0.0870], [0, 0, 0], { ...sk, k: 0.016 });
  hp(m, 'ellipsoid', { rx: 0.036, ry: 0.024, rz: 0.032 }, [0, -0.034, 0.038], [-20, 0, 0], { ...sk, k: 0.03 });
  cone(m, 'head', [0, 0.03, -0.012], 'neck', [0, -0.01, 0.0], 0.054, 0.060, { ...sk, bone: 'neck', k: 0.03, sigma: 0.05 });
  for (const s of [1, -1]) {
    const eo = { ...sk, mat: 'ear', k: 0.006 };
    hp(m, 'ellipsoid', { rx: 0.009, ry: 0.031, rz: 0.019 }, [0.078 * s, 0.072, -0.016], [-12, 22 * s, 7 * s], eo);
    hp(m, 'torus', { R: 0.0165, r: 0.0040 }, [0.083 * s, 0.077, -0.018], [0, 22 * s, 90 * s + 8 * s], { ...eo, k: 0.004 });
    hp(m, 'ellipsoid', { rx: 0.007, ry: 0.016, rz: 0.011 }, [0.088 * s, 0.072, -0.014], [-12, 22 * s, 7 * s], { op: 'sub', k: 0.004 });
  }
  for (const s of [1, -1]) hp(m, 'sphere', { r: 0.0150 }, [EYE.x * s, EYE.y, EYE.z + 0.0015], [0, 0, 0], { op: 'sub', k: 0.004 });
  for (const s of [1, -1]) hp(m, 'ellipsoid', { rx: 0.0040, ry: 0.0028, rz: 0.0050 }, [0.0080 * s, 0.0420, 0.108], [20, 0, 0], { op: 'sub', k: 0.002 });
  hp(m, 'box', { hx: 0.0175, hy: 0.0009, hz: 0.012, r: 0.0008 }, [0, MOUTH_Y, 0.110], [0, 0, 0], { op: 'sub', k: 0.0016 });
  return m;
}
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
function buildBrows(headModel) {
  const m = new Model();
  const o = { mat: 'hair', color: C.hair, k: 0.004 };
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const P = [[0.011, 0.1065], [0.022, 0.1090], [0.033, 0.1095], [0.044, 0.1070], [0.053, 0.1025]].map(([x, y]) => [x * s, y, surfZ(headModel, x * s, y) + 0.0009]);
    for (let i = 0; i < P.length - 1; i++) {
      const bone = i < 2 ? 'browIn' + side : 'browOut' + side;
      const ra = [0.0032, 0.0034, 0.0032, 0.0027, 0.0021][i], rb = [0.0034, 0.0032, 0.0027, 0.0021, 0.0016][i];
      cone(m, 'head', P[i], 'head', P[i + 1], ra, rb, { ...o, bone });
    }
  }
  return m;
}
// close-cropped hair below the cap line (sides and back), as a thin shell over the skull
const headInv = new THREE.Matrix4().copy(B.head.world).invert();
function hairRegion(p) {
  const top = 0.122 - 0.012 * smooth(0.0, -0.08, p.z); // cap covers above this
  const bottom = 0.030 + 0.03 * smooth(-0.02, 0.04, p.z);
  const front = p.z - 0.040;
  const ear = Math.hypot(Math.abs(p.x) - 0.080, (p.y - 0.070) * 0.62, (p.z + 0.012) * 0.95) - 0.024;
  return Math.max(p.y - top, bottom - p.y, front, -ear);
}
function buildHair(headModel) {
  const m = new Model();
  const f = (x, y, z) => {
    const p = V(x, y, z).applyMatrix4(headInv);
    const hd = headModel.eval(x, y, z);
    return Math.max(Math.max(hd - 0.0035, -(hd + 0.001)), hairRegion(p));
  };
  const cen = toWorld(B.head, [0, 0.09, -0.01]);
  m.add(new Prim('fn', { f, bound: 0.14, center: [0, 0, 0] }, new THREE.Matrix4(), { mat: 'hair', color: C.hair, bone: 'head', k: 0 }));
  m.prims[0].cx = cen.x; m.prims[0].cy = cen.y; m.prims[0].cz = cen.z; m.prims[0].R = 0.14;
  return m;
}
// baseball cap: crown shell over the skull + curved brim, rigid on the head bone
function buildCap(headModel) {
  const m = new Model();
  const cc = [0, 0.126, -0.014]; // crown centre (head local)
  const f = (x, y, z) => {
    const p = V(x, y, z).applyMatrix4(headInv);
    const qx = p.x - cc[0], qy = p.y - cc[1], qz = p.z - cc[2];
    const e = Math.hypot(qx / 0.086, qy / 0.088, qz / 0.108);
    const shell = Math.max((e - 1) * 0.08, -(Math.hypot(qx / 0.080, qy / 0.082, qz / 0.102) - 1) * 0.075);
    return Math.max(shell, -(qy + 0.010)); // open at the band
  };
  const c = toWorld(B.head, cc);
  m.add(new Prim('fn', { f, bound: 0.13, center: [0, 0, 0] }, new THREE.Matrix4(), { mat: 'cap', color: C.cap, bone: 'head', k: 0 }));
  m.prims[0].cx = c.x; m.prims[0].cy = c.y; m.prims[0].cz = c.z; m.prims[0].R = 0.13;
  const fb = (x, y, z) => {
    const p = V(x, y, z).applyMatrix4(headInv);
    const bz = p.z - 0.085;
    const yy = p.y - (0.118 + 0.10 * p.x * p.x - 0.12 * Math.max(0, bz)); // curved, slightly dropped brim
    const slab = Math.abs(yy) - 0.0032;
    const shape = Math.hypot(p.x / 0.078, bz / 0.075) - 1;
    return Math.max(slab, shape * 0.07, 0.06 - p.z);
  };
  const cb = toWorld(B.head, [0, 0.11, 0.12]);
  m.add(new Prim('fn', { f: fb, bound: 0.11, center: [0, 0, 0] }, new THREE.Matrix4(), { mat: 'cap', color: [C.cap[0] * 0.9, C.cap[1] * 0.9, C.cap[2] * 0.9], bone: 'head', k: 0 }));
  m.prims[1].cx = cb.x; m.prims[1].cy = cb.y; m.prims[1].cz = cb.z; m.prims[1].R = 0.11;
  const top = toWorld(B.head, [cc[0], cc[1] + 0.088, cc[2]]);
  m.add(new Prim('sphere', { r: 0.008 }, new THREE.Matrix4().makeTranslation(top.x, top.y, top.z), { mat: 'cap', color: C.cap, bone: 'head', k: 0.002 }));
  return m;
}

// ================================================================== paint
function headPaint(wp, col, best) {
  const p = wp.clone().applyMatrix4(headInv);
  const g = (cx, cy, cz, r) => Math.exp(-((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2) / (r * r));
  let c = [...C.skin];
  const mix = (t, tgt) => { for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - t) + tgt[i] * t; };
  for (const s of [1, -1]) mix(0.18 * g(0.042 * s, 0.05, 0.075, 0.024), [0.46, 0.25, 0.18]);
  if (best.mat === 'lip') mix(0.55, [0.30, 0.17, 0.15]);
  if (best.mat === 'ear') mix(0.2, [0.36, 0.22, 0.16]);
  for (const s of [1, -1]) mix(0.3 * g(EYE.x * s, EYE.y - 0.006, EYE.z + 0.01, 0.014), [0.28, 0.18, 0.14]);
  // short beard / stubble along the jaw, chin and upper lip
  const jawBand = smooth(0.045, 0.02, p.y) * smooth(-0.005, 0.03, p.z) * (1 - smooth(0.06, 0.075, Math.abs(p.x)));
  const lipBand = smooth(0.012, 0.02, Math.abs(p.y - 0.034)) < 1 ? (1 - smooth(0.004, 0.009, Math.abs(p.y - 0.034))) * (1 - smooth(0.02, 0.03, Math.abs(p.x))) * smooth(0.08, 0.1, p.z) : 0;
  const stub = Math.max(jawBand, lipBand) * (best.mat === 'lip' ? 0 : 1);
  mix(0.72 * stub * (0.75 + 0.25 * noise(p.x * 800, p.y * 800, p.z * 800)), [0.07, 0.05, 0.045]);
  { const hr = hairRegion(p); const t = Math.max(0, Math.min(1, (-hr + 0.002) / 0.006)); mix(0.6 * t, [0.08, 0.06, 0.05]); }
  const mn = noise(p.x * 300, p.y * 300, p.z * 300) * 0.02;
  return c.map((v) => v + mn);
}
function clothPaint(wp, col, best) {
  let c = [...col];
  if (best.mat === 'pants') {
    // denim: fine diagonal twill + lighter wear on thighs and knees
    const tw = 0.5 + 0.5 * Math.sin((wp.x + wp.y) * 900 + noise(wp.x * 80, wp.y * 80, wp.z * 80) * 3);
    const wear = smooth(0.2, 0.7, fbm(noise2, wp.x * 9, wp.y * 6, wp.z * 9, 2) + 0.4) * 0.35;
    c = c.map((v, i) => v * (0.9 + 0.12 * tw) + wear * [0.10, 0.12, 0.14][i]);
  } else if (best.mat === 'shirt') {
    const h = 0.97 + 0.05 * noise(wp.x * 60, wp.y * 60, wp.z * 60);
    c = c.map((v) => v * h);
  } else if (best.mat === 'shoe') {
    c = c.map((v) => v * (0.95 + 0.08 * noise(wp.x * 200, wp.y * 200, wp.z * 200)));
  }
  return c;
}
function handPaint(wp, col) {
  const c = [...col];
  c[0] += noise(wp.x * 200, wp.y * 200, wp.z * 200) * 0.02;
  return c;
}

// ================================================================== bake
const MATS = ['skin', 'shirt', 'pants', 'shoe', 'hair', 'lip', 'ear', 'nail', 'cap', 'belt'];
function bake(name, model, h, opts = {}) {
  const t0 = Date.now();
  const bb = opts.bounds || model.bounds(0.015);
  let mesh = surfaceNets(model, { h, min: bb.min, max: bb.max, project: 3 });
  const rawTris = mesh.indices.length / 3;
  if (opts.tris) mesh = simplifyMesh(mesh, opts.tris, opts.err || 0.0004);
  const P = mesh.positions, N = mesh.normals;
  const nv = P.length / 3;
  const color = new Uint8Array(nv * 4);
  const skinIndex = new Uint8Array(nv * 4);
  const skinWeight = new Uint8Array(nv * 4);
  const matId = new Uint8Array(nv);
  const aoModel = opts.aoModel || model;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const contrib = model.contributions(x, y, z);
    let dmin = 1e9, best = null;
    for (const [p, d] of contrib) { const dd = d + p.paintBias; if (dd < dmin) { dmin = dd; best = p; } }
    const acc = {};
    let wmin = 1e9;
    for (const [p, d] of contrib) if (p.bone && !p.noWeight) wmin = Math.min(wmin, d + p.weightBias);
    for (const [p, d] of contrib) {
      if (!p.bone || p.noWeight) continue;
      const t = (d + p.weightBias - wmin) / p.sigma;
      if (t >= 1) continue;
      acc[p.bone] = (acc[p.bone] || 0) + (1 - t) * (1 - t);
    }
    let wl = Object.entries(acc);
    if (opts.weightFn) wl = opts.weightFn(V(x, y, z), wl);
    wl.sort((a, b) => b[1] - a[1]);
    wl = wl.slice(0, 4);
    const sum = wl.reduce((s, e) => s + e[1], 0) || 1;
    const qs = wl.map((e) => Math.floor((e[1] / sum) * 255));
    qs[0] += 255 - qs.reduce((a, b) => a + b, 0);
    for (let i = 0; i < wl.length; i++) { skinIndex[v * 4 + i] = B[wl[i][0]].index; skinWeight[v * 4 + i] = qs[i]; }
    let col = best.color || [1, 0, 1];
    if (opts.paint) col = opts.paint(V(x, y, z), col, best);
    const ao = sdfAO(aoModel, x, y, z, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], opts.aoScale || 0.008, 5);
    color[v * 4] = Math.round(Math.max(0, Math.min(1, col[0])) * 255);
    color[v * 4 + 1] = Math.round(Math.max(0, Math.min(1, col[1])) * 255);
    color[v * 4 + 2] = Math.round(Math.max(0, Math.min(1, col[2])) * 255);
    color[v * 4 + 3] = Math.round((opts.alphaFn ? opts.alphaFn(V(x, y, z)) : ao) * 255);
    matId[v] = Math.max(0, MATS.indexOf(best.mat));
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
      matId: { data: matId, itemSize: 1, type: 'u8' },
    },
    index: mesh.indices,
  };
}

// face weights (jaw, mouth corners, brows, cheeks) — same scheme as the grandpa
const W_FACE = (wp, wl) => {
  const g = (p, c, r) => Math.exp(-((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2) / (r * r));
  const lp = wp.clone().applyMatrix4(headInv).toArray();
  const [x, y, z] = lp;
  const out = new Map(wl);
  const headW = out.get('head') || 0;
  if (headW <= 0) return wl;
  const ax = Math.abs(x);
  const lineY = MOUTH_Y + 0.0002 + Math.max(0, ax - 0.022) * 0.9 + Math.max(0, 0.07 - z) * 0.25;
  const band = 0.0025 + Math.max(0, ax - 0.02) * 0.35 + Math.max(0, 0.08 - z) * 0.15;
  let jaw = smooth(lineY + band * 0.2, lineY - band, y) * smooth(-0.01, 0.035, z) * (1 - smooth(0.062, 0.075, ax));
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
const headOnly = () => [['head', 1]];

const torso = buildTorso();
const handL = buildHand('L'), handR = buildHand('R');
const headM = buildHead();
const all = new Model();
for (const mm of [torso, handL, handR, headM]) for (const p of mm.prims) if (p.op === 'add') all.add(p);
const headBounds = (r) => { const c = toWorld(B.head, [0, 0.09, 0.0]); return { min: [c.x - r, c.y - r, c.z - r], max: [c.x + r, c.y + r, c.z + r] }; };

const meshes = [];
meshes.push(bake('torso', torso, 0.0062, { tris: 30000, err: 0.0012, aoModel: all, aoScale: 0.02, paint: clothPaint }));
meshes.push(bake('armL', handL, 0.0026, { tris: 9000, err: 0.0006, aoModel: all, aoScale: 0.01, paint: handPaint }));
meshes.push(bake('armR', handR, 0.0026, { tris: 9000, err: 0.0006, aoModel: all, aoScale: 0.01, paint: handPaint }));
meshes.push(bake('head', headM, 0.0016, { tris: 26000, err: 0.0003, aoModel: all, aoScale: 0.006, weightFn: W_FACE, paint: headPaint }));
meshes.push(bake('brows', buildBrows(headM), 0.0009, { tris: 2000, err: 0.0002, aoScale: 0.003 }));
meshes.push(bake('hair', buildHair(headM), 0.0014, { tris: 9000, err: 0.0004, weightFn: headOnly, bounds: headBounds(0.13), aoModel: all, aoScale: 0.004 }));
meshes.push(bake('cap', buildCap(headM), 0.0018, { tris: 7000, err: 0.0004, weightFn: headOnly, bounds: headBounds(0.17), aoScale: 0.01 }));

const boneOut = bones.map((b) => {
  const parentWorld = b.parent ? B[b.parent].world : new THREE.Matrix4();
  const local = parentWorld.clone().invert().multiply(b.world);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  local.decompose(p, q, s);
  return { name: b.name, parent: b.parent, p: p.toArray().map((v) => +v.toFixed(6)), q: q.toArray().map((v) => +v.toFixed(6)) };
});
const r = writePack(OUT, meshes, { bones: boneOut, eye: EYE, mouthY: MOUTH_Y, bindCurl: BIND_CURL, headScale: 1.0 });
console.log('wrote', OUT, (r.bytes / 1e6).toFixed(2), 'MB');
for (const n of ['head', 'eyeL', 'upperArmL', 'handL', 'handR', 'footL']) console.log(n.padEnd(10), posOf(B[n]).toArray().map((v) => v.toFixed(3)).join(', '));
