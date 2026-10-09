// Bakes the white extended-cab pickup. Truck space: origin on the ground at the
// truck centre, front = -X, driver side = +Z, up = +Y. Output: assets/meshes/truck.{json,bin}
import * as THREE from 'three';
import { fileURLToPath } from 'node:url';
import { Prim, Model, mat } from './lib/sdf.mjs';
import { surfaceNets, sdfAO } from './lib/surfacenets.mjs';
import { writePack, fixWinding } from './lib/writer.mjs';
import { simplifyMesh } from './lib/simplify.mjs';
import { createNoise3D } from './lib/noise.mjs';

const OUT = fileURLToPath(new URL('../assets/meshes/truck', import.meta.url));
const noise = createNoise3D(3);

// material ids (shader looks these up)
export const M = { paint: 0, black: 1, interior: 2, chrome: 3, lensClear: 4, lensAmber: 5, lensRed: 6, alu: 7, rubber: 8, under: 9, grille: 10, seat: 11, dash: 12, red: 13 };
const COL = {
  [M.paint]: [0.86, 0.86, 0.84], [M.black]: [0.05, 0.05, 0.055], [M.interior]: [0.16, 0.16, 0.165], [M.chrome]: [0.8, 0.8, 0.82],
  [M.lensClear]: [0.85, 0.87, 0.9], [M.lensAmber]: [0.95, 0.55, 0.12], [M.lensRed]: [0.7, 0.06, 0.05], [M.alu]: [0.72, 0.73, 0.74],
  [M.rubber]: [0.04, 0.04, 0.04], [M.under]: [0.08, 0.08, 0.08], [M.grille]: [0.12, 0.12, 0.13], [M.seat]: [0.13, 0.13, 0.14],
  [M.dash]: [0.10, 0.10, 0.11], [M.red]: [0.65, 0.07, 0.05],
};

// ------------------------------------------------------------------ dimensions
export const T = {
  frontX: -2.72, rearX: 2.70, halfW: 0.985, belt: 1.29, roof: 1.86, rocker: 0.50,
  axleF: -1.70, axleR: 1.60, wheelR: 0.385, track: 0.83, archR: 0.47,
  cabFront: -1.02, cabBack: 0.97, bedFront: 1.03,
  frontWin: { x0: -0.86, x1: 0.06, y0: 1.30, y1: 1.79 },
  rearWin: { x0: 0.17, x1: 0.84 },
  doorFront: { x0: -0.94, x1: 0.115 },
  doorRear: { x0: 0.13, x1: 0.93 },
  mirrorPivot: [-0.80, 1.36, 0.99],
  towHook: [-2.80, 0.43, 0.66],
};

const add = (model, shape, params, pos, rot, mid, opts = {}) =>
  model.add(new Prim(shape, params, mat(pos, rot), { mat: mid, color: COL[mid], k: opts.k ?? 0.0, ...opts }));
const sub = (model, shape, params, pos, rot, mid, opts = {}) =>
  model.add(new Prim(shape, params, mat(pos, rot), { op: 'sub', mat: mid, color: mid != null ? COL[mid] : null, k: opts.k ?? 0.0, ...opts }));
const fnPrim = (model, f, center, R, mid, opts = {}) => {
  const p = new Prim('fn', { f, bound: R, center: [0, 0, 0] }, new THREE.Matrix4(), { mat: mid, color: mid != null ? COL[mid] : null, k: 0, ...opts });
  p.cx = center[0]; p.cy = center[1]; p.cz = center[2]; p.R = R;
  return model.add(p);
};
const boxSD = (x, y, z, cx, cy, cz, hx, hy, hz, r = 0) => {
  const qx = Math.abs(x - cx) - (hx - r), qy = Math.abs(y - cy) - (hy - r), qz = Math.abs(z - cz) - (hz - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
// windshield plane (outward normal points forward/up)
const WS = (() => { const p0 = [-1.06, 1.24], p1 = [-0.40, 1.855]; const dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const l = Math.hypot(dx, dy); return { p0, n: [-dy / l, dx / l] }; })();
const wsPlane = (x, y) => (x - WS.p0[0]) * WS.n[0] + (y - WS.p0[1]) * WS.n[1];
// tumblehome: side glass leans inward
const TH = (() => { const a = [0.985, 1.29], b = [0.835, 1.855]; const dz = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dz, dy); return { a, n: [dy / l, -dz / l] }; })();
const sidePlane = (y, z) => (Math.abs(z) - TH.a[0]) * TH.n[0] + (y - TH.a[1]) * TH.n[1];

// ================================================================== body
function buildBody() {
  const m = new Model();
  // rear section: cab lower + bed sides
  add(m, 'box', { hx: (T.rearX + 0.95) / 2, hy: (T.belt - T.rocker) / 2, hz: T.halfW, r: 0.055 }, [(T.rearX - 0.95) / 2, (T.belt + T.rocker) / 2, 0], [0, 0, 0], M.paint);
  // front section: fenders + hood (hood slopes down to the front)
  add(m, 'box', { hx: 0.93, hy: 0.33, hz: T.halfW - 0.005, r: 0.075 }, [-1.83, 0.835, 0], [0, 0, 2.2], M.paint, { k: 0.04 });
  // hood centre bulge
  add(m, 'box', { hx: 0.86, hy: 0.04, hz: 0.42, r: 0.04 }, [-1.83, 1.13, 0], [0, 0, 2.2], M.paint, { k: 0.08 });
  // cab greenhouse (windshield rake + tumblehome)
  fnPrim(m, (x, y, z) => {
    const b = boxSD(x, y, z, (T.cabFront + T.cabBack) / 2, (1.20 + T.roof) / 2, 0, (T.cabBack - T.cabFront) / 2, (T.roof - 1.20) / 2, 1.0, 0.06);
    return Math.max(b, wsPlane(x, y), sidePlane(y, z));
  }, [0, 1.55, 0], 1.4, M.paint, { k: 0.03 });
  // cab interior (hollow shell)
  fnPrim(m, (x, y, z) => {
    const b = boxSD(x, y, z, -0.005, 1.215, 0, 0.93, 0.595, 0.905, 0.04);
    return Math.max(b, wsPlane(x, y) + 0.04, sidePlane(y, z) + 0.035, y - 1.815);
  }, [0, 1.2, 0], 1.6, M.interior, { op: 'sub', k: 0.01 });
  // bed tub
  sub(m, 'box', { hx: (2.62 - T.bedFront) / 2, hy: 0.36, hz: 0.912, r: 0.02 }, [(2.62 + T.bedFront) / 2, 0.80 + 0.36, 0], [0, 0, 0], M.black, { k: 0.005 });
  // gap between cab and bed
  sub(m, 'box', { hx: 0.012, hy: 0.45, hz: 1.2, r: 0.0 }, [1.0, 0.95, 0], [0, 0, 0], M.under, { k: 0 });
  // window openings (black rubber edges)
  for (const s of [1, -1]) {
    const fw = T.frontWin;
    fnPrim(m, (x, y, z) => {
      if (z * s < 0.3) return 1;
      const b = boxSD(x, y, Math.abs(z), (fw.x0 + fw.x1) / 2, (fw.y0 + 1.95) / 2, 1.0, (fw.x1 - fw.x0) / 2, (1.95 - fw.y0) / 2, 0.4, 0.035);
      return Math.max(b, wsPlane(x, y) + 0.085, y - (T.roof - 0.075));
    }, [(fw.x0 + fw.x1) / 2, 1.55, s * 1.0], 0.9, null, { op: 'sub', k: 0.012 });
    const rw = T.rearWin;
    sub(m, 'box', { hx: (rw.x1 - rw.x0) / 2, hy: (T.roof - 0.075 - fw.y0) / 2, hz: 0.4, r: 0.04 }, [(rw.x0 + rw.x1) / 2, (T.roof - 0.075 + fw.y0) / 2, s * 1.0], [0, 0, 0], null, { k: 0.012 });
  }
  // windshield & back window openings
  fnPrim(m, (x, y, z) => {
    const inPlane = Math.abs(wsPlane(x, y)) - 0.25;
    const frame = Math.max(Math.abs(z) - 0.74, 1.335 - y, y - (T.roof - 0.07));
    return Math.max(inPlane, frame);
  }, [-0.72, 1.56, 0], 0.9, null, { op: 'sub', k: 0.02 });
  sub(m, 'box', { hx: 0.25, hy: 0.21, hz: 0.66, r: 0.05 }, [T.cabBack, 1.565, 0], [0, 0, 0], null, { k: 0.015 });
  // wheel arches (inner fender liners in black)
  for (const ax of [T.axleF, T.axleR]) {
    for (const s of [1, -1]) {
      sub(m, 'cyl', { r: T.archR, h: 0.32, rr: 0.03 }, [ax, 0.40, s * 0.98], [90, 0, 0], M.under, { k: 0.03 });
    }
  }
  // flatten the underside a bit
  sub(m, 'box', { hx: 3, hy: 0.2, hz: 0.75, r: 0 }, [0, 0.38, 0], [0, 0, 0], M.under, { k: 0.02 });
  // character lines: shallow crease along the side
  for (const s of [1, -1]) {
    sub(m, 'box', { hx: 2.6, hy: 0.006, hz: 0.02, r: 0.004 }, [0.0, 1.0, s * (T.halfW + 0.014)], [0, 0, 0], M.paint, { k: 0.01 });
  }

  // ----- bolt-ons that share the body mesh
  // front bumper (grey)
  add(m, 'box', { hx: 0.09, hy: 0.13, hz: 1.0, r: 0.04 }, [T.frontX - 0.04, 0.50, 0], [0, 0, 0], M.chrome, { k: 0.0 });
  add(m, 'box', { hx: 0.12, hy: 0.05, hz: 0.9, r: 0.02 }, [T.frontX + 0.02, 0.36, 0], [0, 0, 0], M.black, { k: 0.0 }); // air dam
  // grille + headlights + corner lamps
  add(m, 'box', { hx: 0.04, hy: 0.19, hz: 0.6, r: 0.02 }, [T.frontX + 0.005, 0.87, 0], [0, 0, 0], M.grille, { k: 0 });
  add(m, 'box', { hx: 0.03, hy: 0.025, hz: 0.62, r: 0.012 }, [T.frontX - 0.02, 0.87, 0], [0, 0, 0], M.chrome, { k: 0 }); // grille bar
  add(m, 'box', { hx: 0.03, hy: 0.012, hz: 0.62, r: 0.006 }, [T.frontX - 0.01, 1.055, 0], [0, 0, 0], M.chrome, { k: 0 });
  for (const s of [1, -1]) {
    add(m, 'box', { hx: 0.04, hy: 0.095, hz: 0.15, r: 0.02 }, [T.frontX + 0.01, 0.955, s * 0.75], [0, 0, 0], M.lensClear, { k: 0 });
    add(m, 'box', { hx: 0.07, hy: 0.065, hz: 0.06, r: 0.03 }, [T.frontX + 0.04, 0.92, s * 0.94], [0, 0, 0], M.lensAmber, { k: 0 });
    // taillights
    add(m, 'box', { hx: 0.03, hy: 0.17, hz: 0.07, r: 0.015 }, [T.rearX + 0.0, 1.10, s * 0.92], [0, 0, 0], M.lensRed, { k: 0 });
  }
  // rear bumper (chrome step) + hitch receiver
  add(m, 'box', { hx: 0.1, hy: 0.1, hz: 0.99, r: 0.03 }, [T.rearX + 0.07, 0.52, 0], [0, 0, 0], M.chrome, { k: 0 });
  add(m, 'box', { hx: 0.12, hy: 0.035, hz: 0.035, r: 0.005 }, [T.rearX + 0.18, 0.45, 0], [0, 0, 0], M.under, { k: 0 });
  // tailgate handle recess + tailgate top cap
  add(m, 'box', { hx: 0.02, hy: 0.04, hz: 0.12, r: 0.01 }, [T.rearX + 0.0, 1.17, 0], [0, 0, 0], M.black, { k: 0 });
  // toolbox across the bed
  add(m, 'box', { hx: 0.24, hy: 0.12, hz: 0.985, r: 0.015 }, [T.bedFront + 0.28, T.belt + 0.10, 0], [0, 0, 0], M.alu, { k: 0 });
  // door handles (front doors)
  for (const s of [1, -1]) {
    add(m, 'box', { hx: 0.085, hy: 0.032, hz: 0.02, r: 0.012 }, [-0.035, 1.125, s * (T.halfW + 0.008)], [0, 0, 0], M.black, { k: 0 });
    sub(m, 'box', { hx: 0.065, hy: 0.016, hz: 0.03, r: 0.008 }, [-0.035, 1.122, s * (T.halfW + 0.03)], [0, 0, 0], M.black, { k: 0 });
  }
  // windshield wipers cowl
  add(m, 'box', { hx: 0.07, hy: 0.02, hz: 0.78, r: 0.015 }, [-1.08, 1.215, 0], [0, 0, 2.2], M.black, { k: 0.0 });
  return m;
}

// ================================================================== interior
function buildInterior() {
  const m = new Model();
  // dashboard
  add(m, 'box', { hx: 0.17, hy: 0.14, hz: 0.88, r: 0.05 }, [-0.86, 1.10, 0], [0, 0, -10], M.dash, { k: 0.02 });
  add(m, 'box', { hx: 0.12, hy: 0.06, hz: 0.86, r: 0.04 }, [-0.78, 1.24, 0], [0, 0, -18], M.dash, { k: 0.04 }); // top pad
  add(m, 'box', { hx: 0.07, hy: 0.06, hz: 0.18, r: 0.03 }, [-0.70, 1.22, 0.40], [0, 0, -10], M.dash, { k: 0.04 }); // gauge hood
  // centre console / bench centre
  add(m, 'box', { hx: 0.35, hy: 0.12, hz: 0.16, r: 0.04 }, [-0.25, 0.86, 0.0], [0, 0, 0], M.seat, { k: 0.02 });
  // seats
  for (const s of [1, -1]) {
    const z = s * 0.42;
    add(m, 'box', { hx: 0.27, hy: 0.07, hz: 0.27, r: 0.06 }, [-0.12, 0.88, z], [0, 0, 4], M.seat, { k: 0.03 }); // cushion
    add(m, 'box', { hx: 0.07, hy: 0.33, hz: 0.27, r: 0.06 }, [0.20, 1.22, z], [0, 0, 14], M.seat, { k: 0.03 }); // back
    add(m, 'box', { hx: 0.06, hy: 0.10, hz: 0.14, r: 0.05 }, [0.30, 1.60, z], [0, 0, 10], M.seat, { k: 0.02 }); // headrest
    add(m, 'box', { hx: 0.35, hy: 0.12, hz: 0.3, r: 0.05 }, [-0.10, 0.70, z], [0, 0, 0], M.interior, { k: 0.02 }); // base
  }
  // rear bench
  add(m, 'box', { hx: 0.2, hy: 0.3, hz: 0.82, r: 0.06 }, [0.80, 1.08, 0], [0, 0, 8], M.seat, { k: 0.02 });
  // floor
  add(m, 'box', { hx: 0.95, hy: 0.04, hz: 0.9, r: 0.02 }, [0.0, 0.62, 0], [0, 0, 0], M.interior, { k: 0.02 });
  // door inner panels: armrest on the driver door
  add(m, 'box', { hx: 0.25, hy: 0.035, hz: 0.05, r: 0.02 }, [-0.35, 1.08, 0.865], [0, 0, 0], M.interior, { k: 0.01 });
  // steering column
  add(m, 'rcone', { a: [-0.80, 1.06, 0.40], b: [-0.60, 1.18, 0.40], ra: 0.045, rb: 0.035 }, [0, 0, 0], [0, 0, 0], M.dash, { k: 0.01 });
  return m;
}

function buildSteeringWheel() {
  const m = new Model();
  const c = [-0.60, 1.19, 0.40];
  const rot = [0, 0, 62]; // wheel plane faces the driver (tilted)
  add(m, 'torus', { R: 0.19, r: 0.018 }, c, rot, M.dash, { k: 0 });
  add(m, 'cyl', { r: 0.06, h: 0.03, rr: 0.02 }, c, rot, M.dash, { k: 0.02 });
  for (const a of [0, 120, 240]) {
    const ar = (a + 90) * Math.PI / 180;
    // spokes in the wheel plane
    const mm = mat(c, rot);
    const p1 = new THREE.Vector3(Math.cos(ar) * 0.05, 0, Math.sin(ar) * 0.05).applyMatrix4(mm);
    const p2 = new THREE.Vector3(Math.cos(ar) * 0.18, 0, Math.sin(ar) * 0.18).applyMatrix4(mm);
    m.add(new Prim('rcone', { a: p1.toArray(), b: p2.toArray(), ra: 0.016, rb: 0.012 }, null, { mat: M.dash, color: COL[M.dash], k: 0.01 }));
  }
  return m;
}

// ================================================================== mirror (folds about a vertical hinge)
const MP = T.mirrorPivot;
function buildMirrorBase() {
  const m = new Model();
  add(m, 'box', { hx: 0.09, hy: 0.06, hz: 0.03, r: 0.02 }, [MP[0] - 0.02, MP[1] - 0.01, MP[2] + 0.01], [0, 0, 0], M.black, { k: 0 });
  add(m, 'cyl', { r: 0.025, h: 0.04, rr: 0.01 }, [MP[0], MP[1], MP[2] + 0.035], [0, 0, 0], M.black, { k: 0.01 });
  return m;
}
function buildMirrorHead() {
  const m = new Model();
  // arm out to the head, housing with the glass facing rearwards (+X)
  add(m, 'rcone', { a: [MP[0], MP[1], MP[2] + 0.035], b: [MP[0] - 0.02, MP[1] + 0.02, MP[2] + 0.12], ra: 0.026, rb: 0.024 }, [0, 0, 0], [0, 0, 0], M.black, { k: 0 });
  const hc = [MP[0] - 0.035, MP[1] + 0.065, MP[2] + 0.215];
  add(m, 'box', { hx: 0.045, hy: 0.125, hz: 0.105, r: 0.035 }, hc, [0, 0, 0], M.black, { k: 0.02 });
  add(m, 'ellipsoid', { rx: 0.06, ry: 0.11, rz: 0.09 }, [hc[0] - 0.03, hc[1], hc[2]], [0, 0, 0], M.black, { k: 0.03 });
  // glass recess on the rear face
  sub(m, 'box', { hx: 0.03, hy: 0.105, hz: 0.088, r: 0.015 }, [hc[0] + 0.05, hc[1], hc[2]], [0, 0, 0], M.chrome, { k: 0.004 });
  add(m, 'box', { hx: 0.006, hy: 0.103, hz: 0.086, r: 0.014 }, [hc[0] + 0.027, hc[1], hc[2]], [0, 0, 0], M.chrome, { k: 0 });
  return m;
}
function buildTowHook() {
  const m = new Model();
  const p = T.towHook;
  // red open hook bolted under the bumper
  add(m, 'box', { hx: 0.07, hy: 0.03, hz: 0.035, r: 0.01 }, [p[0] + 0.07, p[1] + 0.03, p[2]], [0, 0, 0], M.red, { k: 0 });
  const tor = new Prim('torus', { R: 0.045, r: 0.014 }, mat([p[0] - 0.01, p[1] - 0.005, p[2]], [90, 0, 0]), { mat: M.red, color: COL[M.red], k: 0.01 });
  m.add(tor);
  // cut the torus open at the top-front
  sub(m, 'box', { hx: 0.03, hy: 0.03, hz: 0.05, r: 0 }, [p[0] - 0.035, p[1] + 0.035, p[2]], [0, 0, 0], null, { k: 0.004 });
  return m;
}

// ================================================================== bake helpers
function bake(name, model, h, opts = {}) {
  const t0 = Date.now();
  const bb = opts.bounds || model.bounds(0.03);
  let mesh = surfaceNets(model, { h, min: bb.min, max: bb.max, project: 3 });
  const raw = mesh.indices.length / 3;
  if (opts.tris) mesh = simplifyMesh(mesh, opts.tris, opts.err || 0.002);
  const P = mesh.positions, N = mesh.normals, nv = P.length / 3;
  const color = new Uint8Array(nv * 4);
  const matId = new Uint8Array(nv);
  const subs = model.prims.filter((p) => p.op === 'sub' && p.color);
  const aoModel = opts.aoModel || model;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let best = null, bd = 1e9;
    for (const p of model.prims) {
      if (p.op !== 'add') continue;
      const d = p.eval(x, y, z);
      if (d < bd) { bd = d; best = p; }
    }
    // carved surfaces take the colour of the carving primitive
    let carve = null, cd = h * 0.75;
    for (const p of subs) {
      const d = Math.abs(p.eval(x, y, z));
      if (d < cd && bd < -h * 0.25) { cd = d; carve = p; }
    }
    const src = carve || best;
    let col = src.color || [1, 0, 1];
    let mid = src.mat ?? 0;
    if (opts.paint) [col, mid] = opts.paint(x, y, z, col, mid, N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    const ao = opts.noAO ? 1 : sdfAO(aoModel, x, y, z, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], opts.aoScale || 0.04, 5);
    color[v * 4] = Math.round(col[0] * 255); color[v * 4 + 1] = Math.round(col[1] * 255); color[v * 4 + 2] = Math.round(col[2] * 255);
    color[v * 4 + 3] = Math.round(ao * 255);
    matId[v] = mid;
  }
  const bad = fixWinding(P, N, mesh.indices);
  console.log(`${name}: ${nv} verts, ${mesh.indices.length / 3} tris (raw ${raw}), flipped ${bad.toFixed(3)} (${Date.now() - t0} ms)`);
  return {
    name,
    attributes: {
      position: { data: P, itemSize: 3, type: 'f32' },
      normal: { data: N, itemSize: 3, type: 'f32' },
      color: { data: color, itemSize: 4, type: 'u8', normalized: true },
      matId: { data: matId, itemSize: 1, type: 'u8' },
    },
    index: mesh.indices,
  };
}

const body = buildBody();
const interior = buildInterior();
const wheel = buildSteeringWheel();
const aoAll = new Model();
for (const mm of [body, interior]) for (const p of mm.prims) aoAll.add(p);

const meshes = [
  bake('body', body, 0.0085, { bounds: { min: [-2.95, 0.22, -1.06], max: [2.98, 1.93, 1.06] }, tris: 95000, err: 0.0014, aoModel: aoAll, aoScale: 0.05 }),
  bake('interior', interior, 0.012, { bounds: { min: [-1.1, 0.5, -0.95], max: [1.05, 1.85, 0.95] }, tris: 16000, err: 0.002, aoModel: aoAll, aoScale: 0.05 }),
  bake('steering', wheel, 0.004, { tris: 4000, err: 0.0008, aoScale: 0.02 }),
  bake('mirrorBase', buildMirrorBase(), 0.004, { tris: 2000, err: 0.0006, aoScale: 0.02 }),
  bake('mirrorHead', buildMirrorHead(), 0.004, { tris: 7000, err: 0.0006, aoScale: 0.02 }),
  bake('towHook', buildTowHook(), 0.003, { tris: 3000, err: 0.0005, aoScale: 0.01 }),
];
const r = writePack(OUT, meshes, { dims: T, mats: M, windshield: WS, tumble: TH });
console.log('wrote', OUT, (r.bytes / 1e6).toFixed(2), 'MB');
