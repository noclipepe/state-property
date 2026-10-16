// Low-poly pieces for FISH ESCAPE: crab parts (instanced), the obstacle bucket (the Fish POV
// pail's own profile), the hook with its line, and the target ring that marks the hook's cell.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** merge non-indexed copies of several geometries (position + normal only) */
export function merge(geometries) {
  const parts = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), withUv = parts.every((g) => g.attributes.uv), uv = withUv ? new Float32Array(n * 2) : null;
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    if (uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
const placed = (geo, { p = V(), r = new THREE.Euler(), s = V(1, 1, 1) } = {}) => geo.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(r), s));

// ------------------------------------------------------------------ crab
// A shore crab about the size of the fish, built facing +Z (toward the camera) so it walks
// sideways along X like a real crab. Body = shell, eye stalks and eyes; claws and legs are
// separate instanced pieces so they can move.
export function crabGeometries() {
  const sphere = () => new THREE.SphereGeometry(1, 14, 9);
  const shell = placed(sphere(), { p: V(0, 0.075, 0), s: V(0.165, 0.062, 0.125) });
  // a slightly raised, bumpy back
  const ridge = placed(sphere(), { p: V(0, 0.11, -0.01), s: V(0.11, 0.032, 0.08) });
  const parts = [shell, ridge];
  for (const sd of [-1, 1]) {
    parts.push(placed(new THREE.CylinderGeometry(0.01, 0.012, 0.07, 6), { p: V(0.045 * sd, 0.135, 0.08), r: new THREE.Euler(0.35, 0, 0.15 * sd) }));
    parts.push(placed(sphere(), { p: V(0.052 * sd, 0.17, 0.095), s: V(0.022, 0.022, 0.022) }));
  }
  const body = merge(parts);
  // claw: an arm, a big pincer and a moving finger; origin at the shoulder, reaching forward (+Z)
  const claw = merge([
    placed(new THREE.CylinderGeometry(0.022, 0.026, 0.11, 7), { p: V(0.02, 0, 0.05), r: new THREE.Euler(Math.PI / 2 - 0.25, 0, -0.45) }),
    placed(sphere(), { p: V(0.06, 0.012, 0.115), s: V(0.05, 0.034, 0.06) }),
    placed(new THREE.ConeGeometry(0.02, 0.075, 7), { p: V(0.045, 0.02, 0.18), r: new THREE.Euler(Math.PI / 2, 0, 0.2) }),
    placed(new THREE.ConeGeometry(0.016, 0.065, 7), { p: V(0.082, 0.008, 0.172), r: new THREE.Euler(Math.PI / 2, 0, -0.35) }),
  ]);
  // leg: from the hip, out and down to the tip (origin at the hip, reaching +X)
  const leg = merge([
    placed(new THREE.CylinderGeometry(0.011, 0.013, 0.1, 5), { p: V(0.05, 0.02, 0), r: new THREE.Euler(0, 0, Math.PI / 2 - 0.35) }),
    placed(new THREE.CylinderGeometry(0.006, 0.011, 0.11, 5), { p: V(0.125, -0.025, 0), r: new THREE.Euler(0, 0, -0.6) }),
  ]);
  return { body, claw, leg };
}

// ------------------------------------------------------------------ bucket
// The Fish POV pail's profile (src/fish/bucket.js), as a shared obstacle shape.
const BUCKET_PROFILE = [[0, 0.02], [0.225, 0.02], [0.235, 0.035], [0.33, 0.47], [0.33, 0.49], [0.319, 0.49], [0.316, 0.47], [0.223, 0.045], [0, 0.045]];
export function bucketGeometries() {
  const wall = new THREE.LatheGeometry(BUCKET_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)), 40);
  const rim = placed(new THREE.TorusGeometry(0.325, 0.012, 6, 40), { p: V(0, 0.49, 0), r: new THREE.Euler(Math.PI / 2, 0, 0) });
  const hoops = merge([0.06, 0.19, 0.345].map((y, i) => placed(new THREE.TorusGeometry([0.231, 0.252, 0.286][i], 0.007, 5, 40), { p: V(0, y, 0), r: new THREE.Euler(Math.PI / 2, 0, 0) })));
  return { wall, trim: merge([rim, hoops]) };
}
export function bucketMaterials() {
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8baba, roughness: 0.32, metalness: 0.78, side: THREE.DoubleSide });
  steel.onBeforeCompile = (s) => {
    s.vertexShader = 'varying vec3 vPail;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPail = position;');
    s.fragmentShader = 'varying vec3 vPail;\n' + s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float ang = atan(vPail.z, vPail.x);
      diffuseColor.rgb *= 0.93 + sin(vPail.y * 4300.0 + sin(ang * 43.0)) * 0.025 + sin(ang * 81.0 + vPail.y * 470.0) * sin(ang * 143.0 - vPail.y * 330.0) * 0.05;
      diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.3, length(vPail.xz)));`);
  };
  steel.customProgramCacheKey = () => 'escape-pail';
  return { steel, rim: new THREE.MeshStandardMaterial({ color: 0xd2d3d4, metalness: 0.9, roughness: 0.22 }) };
}

// ------------------------------------------------------------------ hook, line and target
export function makeHook() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.95, roughness: 0.18 });
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 8), metal); shank.position.y = 0.17; g.add(shank);
  const bend = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20, Math.PI * 1.2), metal);
  bend.position.set(0.075, 0.05, 0); bend.rotation.z = Math.PI; g.add(bend);
  const barb = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 8), metal); barb.position.set(0.14, 0.09, 0); barb.rotation.z = -0.35; g.add(barb);
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.008, 6, 14), metal); eye.position.y = 0.3; g.add(eye);
  // a red and white float on the line keeps it easy to spot against grass and sand
  const red = new THREE.MeshStandardMaterial({ color: 0xd9322b, roughness: 0.5 }), white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.5 });
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), red); top.position.y = 0.95; g.add(top);
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white); bottom.position.y = 0.95; g.add(bottom);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1, 5).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0xf6f6ee }));
  line.position.y = 0.31; line.scale.y = 20; line.rotation.set(0.35, 0, 0.12); g.add(line); g.userData.line = line;
  g.traverse((o) => { if (o.isMesh && o !== line) o.castShadow = true; });
  return g;
}

/** a ring on the ground plus a filling disc that shows how long until the hook strikes */
export function makeTarget() {
  const g = new THREE.Group();
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 40).rotateX(-Math.PI / 2), mat(0xffffff, 0.9));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.4, 40).rotateX(-Math.PI / 2), mat(0xe2463c, 0.42));
  const dash = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.52, 40, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2), mat(0xe2463c, 0.85));
  ring.position.y = fill.position.y = dash.position.y = 0.012;
  g.add(fill, ring, dash); g.userData = { ring, fill, dash };
  return g;
}

/** a rounded, slightly squashed boulder */
export function boulderGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = V();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(1 + 0.12 * Math.sin(v.x * 4.1 + v.z * 3.3) * Math.cos(v.y * 3.7)); p.setXYZ(i, v.x, v.y * 0.72, v.z); }
  g.computeVertexNormals(); return g;
}

/** a little five-petal flower (petals and centre in one geometry, coloured per instance) */
export function flowerGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; parts.push(placed(new THREE.SphereGeometry(1, 6, 4), { p: V(Math.cos(a) * 0.022, 0.06, Math.sin(a) * 0.022), s: V(0.017, 0.006, 0.017) })); }
  parts.push(placed(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 4), { p: V(0, 0.03, 0) }));
  return merge(parts);
}

/** a scallop shell for the sand */
export function shellGeometry() {
  return placed(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { s: V(0.035, 0.012, 0.03) });
}

/** a tuft of grass blades (thin double-sided triangles), coloured per instance */
export function tuftGeometry() {
  const pos = [];
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + i * 0.7, r = 0.012 + (i % 3) * 0.01, h = 0.07 + ((i * 5) % 7) * 0.012, w = 0.007;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, lean = 0.025 + (i % 2) * 0.015, tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, h, tz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // light from above, whichever way a blade faces
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}

/** a small toadstool: stem and cap as separate geometries (the cap is coloured per instance) */
export function mushroomGeometries() {
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.05, 7).translate(0, 0.025, 0);
  const cap = new THREE.SphereGeometry(0.032, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.045, 0);
  return { stem, cap };
}

// ------------------------------------------------------------------ vehicles
// Three kinds at real proportions, in metres, driving along +X, wheels on the ground. L = length,
// W = width (a lane of 2 or 3 rows). Parts: paint (instance colour), cargo (the truck's box),
// glass, dark (bumpers, grille, bed), wheels, hubs, head and tail lights.
export function vehicleGeometries(kind, L, W) {
  const box = (w, h, d, x, y, z, rz = 0) => placed(new THREE.BoxGeometry(w, h, d), { p: V(x, y, z), r: new THREE.Euler(0, 0, rz) });
  const wheelSet = (r, xs, z, w = 0.14) => {
    const tyre = new THREE.CylinderGeometry(r, r, w, 16).rotateX(Math.PI / 2), hub = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.012, 12).rotateX(Math.PI / 2);
    const at = xs.flatMap((x) => [[x, z], [x, -z]]);
    return { wheels: merge(at.map(([x, zz]) => placed(tyre.clone(), { p: V(x, r, zz) }))), hubs: merge(at.map(([x, zz]) => placed(hub.clone(), { p: V(x, r, zz) }))) };
  };
  const lights = (x, y, z, d) => merge([box(0.03, 0.07, d, x, y, z), box(0.03, 0.07, d, x, y, -z)]);
  if (kind === 'car') {
    // a rounded little hatchback: low body, glass cabin, roof
    const h0 = 0.16, top = 0.5;
    const paint = merge([
      box(L, top - h0, W, 0, (top + h0) / 2, 0),
      box(L * 0.26, 0.06, W * 0.96, L * 0.36, top + 0.01, 0, -0.1),            // bonnet
      box(L * 0.5, 0.05, W * 0.84, -L * 0.07, 0.84, 0),                          // roof
      box(0.05, 0.3, 0.06, L * 0.16, 0.67, W * 0.4), box(0.05, 0.3, 0.06, L * 0.16, 0.67, -W * 0.4), // pillars
      box(0.05, 0.3, 0.06, -L * 0.31, 0.67, W * 0.4), box(0.05, 0.3, 0.06, -L * 0.31, 0.67, -W * 0.4),
    ]);
    const glass = merge([box(L * 0.46, 0.3, W * 0.86, -L * 0.07, 0.67, 0), box(0.04, 0.3, W * 0.8, L * 0.2, 0.66, 0, 0.5)]);
    const dark = merge([box(0.08, 0.13, W * 1.02, L / 2, 0.22, 0), box(0.08, 0.13, W * 1.02, -L / 2, 0.22, 0), box(0.02, 0.09, W * 0.4, L / 2 + 0.04, 0.36, 0)]);
    return { paint, glass, dark, ...wheelSet(0.2, [L * 0.31, -L * 0.31], W / 2 - 0.05), head: lights(L / 2 + 0.005, 0.38, W * 0.34, 0.16), tail: lights(-L / 2 - 0.005, 0.4, W * 0.36, 0.12) };
  }
  if (kind === 'pickup') {
    // the familiar pickup: long bonnet, short cab, open bed
    const h0 = 0.22, deck = 0.58, cabX = L * 0.12, cabL = L * 0.27;
    const paint = merge([
      box(L, deck - h0, W, 0, (deck + h0) / 2, 0),                                 // body and bed sides
      box(L * 0.3, 0.1, W * 0.98, L * 0.35, deck + 0.04, 0, -0.06),              // bonnet
      box(cabL, 0.06, W * 0.94, cabX, 1.04, 0),                                   // cab roof
      box(0.06, 0.4, 0.06, cabX + cabL / 2, 0.82, W * 0.44), box(0.06, 0.4, 0.06, cabX + cabL / 2, 0.82, -W * 0.44),
      box(0.06, 0.42, W * 0.94, cabX - cabL / 2, 0.82, 0),                        // back of the cab
      box(L * 0.44, 0.12, 0.06, -L * 0.25, deck + 0.06, W / 2 - 0.03), box(L * 0.44, 0.12, 0.06, -L * 0.25, deck + 0.06, -W / 2 + 0.03), // bed rails
      box(0.07, 0.14, W, -L / 2 + 0.035, deck + 0.07, 0),                         // tailgate
    ]);
    const glass = merge([box(cabL * 0.9, 0.34, W * 0.95, cabX, 0.8, 0), box(0.04, 0.38, W * 0.86, cabX + cabL / 2 + 0.07, 0.8, 0, 0.42)]);
    const dark = merge([box(L * 0.42, 0.03, W * 0.86, -L * 0.25, deck + 0.005, 0), box(0.1, 0.16, W * 1.03, L / 2, 0.27, 0), box(0.1, 0.16, W * 1.03, -L / 2, 0.27, 0), box(0.03, 0.14, W * 0.6, L / 2 + 0.01, 0.46, 0)]);
    return { paint, glass, dark, ...wheelSet(0.24, [L * 0.3, -L * 0.3], W / 2 - 0.06, 0.16), head: lights(L / 2 + 0.005, 0.48, W * 0.36, 0.16), tail: lights(-L / 2 - 0.005, 0.52, W * 0.42, 0.1) };
  }
  // a box truck: cab in front, a tall cargo box with the series' words painted on it
  const cabL = L * 0.24, cabX = L / 2 - cabL / 2, boxL = L * 0.72, boxX = -L / 2 + boxL / 2;
  const paint = merge([box(cabL, 0.62, W * 0.94, cabX, 0.66, 0), box(cabL * 0.9, 0.08, W * 0.9, cabX - 0.03, 1.4, 0)]);
  const cargo = box(boxL, 1.2, W, boxX, 1.0, 0);
  const glass = merge([box(cabL * 0.82, 0.38, W * 0.95, cabX - 0.04, 1.16, 0), box(0.04, 0.38, W * 0.86, L / 2 - 0.02, 1.16, 0, 0.1)]);
  const dark = merge([box(L, 0.2, W * 0.86, 0, 0.36, 0), box(0.1, 0.18, W * 1.02, L / 2, 0.32, 0), box(0.02, 0.22, W * 0.6, L / 2 + 0.01, 0.62, 0), box(0.05, 0.12, W, -L / 2, 0.33, 0)]);
  return { paint, cargo, glass, dark, ...wheelSet(0.29, [L * 0.34, -L * 0.2, -L * 0.36], W / 2 - 0.08, 0.2), head: lights(L / 2 + 0.005, 0.56, W * 0.38, 0.18), tail: lights(-L / 2 - 0.005, 0.5, W * 0.44, 0.12) };
}

/** the words on a box truck's cargo box: one plane on the side toward the camera, one on the roof
 *  (placed without the truck's rotation, so they always read left to right) */
export function truckDecalGeometry(L, W) {
  const boxL = L * 0.72, w = boxL * 0.9, h = w / 4;
  const side = new THREE.PlaneGeometry(w, h).translate(0, 1.05, W / 2 + 0.006);
  const roof = new THREE.PlaneGeometry(w, h * 1.3).rotateX(-Math.PI / 2).translate(0, 1.605, 0);
  return { geometry: merge([side, roof]), offset: -L / 2 + boxL / 2 };
}

// ------------------------------------------------------------------ words from the argument
/** a canvas texture with the series' words. style: 'private' (red on white), 'state' (white on
 *  green, a road-sign look), 'truck' (lettering for a box truck), 'paint' (road paint) */
export function wordTexture(style) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = style === 'truck' || style === 'paint' ? 256 : 512;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = () => {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, font = (px) => `${px}px "NewRodin Pro", "Arial Rounded MT Bold", Arial, sans-serif`;
    g.clearRect(0, 0, W, H); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (style === 'private' || style === 'state') {
      const bg = style === 'private' ? '#f6f3ea' : '#1f6b3c', ink = style === 'private' ? '#c0241c' : '#ffffff';
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = ink; g.lineWidth = 22; g.strokeRect(26, 26, W - 52, H - 52);
      g.fillStyle = ink; g.font = font(150); g.fillText(style === 'private' ? 'PRIVATE' : 'STATE', W / 2, H * 0.36);
      g.font = font(124); g.fillText('PROPERTY', W / 2, H * 0.68);
    } else if (style === 'truck') {
      g.fillStyle = '#2a2f6a'; g.font = font(150); g.fillText('STATE PROPERTY', W / 2, H * 0.55, W * 0.94);
    } else {
      g.fillStyle = '#f3f1e6'; g.font = font(170); g.fillText('PRIVATE PROPERTY', W / 2, H * 0.55, W * 0.96);
    }
    tex.needsUpdate = true;
  };
  draw();
  // redraw once the series' font has arrived (the first draw may have used a fallback)
  document.fonts?.load('100px "NewRodin Pro"').then(draw).catch(() => {});
  return tex;
}

/** a sign board on a post, facing +Z: wood (post and board) and the face (textured) */
export function signGeometries() {
  const wood = merge([
    placed(new THREE.BoxGeometry(0.05, 0.62, 0.05), { p: V(0, 0.31, -0.03) }),
    placed(new THREE.BoxGeometry(0.58, 0.31, 0.03), { p: V(0, 0.5, 0) }),
  ]);
  return { wood, face: new THREE.PlaneGeometry(0.54, 0.27).translate(0, 0.5, 0.016) };
}

// ------------------------------------------------------------------ ants, floats and lost hooks
/** an ant (the Ant POV's), about 7 cm long: larger than life so it reads at this scale; walks along +X */
export function antGeometry() {
  const s = () => new THREE.SphereGeometry(1, 8, 6);
  const parts = [
    placed(s(), { p: V(-0.026, 0.016, 0), s: V(0.022, 0.015, 0.016) }),  // abdomen
    placed(s(), { p: V(0.002, 0.016, 0), s: V(0.012, 0.008, 0.008) }),   // thorax
    placed(s(), { p: V(0.022, 0.018, 0), s: V(0.01, 0.009, 0.009) }),    // head
  ];
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 3; k++) parts.push(placed(new THREE.CylinderGeometry(0.0016, 0.0016, 0.032, 3), { p: V(0.002 + (k - 1) * 0.008, 0.009, sd * 0.012), r: new THREE.Euler(sd * 1.0, 0, (k - 1) * 0.5) }));
    parts.push(placed(new THREE.CylinderGeometry(0.0012, 0.0012, 0.022, 3), { p: V(0.034, 0.03, sd * 0.006), r: new THREE.Euler(sd * 0.5, 0, -0.9) }));
  }
  return merge(parts);
}

/** the fisherman's red and white float, as two halves and a little stick */
export function bobberGeometries() {
  return {
    top: new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    bottom: new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    stick: new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5).translate(0, 0.085, 0),
  };
}

/** a lost hook lying flat on the ground (about 14 cm, larger than life) */
export function lostHookGeometry() {
  return merge([
    placed(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), { p: V(0, 0.006, -0.02), r: new THREE.Euler(Math.PI / 2, 0, 0) }),
    placed(new THREE.TorusGeometry(0.035, 0.006, 6, 14, Math.PI * 1.15), { p: V(0.035, 0.006, 0.04), r: new THREE.Euler(-Math.PI / 2, 0, Math.PI) }),
    placed(new THREE.ConeGeometry(0.01, 0.035, 6), { p: V(0.068, 0.006, 0.02), r: new THREE.Euler(-Math.PI / 2, 0, 0.2) }),
    placed(new THREE.TorusGeometry(0.01, 0.004, 5, 10), { p: V(0, 0.006, -0.085), r: new THREE.Euler(-Math.PI / 2, 0, 0) }),
  ]);
}

/** a clover patch: a few flat round leaves */
export function cloverGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) { const a = i * 2.4, r = 0.03 + (i % 3) * 0.02; parts.push(placed(new THREE.CircleGeometry(0.018, 7).rotateX(-Math.PI / 2), { p: V(Math.cos(a) * r, 0.006 + (i % 2) * 0.004, Math.sin(a) * r) })); }
  return merge(parts);
}
