// Loads binary mesh packs produced by tools/bake-*.mjs
import * as THREE from 'three';

const ARR = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array };

export async function loadPack(url, onProgress) {
  // a page can ask for a slimmer variant of a pack (the production driver page sets PACK_NAMES)
  url = url.replace(/[^/]+$/, (name) => globalThis.PACK_NAMES?.[name] || name);
  const [header, bin] = await Promise.all([
    fetch(url + '.json').then((r) => { if (!r.ok) throw new Error('missing ' + url + '.json'); return r.json(); }),
    fetchWithProgress(url + (globalThis.PACK_BIN_EXT || '.bin'), onProgress),
  ]);
  const geos = {};
  for (const m of header.meshes) {
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(m.attributes)) {
      let arr = new ARR[a.type](bin, a.offset, a.count);
      if (a.quant) arr = dequantize(arr, a.quant, a.itemSize); // 16-bit packed positions (production build)
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.quant ? false : a.normalized));
    }
    if (m.index) g.setIndex(new THREE.BufferAttribute(new ARR[m.index.type](bin, m.index.offset, m.index.count), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData = m.extra || {};
    geos[m.name] = g;
  }
  return { header, geos };
}

// u16 -> float in [min, max] per component
function dequantize(q, { min, max }, itemSize) {
  const out = new Float32Array(q.length);
  const scale = min.map((lo, i) => (max[i] - lo) / 65535);
  for (let i = 0; i < q.length; i++) { const c = i % itemSize; out[i] = min[c] + q[i] * scale[c]; }
  return out;
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('missing ' + url);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const buf = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.set(value, got);
    got += value.length;
    onProgress(got / total);
  }
  return buf.buffer;
}
