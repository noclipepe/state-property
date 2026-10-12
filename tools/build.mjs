// Static production build of the STATE PROPERTY series for Cloudflare Pages (or any static host).
//   node tools/build.mjs            -> dist/  +  release/state-property-simulator.zip (files at the zip root)
// What it does:
//   - index.html (the series menu) and the page of every available game in SITE.games
//     (src/site-config.js), with share metadata and creator links filled in from SITE
//   - copies only the modules the pages import (followed from their entry scripts), the parts of
//     three.js they use (+ its MIT licence), the stylesheets, both games' audio and the brand files
//   - re-packs the meshes with positions and normals as 16-bit values instead of 32-bit floats
//     (src/util/pack.js decodes them); the driver page also gets slimmer copies without what the
//     driver POV never shows (grandpa's head, hair, brows and mustache: the camera is his eyes;
//     the first-person hand), the fisherman page keeps the full ones
//   - writes _headers (caching + basic security headers) and checks Cloudflare's 25 MiB file limit
// Nothing from tools/, dev/, the reference video, transcripts or node_modules is published.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE = path.join(ROOT, 'release');
const ZIP = path.join(RELEASE, 'state-property-simulator.zip');
const LIMIT = 25 * 1024 * 1024;
const { SITE } = await import(pathToFileURL(path.join(ROOT, 'src/site-config.js')).href);

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const copy = (from, to = from) => {
  const dst = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), dst);
};

// ------------------------------------------------------------------ pages
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const base = SITE.siteUrl ? SITE.siteUrl.replace(/\/?$/, '/') : '';
const vars = {
  description: SITE.description,
  ogImage: base + 'assets/brand/og-image.jpg',
  siteUrl: base,
  instagram: SITE.links.instagram, tiktok: SITE.links.tiktok, x: SITE.links.x, reel: SITE.links.reel,
};
// slimmer mesh packs for the driver page (written below)
const PAGE_HEAD = { 'driver.html': '<script>globalThis.PACK_NAMES = { grandpa: "grandpa-driver", props: "props-driver" };</script>\n' };
const pages = ['index.html', ...SITE.games.filter((g) => g.available && g.launch?.page).map((g) => g.launch.page)];
const entries = [];
for (const page of pages) {
  let html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  // Cloudflare Pages serves /driver.html at /driver (308 redirect): canonical points at the final address
  const pageVars = { ...vars, pageUrl: base && base + (page === 'index.html' ? '' : page.replace(/\.html$/, '')) };
  html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(pageVars[k] ?? ''));
  // unknown until SITE.siteUrl is set
  if (!base) html = html.replace(/\s*<meta property="og:url" content="">/, '').replace(/\s*<link rel="canonical" href="">/, '');
  if (PAGE_HEAD[page]) html = html.replace('<script type="importmap">', PAGE_HEAD[page] + '<script type="importmap">');
  if (/\{\{|localhost/.test(html)) throw new Error(`${page} still has a placeholder or a localhost reference`);
  fs.writeFileSync(path.join(DIST, page), html);
  for (const m of html.matchAll(/<script type="module" src="([^"]+)"/g)) entries.push(m[1]);
  for (const m of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) copy(m[1]);
}

// ------------------------------------------------------------------ scripts: follow the imports
const importmap = { three: 'vendor/three/three.module.js', 'three/addons/': 'vendor/three/addons/' };
const seen = new Set();
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    let spec = m[1] || m[2];
    if (spec === 'three') spec = '/' + importmap.three;
    else if (spec.startsWith('three/addons/')) spec = '/' + importmap['three/addons/'] + spec.slice('three/addons/'.length);
    const target = spec.startsWith('/') ? spec.slice(1) : rel(path.resolve(path.dirname(path.join(ROOT, file)), spec));
    walk(target);
  }
};
for (const e of entries) walk(e);
for (const f of seen) copy(f);
copy('vendor/three/LICENSE', 'vendor/three/LICENSE.txt');

// ------------------------------------------------------------------ assets
for (const f of fs.readdirSync(path.join(ROOT, 'assets/brand'))) copy('assets/brand/' + f);
for (const set of ['driver_dialogue.json', 'dialogue.json', 'gru_dialogue.json', 'ant_dialogue.json']) {
  const lines = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/audio', set), 'utf8'));
  copy('assets/audio/' + set);
  for (const line of Object.values(lines)) copy(line.file);
}

const TYPES = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array };
const SIZE = { f32: 4, u8: 1, u16: 2, i16: 2, u32: 4 };
function repack(name, drop = [], as = name) {
  const header = JSON.parse(fs.readFileSync(path.join(ROOT, `assets/meshes/${name}.json`), 'utf8'));
  const bin = fs.readFileSync(path.join(ROOT, `assets/meshes/${name}.bin`));
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const chunks = [];
  let offset = 0;
  const push = (typed) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    chunks.push(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength));
    const o = offset; offset += typed.byteLength; return o;
  };
  const out = { ...header, meshes: [] };
  for (const m of header.meshes) {
    if (drop.includes(m.name)) continue;
    const mh = { ...m, attributes: {} };
    for (const [key, a] of Object.entries(m.attributes)) {
      let data = new TYPES[a.type](buf, a.offset, a.count);
      let { type, normalized } = a;
      let quant;
      if (key === 'normal' && type === 'f32') { // unit vectors: 16-bit snorm is visually identical
        data = Int16Array.from(data, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767));
        type = 'i16'; normalized = true;
      } else if (key === 'position' && type === 'f32') { // 16 bits per axis over the mesh bounds (<0.1 mm here)
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < data.length; i++) { const c = i % 3; if (data[i] < min[c]) min[c] = data[i]; if (data[i] > max[c]) max[c] = data[i]; }
        const src = data;
        data = Uint16Array.from(src, (v, i) => { const c = i % 3, r = max[c] - min[c]; return r > 0 ? Math.round((v - min[c]) / r * 65535) : 0; });
        type = 'u16'; normalized = false; quant = { min, max };
      }
      mh.attributes[key] = { ...a, type, normalized, offset: push(data), count: data.length, ...(quant ? { quant } : {}) };
    }
    if (m.index) mh.index = { ...m.index, offset: push(new TYPES[m.index.type](buf, m.index.offset, m.index.count)) };
    out.meshes.push(mh);
  }
  fs.mkdirSync(path.join(DIST, 'assets/meshes'), { recursive: true });
  fs.writeFileSync(path.join(DIST, `assets/meshes/${as}.bin`), Buffer.concat(chunks));
  fs.writeFileSync(path.join(DIST, `assets/meshes/${as}.json`), JSON.stringify(out));
  return [bin.length, offset];
}
const packs = {
  truck: repack('truck'),
  gru: repack('gru'),
  grandpa: repack('grandpa'),
  'grandpa-driver': repack('grandpa', ['head', 'hair', 'brows', 'mustache'], 'grandpa-driver'),
  fisherman: repack('fisherman'),
  props: repack('props'),
  'props-driver': repack('props', ['hand'], 'props-driver'),
};

// ------------------------------------------------------------------ Cloudflare Pages headers
fs.writeFileSync(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/
  Cache-Control: no-cache

/*.html
  Cache-Control: no-cache

/src/*
  Cache-Control: public, max-age=300, must-revalidate

/assets/*
  Cache-Control: public, max-age=86400

/vendor/*
  Cache-Control: public, max-age=604800
`);

// ------------------------------------------------------------------ report + checks
const files = [];
const list = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) list(p); else files.push(p); } };
list(DIST);
let total = 0;
const big = [];
for (const f of files) {
  const n = fs.statSync(f).size;
  total += n;
  if (n > LIMIT) big.push(rel(f));
  const text = /\.(html|js|css|json)$/.test(f) ? fs.readFileSync(f, 'utf8') : '';
  if (/localhost|127\.0\.0\.1|[A-Z]:\\|\/Users\/|AppData/.test(text)) throw new Error(`local reference in ${rel(f)}`);
}
if (big.length) throw new Error('over the 25 MiB Cloudflare Pages file limit: ' + big.join(', '));
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
for (const [n, [a, b]] of Object.entries(packs)) console.log(`mesh ${n.padEnd(10)} ${kb(a).padStart(8)} -> ${kb(b).padStart(8)}`);
const largest = files.map((f) => [rel(f).slice(5), fs.statSync(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(`dist: ${files.length} files, ${(total / 1048576).toFixed(2)} MiB; largest: ${largest.map(([f, n]) => `${f} ${kb(n)}`).join(', ')}`);
if (!SITE.siteUrl) console.log('note: SITE.siteUrl is empty, so og:image is relative and og:url / canonical are omitted (set it once the address is known, then rebuild)');
else for (const page of pages) { // every share URL on every page must be absolute and on the site
  const html = fs.readFileSync(path.join(DIST, page), 'utf8');
  for (const m of html.matchAll(/<(?:meta (?:property|name)="(?:og:url|og:image|twitter:image)"[^>]*content|link rel="canonical"[^>]*href)="([^"]*)"/g))
    if (!m[1].startsWith(base)) throw new Error(`${page}: share URL is not absolute on ${base}: ${m[1]}`);
}

// ------------------------------------------------------------------ zip (stored paths relative to dist/, no dependencies)
function zip(entries) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10); c.writeUInt32LE(0x00210000, 12); c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, nameBuf);
    off += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
fs.mkdirSync(RELEASE, { recursive: true });
fs.writeFileSync(ZIP, zip(files.sort().map((f) => [path.relative(DIST, f).split(path.sep).join('/'), fs.readFileSync(f)])));
console.log(`zip: ${rel(ZIP)} (${(fs.statSync(ZIP).size / 1048576).toFixed(2)} MiB)`);
