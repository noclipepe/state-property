// Bakes small props: the cap on the dashboard and the player's hand gripping the rod.
// Output: assets/meshes/props.{json,bin}
import * as THREE from 'three';
import { fileURLToPath } from 'node:url';
import { Prim, Model, mat } from './lib/sdf.mjs';
import { surfaceNets, sdfAO } from './lib/surfacenets.mjs';
import { writePack, fixWinding } from './lib/writer.mjs';
import { simplifyMesh } from './lib/simplify.mjs';
import { createNoise3D } from './lib/noise.mjs';

const OUT = fileURLToPath(new URL('../assets/meshes/props', import.meta.url));
const noise = createNoise3D(11);
const add = (m, shape, params, pos, rot, color, opts = {}) => m.add(new Prim(shape, params, mat(pos, rot), { color, k: 0, ...opts }));
const sub = (m, shape, params, pos, rot, color, opts = {}) => m.add(new Prim(shape, params, mat(pos, rot), { op: 'sub', color, k: 0, ...opts }));

// ---------------- cap (origin at the centre of the crown base, brim towards +X)
function buildCap() {
  const m = new Model();
  const crown = [0.62, 0.16, 0.13];
  const front = [0.86, 0.84, 0.80];
  const brim = [0.55, 0.13, 0.11];
  // crown shell
  m.add(new Prim('fn', {
    f: (x, y, z) => {
      const e = Math.hypot(x / 0.098, y / 0.075, z / 0.088);
      const outer = (e - 1) * 0.08;
      const inner = (Math.hypot(x / 0.092, y / 0.069, z / 0.082) - 1) * 0.075;
      return Math.max(outer, -inner, -y);
    }, bound: 0.12, center: [0, 0, 0],
  }, new THREE.Matrix4(), { color: crown, k: 0 }));
  m.prims[0].cx = 0; m.prims[0].cy = 0.04; m.prims[0].cz = 0; m.prims[0].R = 0.13;
  // front panel (lighter mesh-style trucker front)
  m.add(new Prim('fn', {
    f: (x, y, z) => {
      const e = Math.hypot(x / 0.1, y / 0.077, z / 0.09);
      const shell = Math.max((e - 1) * 0.08, -(Math.hypot(x / 0.094, y / 0.071, z / 0.084) - 1) * 0.075, -y);
      return Math.max(shell, 0.03 - x, Math.abs(z) - 0.07);
    }, bound: 0.12, center: [0, 0, 0],
  }, new THREE.Matrix4(), { color: front, k: 0 }));
  m.prims[1].cx = 0.05; m.prims[1].cy = 0.04; m.prims[1].cz = 0; m.prims[1].R = 0.1;
  // button on top
  add(m, 'sphere', { r: 0.008 }, [0, 0.076, 0], [0, 0, 0], crown);
  // curved brim
  m.add(new Prim('fn', {
    f: (x, y, z) => {
      const cx = x - 0.085;
      const yy = y - 0.004 + 0.12 * z * z + 0.02 * cx; // curve + slight droop
      const slab = Math.abs(yy) - 0.0035;
      const shape = Math.hypot(cx / 0.075, z / 0.09) - 1;
      const back = 0.0 - x + 0.06;
      return Math.max(slab, shape * 0.07, back);
    }, bound: 0.12, center: [0, 0, 0],
  }, new THREE.Matrix4(), { color: brim, k: 0 }));
  m.prims[2].cx = 0.12; m.prims[2].cy = 0; m.prims[2].cz = 0; m.prims[2].R = 0.11;
  return m;
}

// ---------------- player hand gripping the rod handle (handle axis = local Z, palm wraps around the origin)
function buildHand() {
  const m = new Model();
  const skin = [0.36, 0.22, 0.15];
  const o = { color: skin, k: 0.008 };
  // palm block beside the handle (-X side = back of hand)
  add(m, 'box', { hx: 0.017, hy: 0.045, hz: 0.04, r: 0.015 }, [-0.028, -0.01, 0.0], [0, 0, 0], skin, o);
  // wrist
  m.add(new Prim('rcone', { a: [-0.03, -0.05, 0.0], b: [-0.05, -0.15, -0.0], ra: 0.03, rb: 0.033 }, null, o));
  // fingers wrapping around the handle (curling over the top toward +X, then down)
  const fz = [0.028, 0.009, -0.01, -0.027];
  for (let i = 0; i < 4; i++) {
    const r = i === 3 ? 0.0078 : 0.0092;
    const z = fz[i];
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const a = Math.PI * 0.9 - (k / 6) * Math.PI * 1.25;
      const rr = 0.024 + r;
      pts.push([Math.cos(a) * rr - 0.004, Math.sin(a) * rr + 0.004, z]);
    }
    for (let k = 0; k < pts.length - 1; k++) m.add(new Prim('rcone', { a: pts[k], b: pts[k + 1], ra: r, rb: r * 0.97 }, null, { ...o, k: 0.004 }));
  }
  // thumb along the top of the handle
  m.add(new Prim('rcone', { a: [-0.03, 0.02, 0.035], b: [-0.005, 0.03, 0.06], ra: 0.013, rb: 0.011 }, null, o));
  m.add(new Prim('rcone', { a: [-0.005, 0.03, 0.06], b: [0.012, 0.028, 0.085], ra: 0.011, rb: 0.009 }, null, { ...o, k: 0.004 }));
  // forearm sleeve (long sleeve shirt, grey-green like the reference camera person's)
  m.add(new Prim('rcone', { a: [-0.06, -0.15, 0.0], b: [-0.13, -0.42, -0.04], ra: 0.042, rb: 0.05 }, null, { color: [0.24, 0.27, 0.22], k: 0.01 }));
  // handle hole so it doesn't fill the grip
  sub(m, 'cyl', { r: 0.0175, h: 0.2 }, [0, 0, 0], [90, 0, 0], null, { k: 0.002 });
  return m;
}

function bake(name, model, h, bounds, tris, err) {
  let mesh = surfaceNets(model, { h, min: bounds[0], max: bounds[1], project: 3 });
  mesh = simplifyMesh(mesh, tris, err);
  const P = mesh.positions, N = mesh.normals, nv = P.length / 3;
  const color = new Uint8Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let best = null, bd = 1e9;
    for (const p of model.prims) { if (p.op !== 'add') continue; const d = p.eval(x, y, z); if (d < bd) { bd = d; best = p; } }
    const c = best.color;
    const n = 1 + noise(x * 300, y * 300, z * 300) * 0.04;
    const ao = sdfAO(model, x, y, z, N[v * 3], N[v * 3 + 1], N[v * 3 + 2], 0.006, 5);
    color[v * 4] = Math.min(255, c[0] * n * 255); color[v * 4 + 1] = Math.min(255, c[1] * n * 255); color[v * 4 + 2] = Math.min(255, c[2] * n * 255);
    color[v * 4 + 3] = ao * 255;
  }
  fixWinding(P, N, mesh.indices);
  console.log(name, nv, 'verts', mesh.indices.length / 3, 'tris');
  return { name, attributes: { position: { data: P, itemSize: 3, type: 'f32' }, normal: { data: N, itemSize: 3, type: 'f32' }, color: { data: color, itemSize: 4, type: 'u8', normalized: true } }, index: mesh.indices };
}

const meshes = [
  bake('cap', buildCap(), 0.0022, [[-0.12, -0.02, -0.12], [0.18, 0.1, 0.12]], 5000, 0.0004),
  bake('hand', buildHand(), 0.0022, [[-0.2, -0.47, -0.1], [0.06, 0.07, 0.11]], 7000, 0.0004),
];
writePack(OUT, meshes);
console.log('wrote', OUT);
