// Writes baked meshes into a compact binary pack: <name>.json (header) + <name>.bin
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  f32: { arr: Float32Array, size: 4 },
  u8: { arr: Uint8Array, size: 1 },
  u16: { arr: Uint16Array, size: 2 },
  i16: { arr: Int16Array, size: 2 },
  u32: { arr: Uint32Array, size: 4 },
};

/**
 * meshes: [{name, attributes:{position:{data,itemSize,type,normalized}}, index:Uint32Array, extra}]
 */
export function writePack(file, meshes, extra = {}) {
  const chunks = [];
  let offset = 0;
  const header = { version: 1, meshes: [], ...extra };
  const push = (typed) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(buf);
    const o = offset;
    offset += buf.length;
    return o;
  };
  for (const m of meshes) {
    const mh = { name: m.name, attributes: {}, extra: m.extra || {} };
    for (const [key, a] of Object.entries(m.attributes)) {
      const T = TYPES[a.type];
      const typed = a.data instanceof T.arr ? a.data : T.arr.from(a.data);
      mh.attributes[key] = { type: a.type, itemSize: a.itemSize, normalized: !!a.normalized, offset: push(typed), count: typed.length };
    }
    if (m.index) {
      const vc = m.attributes.position.data.length / 3;
      const idx = vc < 65536 ? Uint16Array.from(m.index) : Uint32Array.from(m.index);
      mh.index = { type: vc < 65536 ? 'u16' : 'u32', offset: push(idx), count: idx.length };
    }
    header.meshes.push(mh);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.bin', Buffer.concat(chunks));
  fs.writeFileSync(file + '.json', JSON.stringify(header));
  return { bytes: offset };
}

export function quantizeNormals(n) {
  const out = new Int16Array(n.length);
  for (let i = 0; i < n.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, n[i])) * 32767);
  return out;
}

// make sure faces point along their vertex normals
export function fixWinding(pos, nrm, idx) {
  let bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const d = fx * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) + fy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) + fz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]);
    if (d < 0) bad++;
  }
  if (bad > idx.length / 6) {
    for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
  return bad / (idx.length / 3);
}
