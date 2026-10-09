// Environment: sky, sun, lawn with instanced grass, trees, road with guardrail, pond.
import * as THREE from 'three';
import { patchMaterial, globalUniforms, TrampleMap, TRAMPLE_GLSL } from './shading.js';

export const SUN_DIR = new THREE.Vector3(-0.42, 0.74, 0.53).normalize(); // direction TO the sun

/**
 * opts.grass: where the instanced grass grows, {x, z, r} (default: around the fisherman POV's
 * spot) and opts.grassScale: instance-count multiplier for a bigger field.
 */
export function createWorld(renderer, quality, opts = {}) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbfd3e0, 35, 130);
  globalUniforms.uSunDir.value.copy(SUN_DIR);

  // ---------------- sky
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 zen = vec3(0.30, 0.52, 0.86), hor = vec3(0.78, 0.86, 0.93), gnd = vec3(0.42, 0.48, 0.38);
        vec3 c = mix(hor, zen, pow(max(h, 0.0), 0.55));
        c = mix(gnd, c, smoothstep(-0.08, 0.02, h));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 6.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ---------------- lights
  const hemi = new THREE.HemisphereLight(0xc7dcff, 0x61773d, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d8, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  const sc = sun.shadow.camera;
  sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 0.5; sc.far = 40;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // ---------------- ground
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  patchMaterial(groundMat, {
    fragmentHook: (fs) => fs.replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 p = vWPos.xz;
        float n = pp_fbm(p * 0.35), m = pp_fbm(p * 2.1 + 7.0), f = pp_noise(p * 18.0);
        vec3 g1 = vec3(0.105, 0.215, 0.045), g2 = vec3(0.17, 0.30, 0.07), dry = vec3(0.32, 0.33, 0.12);
        vec3 c = mix(g1, g2, smoothstep(0.3, 0.7, n));
        c = mix(c, dry, smoothstep(0.62, 0.8, m) * 0.45);
        c *= 0.8 + 0.4 * f;
        // mowing stripes
        c *= 0.94 + 0.06 * step(0.5, fract(p.x * 0.4 + p.y * 0.05));
        float road = smoothstep(4.2, 3.9, abs(p.y + 14.0));
        c = mix(c, vec3(0.16, 0.16, 0.16) * (0.85 + 0.3 * pp_noise(p * 6.0)), road);
        float line = (1.0 - smoothstep(0.06, 0.08, abs(abs(p.y + 14.0) - 3.6))) * road;
        c = mix(c, vec3(0.85, 0.85, 0.8), line * 0.8);
        float gravel = smoothstep(4.7, 4.2, abs(p.y + 14.0)) * (1.0 - road);
        c = mix(c, vec3(0.38, 0.35, 0.3), gravel * 0.7);
        float tr = trampleAt(p);
        c = mix(c, vec3(0.13, 0.12, 0.06) * (0.7 + 0.6 * f), clamp(tr * 1.4, 0.0, 0.9));
        diffuseColor.rgb = c; }`).replace('#include <common>', '#include <common>\n' + TRAMPLE_GLSL),
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------------- instanced grass near the play area
  const grass = makeGrass(Math.round(quality.grass * (opts.grassScale ?? 1)), opts.grass);
  scene.add(grass);

  // ---------------- trees
  const trees = makeTrees(scene, quality);

  // ---------------- guardrail along the road
  const rail = makeGuardrail();
  scene.add(rail);

  // ---------------- pond with reeds
  const pond = makePond(quality);
  scene.add(pond);

  // ---------------- environment map for reflections (sky + ground + tree band)
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const band = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 16, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x2d4a22, side: THREE.BackSide }));
  band.position.y = 6; envScene.add(band);
  const gEnv = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: 0x3f5a26 }));
  gEnv.rotation.x = -Math.PI / 2; envScene.add(gEnv);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;

  const trample = new TrampleMap(256);
  return {
    scene, sun, hemi, grass, trees, trample,
    update(dt, focus) {
      globalUniforms.uTime.value += dt;
      trample.update();
      // keep the shadow frustum centred on the action
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(SUN_DIR, 20);
      // snap to texels to avoid shimmering
      const texel = (sc.right - sc.left) / quality.shadow;
      sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
      sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
      sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 20);
    },
  };
}

// the pond (water + bank) is no place for grass
const POND_C = { x: 11, z: 6.5, rx: 5.2 * 1.3, rz: 5.2 };
const inPond = (x, z) => ((x - POND_C.x) / POND_C.rx) ** 2 + ((z - POND_C.z) / POND_C.rz) ** 2 < 1;

function makeGrass(count, area = { x: -0.5, z: 1.2, r: 13 }) {
  // a clump of 5 blades, each a curved strip of 3 quads
  const blades = 5, segs = 2;
  const pos = [], uv = [], idx = [];
  let v = 0;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + Math.random();
    const r = Math.random() * 0.035;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const facing = Math.random() * Math.PI;
    const w = 0.009 + Math.random() * 0.006, h = 0.07 + Math.random() * 0.08;
    const lean = (Math.random() - 0.5) * 0.06;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ww = w * (1 - t * 0.85);
      const y = h * t, dx = lean * t * t;
      for (const side of [-1, 1]) {
        pos.push(ox + Math.cos(facing) * ww * side + Math.cos(a) * dx, y, oz + Math.sin(facing) * ww * side + Math.sin(a) * dx);
        uv.push(side * 0.5 + 0.5, t);
      }
      if (s < segs) { idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  patchMaterial(mat, {
    vertexHook: (vs) => vs.replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vH;\nvarying vec3 vTint;\n' + TRAMPLE_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float hgt = uv.y;
        float trm = trampleAt(ip.xz);
        float tf = smoothstep(0.05, 0.5, trm);
        transformed.y *= 1.0 - 0.9 * tf;
        transformed.xz *= 1.0 + 1.2 * tf;
        float wv = sin(uTime * 1.7 + ip.x * 0.7 + ip.z * 0.5) * 0.5 + sin(uTime * 3.1 + ip.x * 2.1) * 0.25;
        transformed.x += wv * 0.018 * hgt * hgt;
        transformed.z += wv * 0.010 * hgt * hgt;
        vH = hgt;
        float hv = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vTint = mix(vec3(0.13, 0.26, 0.05), vec3(0.24, 0.36, 0.09), hv);
        if (hv > 0.9) vTint = vec3(0.34, 0.36, 0.14);
        vTint = mix(vTint, vec3(0.10, 0.11, 0.04), tf * 0.8);`)
      // grass normals: bend towards up for softer lighting
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\ntransformedNormal = normalize(mix(transformedNormal, normalMatrix * vec3(0.0, 1.0, 0.0), 0.6));'),
    fragmentHook: (fs) => fs.replace('#include <common>', '#include <common>\nvarying float vH;\nvarying vec3 vTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTint * (0.55 + 0.65 * vH);'),
  });
  const mesh = new THREE.InstancedMesh(g, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let i = 0;
  while (i < count) {
    // denser near the middle of the play area, sparser further away
    const r = Math.pow(Math.random(), 0.75) * area.r;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r + area.x, z = Math.sin(a) * r + area.z;
    if (Math.abs(z + 14) < 4.8 || inPond(x, z)) continue; // no grass on the road or in the pond
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    // blades get shorter toward the edge of the field instead of stopping in a hard line
    const edge = 0.35 + 0.65 * THREE.MathUtils.smoothstep(area.r - r, 0, area.r * 0.18);
    const sc = (0.8 + Math.random() * 0.6) * edge;
    s.set(sc, sc * (0.8 + Math.random() * 0.5), sc);
    m.compose(new THREE.Vector3(x, 0, z), q, s);
    mesh.setMatrixAt(i++, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    const x = 20 + Math.random() * 88, y = 20 + Math.random() * 88, a = Math.random() * Math.PI;
    const l = 14 + Math.random() * 10;
    const sh = 0.75 + Math.random() * 0.5;
    g.fillStyle = `rgb(${Math.round(70 * sh)},${Math.round(110 * sh)},${Math.round(40 * sh)})`;
    g.beginPath();
    g.ellipse(x, y, l, l * 0.45, a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeTrees(scene, quality) {
  const tex = leafTexture();
  const leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color: 0xb9c79a });
  patchMaterial(leafMat, {
    vertexHook: (vs) => vs.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          transformed.xy += vec2(sin(uTime * 1.3 + ip.x + ip.y), cos(uTime * 1.1 + ip.z)) * 0.04; }`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        { vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          transformedNormal = normalize(normalMatrix * normalize(ip - vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]) + vec3(0.0, 1.0, 0.0) * 0.5)); }`),
    canopy: false,
  });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.95 });
  // tree list: [x, z, height, crown radius, near(shadow caster)]
  const list = [
    [-6.5, 4.5, 8.5, 3.6, true], [-12, -5, 10, 4.5, false], [7, -6.5, 9, 4.2, false], [-3, -9.5, 7.5, 3.2, false],
    [13, 3, 9.5, 4, false], [-18, 6, 11, 5, false], [3, 11, 8, 3.6, false], [-9, 12, 10, 4.5, false], [18, -3, 10, 4.5, false],
  ];
  // distant tree line
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.1;
    const r = 30 + Math.random() * 14;
    list.push([Math.cos(a) * r, Math.sin(a) * r - 4, 9 + Math.random() * 6, 4 + Math.random() * 2.5, false]);
  }
  const perTree = quality.leaves;
  // hedge of shrubs between the truck and the road (seen through the cab windows)
  const bushes = [];
  for (let x = -14; x <= 12; x += 1.1 + Math.random() * 0.6) {
    if (x > 6 && x < 8.5) continue; // a gap toward the road / pond
    bushes.push([x + (Math.random() - 0.5) * 0.5, -6.6 + (Math.random() - 0.5) * 1.4, 1.0 + Math.random() * 1.2]);
  }
  const perBush = Math.round(perTree * 0.35);
  const nearLeaves = Math.round(perTree * 1.35); // nearby crowns get fuller foliage
  const total = list.length * nearLeaves + bushes.length * perBush;
  const card = new THREE.PlaneGeometry(1.1, 1.1);
  const leaves = new THREE.InstancedMesh(card, leafMat, total);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  // wood and the crown cores are instanced too: three draw calls for every tree in the scene
  const trunkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 9).translate(0, 0.5, 0); // base at the origin
  const branchGeo = new THREE.CylinderGeometry(0.35, 1, 1, 6).translate(0, 0.5, 0);
  const coreGeo = new THREE.IcosahedronGeometry(1, 2);
  { // lumpy, not a smooth ball
    const pa = coreGeo.attributes.position, v = new THREE.Vector3();
    const bump = (p) => 1 + 0.16 * Math.sin(p.x * 5.1 + p.y * 2.3) * Math.cos(p.z * 4.3 - p.y * 3.7) + 0.08 * Math.sin(p.x * 11 + p.z * 9);
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); v.multiplyScalar(bump(v)); pa.setXYZ(i, v.x, v.y, v.z); }
    coreGeo.computeVertexNormals();
  }
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x223817, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, list.length);
  const branches = new THREE.InstancedMesh(branchGeo, barkMat, list.length * 5);
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, list.length * 3);
  let k = 0, nt = 0, nb = 0, nc = 0;
  const canopy = [];
  for (const [x, z, h, cr, near] of list) {
    const far = Math.hypot(x, z) > 25;
    const trunkH = h * 0.55, girth = 0.28 * (h / 9);
    const lean = new THREE.Euler((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.08);
    q.setFromEuler(lean);
    m.compose(new THREE.Vector3(x, 0, z), q, s.set(girth, trunkH, girth));
    trunks.setMatrixAt(nt++, m);
    const top = new THREE.Vector3(0, trunkH, 0).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
    const cy = trunkH + cr * 0.55;
    const crown = new THREE.Vector3(top.x, cy, top.z);
    // 3-5 limbs fanning upward from the top of the trunk, ending inside the crown
    const nLimbs = 3 + Math.floor(Math.random() * 3), a0 = Math.random() * Math.PI * 2;
    for (let b = 0; b < nLimbs; b++) {
      const az = a0 + (b / nLimbs) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const el = THREE.MathUtils.degToRad(38 + Math.random() * 22);
      const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      const len = cr * (0.5 + Math.random() * 0.2);
      const start = top.clone().addScaledVector(UP, -trunkH * (0.04 + Math.random() * 0.12));
      q.setFromUnitVectors(UP, dir);
      m.compose(start, q, s.set(girth * 0.3, len, girth * 0.3));
      branches.setMatrixAt(nb++, m);
    }
    // a dark leafy core so the sky doesn't show through the leaf cards
    for (let c = 0; c < 3; c++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * cr * 0.6, (Math.random() - 0.4) * cr * 0.35, (Math.random() - 0.5) * cr * 0.6);
      const f = 0.82 + Math.random() * 0.25;
      q.setFromEuler(e.set(0, Math.random() * Math.PI, 0));
      m.compose(crown.clone().add(off), q, s.set(cr * 0.5 * f, cr * 0.38 * f, cr * 0.5 * f));
      cores.setMatrixAt(nc++, m);
    }
    for (let i = 0, n = far ? perTree : nearLeaves; i < n; i++) {
      // points in a lumpy ellipsoid, mostly toward its surface (that's where foliage is)
      const u = Math.random(), vv = Math.random();
      const th = Math.acos(2 * u - 1), ph = vv * Math.PI * 2;
      const rr = (0.55 + 0.45 * Math.cbrt(Math.random())) * cr * (0.8 + 0.2 * Math.random());
      const px = crown.x + Math.sin(th) * Math.cos(ph) * rr * 1.1;
      const py = cy + Math.cos(th) * rr * 0.75;
      const pz = crown.z + Math.sin(th) * Math.sin(ph) * rr * 1.1;
      e.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      q.setFromEuler(e);
      const sc = (far ? 1.7 : 1.1) * (0.75 + Math.random() * 0.6);
      s.set(sc, sc, sc);
      m.compose(new THREE.Vector3(px, py, pz), q, s);
      leaves.setMatrixAt(k++, m);
    }
    if (near) canopy.push(new THREE.Vector4(x, z, cr * 1.05, cy));
  }
  trunks.count = nt; branches.count = nb; cores.count = nc;
  for (const im of [trunks, branches, cores]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); }
  for (const [x, z, r] of bushes) {
    for (let i = 0; i < perBush; i++) {
      const u = Math.random(), vv = Math.random();
      const th = Math.acos(2 * u - 1) * 0.5, ph = vv * Math.PI * 2; // upper hemisphere
      const rr = Math.cbrt(Math.random()) * r;
      e.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      q.setFromEuler(e);
      const sc = 0.55 + Math.random() * 0.5;
      s.set(sc, sc, sc);
      m.compose(new THREE.Vector3(x + Math.sin(th) * Math.cos(ph) * rr * 1.3, Math.max(0.25, Math.cos(th) * rr * 1.1 + 0.2), z + Math.sin(th) * Math.sin(ph) * rr), q, s);
      leaves.setMatrixAt(k++, m);
    }
  }
  leaves.count = k;
  leaves.castShadow = true;
  leaves.receiveShadow = false;
  leaves.frustumCulled = false;
  scene.add(leaves);
  canopy.forEach((c, i) => { if (i < 4) globalUniforms.uCanopy.value[i].copy(c); });
  return { leaves, list };
}

function makeGuardrail() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xa9adb0, roughness: 0.4, metalness: 0.8 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.8 });
  const z = -9.4;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(60, 0.32, 0.06), metal);
  beam.position.set(4, 0.62, z);
  beam.castShadow = true; beam.receiveShadow = true;
  g.add(beam);
  for (let x = -26; x <= 34; x += 2) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), postMat);
    p.position.set(x, 0.37, z - 0.1);
    p.castShadow = true;
    g.add(p);
  }
  return g;
}

function makePond(quality) {
  const g = new THREE.Group();
  const cx = 11, cz = 6.5;
  const water = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), new THREE.MeshPhysicalMaterial({
    color: 0x24321f, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.4,
  }));
  patchMaterial(water.material, {
    fragmentHook: (fs) => fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec2 p = vWPos.xz; float t = uTime;
        float a = pp_noise(p * 3.0 + vec2(t * 0.3, t * 0.2)), b = pp_noise(p * 7.0 - vec2(t * 0.4, -t * 0.1));
        normal = normalize(normal + vec3(a - 0.5, b - 0.5, 0.0) * 0.18); }`),
    canopy: false,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, 0.02, cz);
  water.scale.set(1.3, 1, 1);
  water.receiveShadow = true;
  g.add(water);
  // muddy bank
  const bank = new THREE.Mesh(new THREE.RingGeometry(4.5, 5.2, 48), new THREE.MeshStandardMaterial({ color: 0x4a4430, roughness: 1 }));
  bank.rotation.x = -Math.PI / 2; bank.position.set(cx, 0.012, cz); bank.scale.set(1.3, 1, 1);
  g.add(bank);
  // reeds / tall grass
  const reedGeo = new THREE.ConeGeometry(0.015, 1, 3, 1, true);
  reedGeo.translate(0, 0.5, 0);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x6d7a3a, roughness: 0.9, side: THREE.DoubleSide });
  patchMaterial(reedMat, {
    vertexHook: (vs) => vs.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          transformed.x += sin(uTime * 1.4 + ip.x * 3.0 + ip.z) * 0.06 * position.y * position.y; }`),
  });
  const n = quality.reeds;
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 4.4 + Math.random() * 1.6;
    if (Math.sin(a) < -0.55 && Math.cos(a) < 0) { i--; continue; } // leave an opening toward the truck
    q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.3, Math.random() * 3, (Math.random() - 0.5) * 0.3));
    const h = 0.6 + Math.random() * 0.9;
    s.set(1, h, 1);
    m.compose(new THREE.Vector3(cx + Math.cos(a) * r * 1.3, 0, cz + Math.sin(a) * r), q, s);
    reeds.setMatrixAt(i, m);
  }
  reeds.castShadow = true;
  g.add(reeds);
  g.userData.center = new THREE.Vector3(cx, 0, cz);
  return g;
}
