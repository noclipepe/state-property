// Sparse naive surface nets with gradient projection. Produces a smooth,
// watertight-ish triangle mesh from an SDF Model.

/**
 * @param {import('./sdf.mjs').Model} model
 * @param {object} o {h: voxel size, min, max, block, project}
 */
export function surfaceNets(model, o) {
  const h = o.h;
  const B = o.block || 8;
  const min = o.min, max = o.max;
  const nx = Math.ceil((max[0] - min[0]) / h) + 2;
  const ny = Math.ceil((max[1] - min[1]) / h) + 2;
  const nz = Math.ceil((max[2] - min[2]) / h) + 2;
  const NXY = nx * ny;
  const N = nx * ny * nz;
  if (N > 60e6) throw new Error('grid too large: ' + N);
  const vals = new Float32Array(N).fill(NaN);
  const px = (i) => min[0] + i * h, py = (j) => min[1] + j * h, pz = (k) => min[2] + k * h;

  const bx = Math.ceil((nx - 1) / B), by = Math.ceil((ny - 1) / B), bz = Math.ceil((nz - 1) / B);
  const halfDiag = B * h * Math.sqrt(3) / 2;
  const active = [];
  for (let bk = 0; bk < bz; bk++) for (let bj = 0; bj < by; bj++) for (let bi = 0; bi < bx; bi++) {
    const cx = min[0] + (bi + 0.5) * B * h, cy = min[1] + (bj + 0.5) * B * h, cz = min[2] + (bk + 0.5) * B * h;
    const d = model.eval(cx, cy, cz);
    if (Math.abs(d) < halfDiag * 1.6 + 2 * h) active.push([bi, bj, bk]);
  }
  for (const [bi, bj, bk] of active) {
    for (let k = bk * B; k <= Math.min(bk * B + B, nz - 1); k++)
      for (let j = bj * B; j <= Math.min(bj * B + B, ny - 1); j++)
        for (let i = bi * B; i <= Math.min(bi * B + B, nx - 1); i++) {
          const idx = i + j * nx + k * NXY;
          if (Number.isNaN(vals[idx])) vals[idx] = model.eval(px(i), py(j), pz(k));
        }
  }

  const cellVert = new Int32Array(N).fill(-1);
  const pos = [];
  const cellsWithVerts = [];
  const cornerOff = [];
  for (let c = 0; c < 8; c++) cornerOff.push([(c & 1), (c >> 1) & 1, (c >> 2) & 1]);
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (const [bi, bj, bk] of active) {
    for (let k = bk * B; k < Math.min(bk * B + B, nz - 1); k++)
      for (let j = bj * B; j < Math.min(bj * B + B, ny - 1); j++)
        for (let i = bi * B; i < Math.min(bi * B + B, nx - 1); i++) {
          let mask = 0, bad = false;
          for (let c = 0; c < 8; c++) {
            const o2 = cornerOff[c];
            const v = vals[(i + o2[0]) + (j + o2[1]) * nx + (k + o2[2]) * NXY];
            if (Number.isNaN(v)) { bad = true; break; }
            cv[c] = v;
            if (v < 0) mask |= 1 << c;
          }
          if (bad || mask === 0 || mask === 255) continue;
          let sx = 0, sy = 0, sz = 0, cnt = 0;
          for (const [a, b] of edges) {
            const va = cv[a], vb = cv[b];
            if ((va < 0) === (vb < 0)) continue;
            const t = va / (va - vb);
            const oa = cornerOff[a], ob = cornerOff[b];
            sx += oa[0] + (ob[0] - oa[0]) * t;
            sy += oa[1] + (ob[1] - oa[1]) * t;
            sz += oa[2] + (ob[2] - oa[2]) * t;
            cnt++;
          }
          const idx = i + j * nx + k * NXY;
          cellVert[idx] = pos.length / 3;
          pos.push(px(i) + (sx / cnt) * h, py(j) + (sy / cnt) * h, pz(k) + (sz / cnt) * h);
          cellsWithVerts.push(idx);
        }
  }

  // projection onto the surface
  const nv = pos.length / 3;
  const P = new Float32Array(pos);
  const Nrm = new Float32Array(nv * 3);
  const iters = o.project ?? 2;
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < iters; it++) {
      const d = model.eval(x, y, z);
      const g = model.grad(x, y, z, h * 0.25);
      x -= d * g[0]; y -= d * g[1]; z -= d * g[2];
    }
    // don't let projection run away (thin features)
    const dx = x - x0, dy = y - y0, dz = z - z0;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl > h * 0.9) { const s = (h * 0.9) / dl; x = x0 + dx * s; y = y0 + dy * s; z = z0 + dz * s; }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    const g = model.grad(x, y, z, h * 0.5);
    Nrm[v * 3] = g[0]; Nrm[v * 3 + 1] = g[1]; Nrm[v * 3 + 2] = g[2];
  }

  // faces
  const idxOut = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // pick shorter diagonal
    const dac = dist2(P, a, c), dbd = dist2(P, b, d);
    let tris = dac < dbd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    if (flip) tris = [tris[0], tris[2], tris[1], tris[3], tris[5], tris[4]];
    idxOut.push(...tris);
  };
  for (const idx of cellsWithVerts) {
    const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / NXY);
    const v0 = vals[idx];
    // edge along +x from point (i,j,k): shared by cells (i,j,k),(i,j-1,k),(i,j-1,k-1),(i,j,k-1)
    if (j > 0 && k > 0) {
      const v1 = vals[idx + 1];
      if ((v0 < 0) !== (v1 < 0)) {
        quad(cellVert[idx], cellVert[idx - nx], cellVert[idx - nx - NXY], cellVert[idx - NXY], v0 >= 0);
      }
    }
    if (i > 0 && k > 0) {
      const v1 = vals[idx + nx];
      if ((v0 < 0) !== (v1 < 0)) {
        quad(cellVert[idx], cellVert[idx - NXY], cellVert[idx - 1 - NXY], cellVert[idx - 1], v0 >= 0);
      }
    }
    if (i > 0 && j > 0) {
      const v1 = vals[idx + NXY];
      if ((v0 < 0) !== (v1 < 0)) {
        quad(cellVert[idx], cellVert[idx - 1], cellVert[idx - 1 - nx], cellVert[idx - nx], v0 >= 0);
      }
    }
  }
  return { positions: P, normals: Nrm, indices: new Uint32Array(idxOut) };
}

function dist2(P, a, b) {
  const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// Simple SDF ambient occlusion at a surface point (0..1, 1 = open)
export function sdfAO(model, x, y, z, nx, ny, nz, scale = 0.01, steps = 5) {
  let occ = 0, w = 1;
  for (let s = 1; s <= steps; s++) {
    const dist = scale * s;
    const d = model.eval(x + nx * dist, y + ny * dist, z + nz * dist);
    occ += w * Math.max(0, dist - d) / dist;
    w *= 0.6;
  }
  return Math.max(0, Math.min(1, 1 - occ * 0.45));
}
