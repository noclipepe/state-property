// Signed-distance sculpting primitives used by the offline mesh bakers.
// Every primitive is placed with a local->world matrix (THREE.Matrix4) and is
// evaluated in its own local frame. Models are ordered lists of primitives
// combined with smooth union / subtraction / intersection.
import * as THREE from 'three';

export const smin = (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a, b, k) => -smin(-a, -b, k);

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// ---- local-space shape functions --------------------------------------
const shapes = {
  sphere: (p) => (x, y, z) => len3(x, y, z) - p.r,
  ellipsoid: (p) => {
    const { rx, ry, rz } = p;
    return (x, y, z) => {
      const k0 = len3(x / rx, y / ry, z / rz);
      const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
      if (k1 < 1e-9) return -Math.min(rx, ry, rz);
      return (k0 * (k0 - 1)) / k1;
    };
  },
  // rounded box with half extents hx,hy,hz and rounding r (r included in extents)
  box: (p) => {
    const hx = p.hx - p.r, hy = p.hy - p.r, hz = p.hz - p.r, r = p.r;
    return (x, y, z) => {
      const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
      return len3(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
    };
  },
  // capped cylinder along local Y, radius r, half height h, edge rounding rr
  cyl: (p) => {
    const r = p.r - (p.rr || 0), h = p.h - (p.rr || 0), rr = p.rr || 0;
    return (x, y, z) => {
      const dx = Math.sqrt(x * x + z * z) - r, dy = Math.abs(y) - h;
      return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rr;
    };
  },
  // torus in local XZ plane
  torus: (p) => (x, y, z) => {
    const q = Math.sqrt(x * x + z * z) - p.R;
    return Math.sqrt(q * q + y * y) - p.r;
  },
  // round cone between local points a and b with radii ra, rb (iq)
  rcone: (p) => {
    const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
    const r1 = p.ra, r2 = p.rb;
    const bax = bx - ax, bay = by - ay, baz = bz - az;
    const l2 = bax * bax + bay * bay + baz * baz;
    const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
    return (x, y, z) => {
      const pax = x - ax, pay = y - ay, paz = z - az;
      const yv = pax * bax + pay * bay + paz * baz;
      const zv = yv - l2;
      const vx = pax * l2 - bax * yv, vy = pay * l2 - bay * yv, vz = paz * l2 - baz * yv;
      const x2 = vx * vx + vy * vy + vz * vz;
      const y2 = yv * yv * l2, z2 = zv * zv * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
      return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1;
    };
  },
  // infinite slab |y| < h (useful for intersections / cuts)
  slab: (p) => (x, y, z) => Math.abs(y) - p.h,
  halfspace: (p) => (x, y, z) => y, // inside where local y < 0
  // custom local function
  fn: (p) => p.f,
};

function boundRadius(shape, p) {
  switch (shape) {
    case 'sphere': return p.r;
    case 'ellipsoid': return Math.max(p.rx, p.ry, p.rz);
    case 'box': return len3(p.hx, p.hy, p.hz);
    case 'cyl': return Math.hypot(p.r, p.h);
    case 'torus': return p.R + p.r;
    case 'rcone': {
      const c = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      const h = len3(p.a[0] - c[0], p.a[1] - c[1], p.a[2] - c[2]);
      return h + Math.max(p.ra, p.rb);
    }
    default: return p.bound ?? 1e9;
  }
}
function boundCenterLocal(shape, p) {
  if (shape === 'rcone') return [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
  return p.center || [0, 0, 0];
}

let primCounter = 0;
export class Prim {
  /**
   * @param {string} shape
   * @param {object} params
   * @param {THREE.Matrix4} matrix local->world
   * @param {object} opts {op:'add'|'sub'|'inter', k, bone, mat, color, sigma, disp, tag}
   */
  constructor(shape, params, matrix, opts = {}) {
    this.id = primCounter++;
    this.shape = shape;
    this.params = params;
    this.op = opts.op || 'add';
    this.k = opts.k ?? 0.01;
    this.bone = opts.bone ?? null;
    this.mat = opts.mat ?? null;
    this.color = opts.color ?? null;
    this.sigma = opts.sigma ?? 0.015;
    this.disp = opts.disp ?? null; // world-space displacement fn (x,y,z)->dd
    this.dispAmp = opts.dispAmp ?? 0; // bound on |disp|
    this.tag = opts.tag ?? null;
    this.weightBias = opts.weightBias ?? 0; // added distance for weight competition
    this.paintBias = opts.paintBias ?? 0;
    this.noWeight = !!opts.noWeight;
    const m = matrix ? matrix.clone() : new THREE.Matrix4();
    this.matrix = m;
    const inv = m.clone().invert();
    const e = inv.elements; // column-major
    this.inv = [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
    this.local = shapes[shape](params);
    const cl = new THREE.Vector3(...boundCenterLocal(shape, params)).applyMatrix4(m);
    // conservative: matrix assumed rigid (no scale)
    this.cx = cl.x; this.cy = cl.y; this.cz = cl.z;
    this.R = boundRadius(shape, params) + this.dispAmp;
  }
  eval(x, y, z) {
    const i = this.inv;
    const lx = i[0] * x + i[1] * y + i[2] * z + i[3];
    const ly = i[4] * x + i[5] * y + i[6] * z + i[7];
    const lz = i[8] * x + i[9] * y + i[10] * z + i[11];
    let d = this.local(lx, ly, lz);
    if (this.disp) d += this.disp(x, y, z, lx, ly, lz);
    return d;
  }
  toLocal(x, y, z) {
    const i = this.inv;
    return [i[0] * x + i[1] * y + i[2] * z + i[3], i[4] * x + i[5] * y + i[6] * z + i[7], i[8] * x + i[9] * y + i[10] * z + i[11]];
  }
}

export class Model {
  constructor() { this.prims = []; }
  add(p) { this.prims.push(p); return p; }
  eval(x, y, z) {
    let d = 1e9;
    const P = this.prims;
    for (let n = 0; n < P.length; n++) {
      const p = P[n];
      const dx = x - p.cx, dy = y - p.cy, dz = z - p.cz;
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.R;
      if (p.op === 'add') {
        if (lb > d + p.k) continue;
        d = smin(d, p.eval(x, y, z), p.k);
      } else if (p.op === 'sub') {
        if (lb > p.k + Math.max(0, -d)) continue;
        d = smax(d, -p.eval(x, y, z), p.k);
      } else if (p.op === 'inter') {
        d = smax(d, p.eval(x, y, z), p.k);
      }
    }
    return d;
  }
  grad(x, y, z, e) {
    const gx = this.eval(x + e, y, z) - this.eval(x - e, y, z);
    const gy = this.eval(x, y + e, z) - this.eval(x, y - e, z);
    const gz = this.eval(x, y, z + e) - this.eval(x, y, z - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    return [gx / l, gy / l, gz / l];
  }
  // per-primitive distances for additive primitives (for weights / paint)
  contributions(x, y, z) {
    const out = [];
    for (const p of this.prims) {
      if (p.op !== 'add') continue;
      out.push([p, p.eval(x, y, z)]);
    }
    return out;
  }
  bounds(pad = 0.01) {
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (const p of this.prims) {
      if (p.op !== 'add') continue;
      const c = [p.cx, p.cy, p.cz];
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], c[a] - p.R - pad);
        max[a] = Math.max(max[a], c[a] + p.R + pad);
      }
    }
    return { min, max };
  }
}

// --- helpers to build matrices ------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
export function mat(pos = [0, 0, 0], rotDeg = [0, 0, 0], parent = null) {
  _e.set(rotDeg[0] * Math.PI / 180, rotDeg[1] * Math.PI / 180, rotDeg[2] * Math.PI / 180, 'XYZ');
  _q.setFromEuler(_e);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), _q, _s);
  return parent ? parent.clone().multiply(m) : m;
}
