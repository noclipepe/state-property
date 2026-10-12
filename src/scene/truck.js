// Truck visuals (baked body + runtime wheels/glass) and a small planar rigid-body
// simulation driven by the fishing line: static friction, sliding tyres, suspension rock.
import * as THREE from 'three';
import { loadPack } from '../util/pack.js';
import { patchMaterial } from './shading.js';
import { addTruckFront } from './truck-front.js';

export async function loadTruck(onProgress) {
  const pack = await loadPack(new URL('../../assets/meshes/truck', import.meta.url).href, onProgress);
  return new Truck(pack);
}

const TRUCK_GLSL_HELPERS = /* glsl */`
uniform float uDirt;
float gapLine(float v, float c, float w){ float fw = fwidth(v) * 1.2 + 1e-5; return 1.0 - smoothstep(w, w + fw, abs(v - c)); }
`;

export class Truck {
  constructor({ header, geos }) {
    this.dims = header.dims;
    this.ws = header.windshield;
    this.tumble = header.tumble;
    this.root = new THREE.Group(); // planar position + yaw (on the ground)
    this.root.name = 'truckRoot';
    this.body = new THREE.Group(); // sprung mass: heave/pitch/roll
    this.body.name = 'truckBody';
    this.tilt = new THREE.Group(); // whole-vehicle tip onto one side's tyres (side lift)
    this.tilt.name = 'truckTilt';
    this.root.add(this.tilt);
    this.tilt.add(this.body);

    this.material = this.#makeBodyMaterial();
    const mk = (name, mat = this.material) => {
      const m = new THREE.Mesh(geos[name], mat);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    this.bodyMesh = mk('body');
    this.body.add(this.bodyMesh, mk('interior'), mk('steering'), mk('mirrorBase'));
    // mirror head pivots about a vertical hinge
    const P = this.dims.mirrorPivot;
    this.mirrorPivot = new THREE.Group();
    this.mirrorPivot.position.set(P[0], P[1], P[2] + 0.035);
    this.body.add(this.mirrorPivot);
    this.mirrorHead = mk('mirrorHead');
    this.mirrorHead.position.set(-P[0], -P[1], -(P[2] + 0.035));
    this.mirrorPivot.add(this.mirrorHead);
    this.mirrorAngle = 0; // radians, positive folds back toward the door
    // tow hook
    this.towHook = mk('towHook');
    this.body.add(this.towHook);
    this.frontDetails = addTruckFront(this);

    this.#buildGlass();
    this.#buildWheels();
    this.#buildContactShadow();
    this.sim = new TruckSim(this);
  }

  #makeBodyMaterial() {
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 1.0 });
    const D = this.dims;
    const uniforms = { uDirt: { value: 1.0 } };
    patchMaterial(mat, {
      vertexAO: true, uniforms, aoStrength: 0.9,
      fragmentHook: (fs) => {
        fs = fs.replace('#include <common>', '#include <common>\nvarying float vMid;\nvarying vec3 vONrm;\nfloat bTrim = 0.0;\n' + TRUCK_GLSL_HELPERS);
        // per-material surface + procedural wear
        fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
          float mid = floor(vMid + 0.5);
          vec3 op = vOPos;
          bTrim = 0.0;
          float paint = 1.0 - step(0.5, mid);
          float sideZ = abs(op.z);
          // panel gaps on the body sides
          float gaps = 0.0;
          if (paint > 0.5) {
            float onSide = smoothstep(0.93, 0.97, sideZ) * step(0.52, op.y) * (1.0 - step(${(D.belt + 0.02).toFixed(3)}, op.y));
            gaps += gapLine(op.x, ${D.doorFront.x0.toFixed(3)}, 0.0018) * onSide;
            gaps += gapLine(op.x, ${D.doorFront.x1.toFixed(3)}, 0.0016) * onSide;
            gaps += gapLine(op.x, ${D.doorRear.x1.toFixed(3)}, 0.0018) * onSide;
            // hood seam
            gaps += gapLine(op.x, -0.98, 0.002) * step(1.05, op.y) * (1.0 - step(sideZ, 0.15));
            gaps += gapLine(op.y, 1.06 + (op.x + 1.83) * -0.035, 0.0015) * smoothstep(0.93, 0.97, sideZ) * step(op.x, -0.98) * step(-2.6, op.x);
            // tailgate seams
            gaps += gapLine(op.z, 0.905, 0.002) * step(2.6, op.x) * step(0.6, op.y);
            gaps += gapLine(op.z, -0.905, 0.002) * step(2.6, op.x) * step(0.6, op.y);
            // chips: small dark spots with rust halo; more near window sill and bottom
            float edgeW = smoothstep(0.10, 0.0, abs(op.y - ${D.belt.toFixed(3)})) + smoothstep(0.75, 0.52, op.y);
            float n1 = pp_noise(op.xy * 58.0 + op.z * 3.0);
            float n2 = pp_noise(op.xy * 210.0 + 11.0 + op.z);
            float chip = smoothstep(0.80 - 0.08 * edgeW, 0.84 - 0.08 * edgeW, n1 * 0.7 + n2 * 0.35);
            float speck = smoothstep(0.86 - 0.12 * edgeW, 0.9 - 0.12 * edgeW, pp_noise(op.xy * 520.0 + op.z * 7.0));
            vec3 rust = vec3(0.42, 0.24, 0.12);
            diffuseColor.rgb = mix(diffuseColor.rgb, rust * 0.6, max(chip * 0.85, speck * 0.6));
            // a couple of bigger hand-placed chips like the reference door
            float c1 = length((op.xy - vec2(-0.47, 1.06)) * vec2(1.0, 1.25));
            float c2 = length((op.xy - vec2(-0.12, 1.19)) * vec2(1.0, 1.3));
            float big = (1.0 - smoothstep(0.009, 0.012, c1)) + (1.0 - smoothstep(0.006, 0.008, c2));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.09, 0.11), clamp(big, 0.0, 1.0) * smoothstep(0.9, 0.98, op.z));
            // dirt: grime towards the bottom, streaks below the window
            float dirt = smoothstep(0.95, 0.45, op.y) * (0.6 + 0.4 * pp_fbm(op.xz * 6.0 + op.y * 2.0));
            float streak = smoothstep(${D.belt.toFixed(3)}, ${(D.belt - 0.3).toFixed(3)}, op.y) * step(0.95, sideZ) * smoothstep(0.55, 0.75, pp_noise(vec2(op.x * 60.0, op.y * 3.0)));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.40, 0.33), clamp(dirt * 0.45 * uDirt + streak * 0.12, 0.0, 0.6));
            // fine orange-peel / dull patches
            diffuseColor.rgb *= 0.97 + 0.04 * pp_noise(op.xy * 9.0 + op.z);
            diffuseColor.rgb *= 1.0 - gaps * 0.85;
            // black B-pillar trim between the door windows
            float fwB = fwidth(op.x) * 1.5;
            float bp = smoothstep(0.062 - fwB, 0.062 + fwB, op.x) * (1.0 - smoothstep(0.168 - fwB, 0.168 + fwB, op.x))
                     * smoothstep(${(D.belt + 0.005).toFixed(3)}, ${(D.belt + 0.012).toFixed(3)}, op.y) * step(0.80, sideZ) * step(op.y, ${(D.roof - 0.06).toFixed(3)});
            // rubber seals: faces of the greenhouse openings that don't face outwards
            vec3 on = normalize(vONrm);
            float seal = smoothstep(${(D.belt - 0.012).toFixed(3)}, ${(D.belt + 0.002).toFixed(3)}, op.y) * (1.0 - smoothstep(0.45, 0.62, abs(on.z))) * step(0.78, sideZ)
                       * (1.0 - smoothstep(0.55, 0.75, on.y));
            float wsSeal = step(${(D.belt + 0.03).toFixed(3)}, op.y) * step(op.x, -0.30) * (1.0 - smoothstep(0.35, 0.6, dot(on, normalize(vec3(-0.68, 0.73, 0.0))))) * step(sideZ, 0.80);
            float bwSeal = step(1.33, op.y) * step(0.9, op.x) * (1.0 - smoothstep(0.4, 0.6, on.x)) * step(sideZ, 0.72);
            bp = max(bp, max(seal, max(wsSeal, bwSeal)));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025), bp);
            bTrim = bp;
          }
          // grille mesh pattern
          if (abs(mid - 10.0) < 0.5) {
            vec2 g = fract(vec2(op.z * 40.0, op.y * 40.0));
            float holes = step(0.2, g.x) * step(0.2, g.y);
            diffuseColor.rgb *= mix(1.6, 0.25, holes);
          }
          // diamond plate on the toolbox
          if (abs(mid - 7.0) < 0.5) {
            vec2 dp = vec2(op.x + op.z, op.x - op.z) * 28.0 + vec2(0.0, op.y * 28.0);
            vec2 f = abs(fract(dp) - 0.5);
            float ridge = smoothstep(0.12, 0.05, min(f.x, f.y) * (1.0 + 0.0));
            diffuseColor.rgb *= 0.85 + ridge * 0.3;
          }
          // seat fabric
          if (abs(mid - 11.0) < 0.5) diffuseColor.rgb *= 0.85 + 0.25 * pp_noise(op.xy * 300.0 + op.z * 300.0);
          `);
        fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          {
            float m = floor(vMid + 0.5);
            if (m < 0.5) roughnessFactor = mix(0.42 + 0.25 * pp_noise(vOPos.xy * 14.0 + vOPos.z), 0.3, bTrim);
            else if (m == 1.0 || m == 8.0 || m == 9.0) roughnessFactor = 0.6;
            else if (m == 2.0 || m == 11.0 || m == 12.0) roughnessFactor = 0.85;
            else if (m == 3.0) roughnessFactor = 0.22;
            else if (m == 4.0 || m == 5.0 || m == 6.0) roughnessFactor = 0.12;
            else if (m == 7.0) roughnessFactor = 0.38;
            else if (m == 10.0) roughnessFactor = 0.5;
            else if (m == 13.0) roughnessFactor = 0.45;
          }`);
        fs = fs.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          { float m = floor(vMid + 0.5); metalnessFactor = (m == 3.0) ? 1.0 : (m == 7.0 ? 0.85 : 0.0); }`);
        // clearcoat only on paint
        fs = fs.replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>`);
        fs = fs.replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * (1.0 - step(0.5, vMid)) * 0.8;');
        // lenses glow a little
        fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { float m = floor(vMid + 0.5); if (m == 5.0) totalEmissiveRadiance += vec3(0.25, 0.10, 0.0); if (m == 6.0) totalEmissiveRadiance += vec3(0.12, 0.0, 0.0); }`);
        return fs;
      },
      vertexHook: (vs) => vs.replace('#include <common>', '#include <common>\nattribute float matId;\nvarying float vMid;\nvarying vec3 vONrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMid = matId; vONrm = normal;'),
    });
    return mat;
  }

  #buildGlass() {
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x1d2224, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.22,
      envMapIntensity: 0.75, side: THREE.DoubleSide, depthWrite: false,
    });
    this.glassMat = glass;
    const D = this.dims, TH = this.tumble;
    const ang = Math.atan2(TH.n[1], TH.n[0]); // tilt of side glass
    const sideGlass = (x0, x1, s) => {
      const h = (D.roof - 0.075) - D.frontWin.y0;
      const g = new THREE.PlaneGeometry(x1 - x0 + 0.03, h / Math.cos(ang) + 0.02);
      const m = new THREE.Mesh(g, glass);
      const yc = D.frontWin.y0 + h / 2;
      // z on the tumblehome plane, 12mm inside the skin
      const zc = TH.a[0] - ((yc - TH.a[1]) * TH.n[1] + 0.012) / TH.n[0];
      m.position.set((x0 + x1) / 2, yc, s * zc);
      m.rotation.set(-s * ang, s > 0 ? 0 : Math.PI, 0);
      m.renderOrder = 2;
      return m;
    };
    // rear door windows both sides. Driver window is rolled down.
    this.body.add(sideGlass(D.rearWin.x0, D.rearWin.x1, 1), sideGlass(D.rearWin.x0, D.rearWin.x1, -1));
    // front passenger window: its front edge follows the slanted A-pillar (a plain rectangle left
    // an open triangle at the bottom-front and showed a hard vertical edge mid-window)
    {
      const WS = this.ws, slope = -WS.n[1] / WS.n[0]; // dx/dy along the windshield / A-pillar
      const y0 = D.frontWin.y0 - 0.01, y1 = D.roof - 0.065;
      const xFront = (y) => WS.p0[0] + (y - WS.p0[1]) * slope - 0.02;
      const zAt = (y) => -(TH.a[0] - ((y - TH.a[1]) * TH.n[1] + 0.012) / TH.n[0]);
      const x1 = D.frontWin.x1 + 0.015;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        xFront(y0), y0, zAt(y0), x1, y0, zAt(y0), x1, y1, zAt(y1), xFront(y1), y1, zAt(y1)], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      const front = new THREE.Mesh(g, glass);
      front.renderOrder = 2;
      this.body.add(front);
    }
    // lowered driver glass just visible at the sill
    const lowered = new THREE.Mesh(new THREE.PlaneGeometry(D.frontWin.x1 - D.frontWin.x0 - 0.05, 0.03), glass);
    lowered.position.set((D.frontWin.x0 + D.frontWin.x1) / 2, D.belt - 0.005, 0.945);
    this.body.add(lowered);
    // windshield
    const WS = this.ws;
    const p0 = new THREE.Vector2(WS.p0[0], WS.p0[1]);
    const dir = new THREE.Vector2(-WS.n[1], WS.n[0]);
    const y0 = 1.335, y1 = this.dims.roof - 0.07;
    const t0 = (y0 - p0.y) / dir.y, t1 = (y1 - p0.y) / dir.y;
    const len = t1 - t0;
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.5, len + 0.02), glass);
    const mid = p0.clone().add(dir.clone().multiplyScalar((t0 + t1) / 2));
    ws.position.set(mid.x + WS.n[0] * -0.015, mid.y + WS.n[1] * -0.015, 0);
    ws.rotation.set(0, Math.PI / 2, 0);
    ws.rotateX(Math.atan2(dir.x, dir.y));
    ws.renderOrder = 2;
    this.body.add(ws);
    // back window
    const bw = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.44), glass);
    bw.position.set(this.dims.cabBack - 0.02, 1.565, 0);
    bw.rotation.y = Math.PI / 2;
    bw.renderOrder = 2;
    this.body.add(bw);
  }

  #buildWheels() {
    const D = this.dims;
    const R = D.wheelR;
    // tyre: a squashed torus gives a rounded sidewall with correct outward normals
    const tube = 0.082;
    const tyreGeo = new THREE.TorusGeometry(R - tube, tube, 18, 56);
    tyreGeo.scale(1, 1, 0.122 / tube);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
    patchMaterial(tyreMat, {
      fragmentHook: (fs) => fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float r = length(vOPos.xy); float a = atan(vOPos.y, vOPos.x);
          float tread = step(${(R - 0.03).toFixed(3)}, r) * step(0.5, fract(a * 22.0 + step(0.0, vOPos.z) * 0.5));

          diffuseColor.rgb *= 0.85 + 0.25 * tread; }`),
    });
    // Closed barrel meets the tyre's inner bead. Both caps must exist: ant-height
    // views see the inboard side, where the old open cylinder/one-sided face vanished.
    const rimGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.16, 32);
    rimGeo.rotateX(Math.PI / 2);
    const rimFace = new THREE.CircleGeometry(0.205, 32);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.35, metalness: 0.9 });
    const brakeGeo = new THREE.CylinderGeometry(.115,.115,.065,24);brakeGeo.rotateX(Math.PI/2);
    const brakeMat = new THREE.MeshStandardMaterial({ color:0x41494b, roughness:.78, metalness:.3 });
    const slotGeo = new THREE.BoxGeometry(0.05, 0.022, 0.01);
    const slotMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.8 });
    this.wheels = [];
    const positions = [[D.axleF, 1], [D.axleF, -1], [D.axleR, 1], [D.axleR, -1]];
    for (const [x, s] of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(x, R, s * D.track);
      const spin = new THREE.Group();
      pivot.add(spin);
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true; tyre.receiveShadow = true;
      spin.add(tyre);
      const rim = new THREE.Mesh(rimGeo, rimMat);rim.name='closed-wheel-rim';rim.castShadow=true;rim.receiveShadow=true;spin.add(rim);
      const face = new THREE.Mesh(rimFace, rimMat);
      face.position.z = s * 0.084; face.rotation.y = s > 0 ? 0 : Math.PI;
      spin.add(face);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 16), hubMat);
      hub.rotation.x = Math.PI / 2; hub.position.z = s * 0.10; spin.add(hub);
      const brake = new THREE.Mesh(brakeGeo,brakeMat);brake.name='inboard-brake-drum';brake.position.z=-s*.092;
      brake.castShadow=true;brake.receiveShadow=true;spin.add(brake);
      // lug nuts / slots for visible rotation
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const slot = new THREE.Mesh(slotGeo, slotMat);
        slot.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, s * 0.088);
        slot.rotation.z = a;
        spin.add(slot);
      }
      this.tilt.add(pivot);
      this.wheels.push({ pivot, spin, x, s, angle: 0, restY: R });
    }
  }

  #buildContactShadow() {
    // soft ambient occlusion on the grass under the truck (moves with it)
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const dx = Math.max(0, Math.abs(x - 63.5) / 63.5 - 0.72) / 0.28, dy = Math.max(0, Math.abs(y - 31.5) / 31.5 - 0.55) / 0.45;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 1.6) * 0.62;
      const k = (y * 128 + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 0; img.data[k + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x101808 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.012, 0);
    m.renderOrder = 1;
    this.root.add(m);
  }

  // world-space positions of attach points
  worldPoint(local, target = new THREE.Vector3()) {
    this.body.updateWorldMatrix(true, false);
    return target.copy(local).applyMatrix4(this.body.matrixWorld);
  }
  setMirrorAngle(a) {
    this.mirrorAngle = a;
    this.mirrorPivot.rotation.y = a;
  }
}

// Keeps fishing-line points out of the bodywork: a few boxes in truck-body space.
// begin() once per frame (after the truck moved), then apply(p) per line point (world space).
export function truckLineCollider(truck) {
  const boxes = truck.collisionBoxes || [
    { min: [-0.95, 0.40, -0.995], max: [2.74, 1.285, 0.995] },
    { min: [-2.78, 0.40, -0.995], max: [-0.95, 1.13, 0.995] },
    { min: [-0.40, 1.79, -0.86], max: [0.98, 1.89, 0.86] },
    { min: [0.06, 1.28, 0.80], max: [0.17, 1.86, 0.995] },
    { min: [0.06, 1.28, -0.995], max: [0.17, 1.86, -0.80] },
  ];
  const inv = new THREE.Matrix4();
  const lp = new THREE.Vector3();
  return {
    begin() { inv.copy(truck.body.matrixWorld).invert(); },
    apply(p) {
      lp.copy(p).applyMatrix4(inv);
      let changed = false;
      for (const b of boxes) {
        if (lp.x > b.min[0] && lp.x < b.max[0] && lp.y > b.min[1] && lp.y < b.max[1] && lp.z > b.min[2] && lp.z < b.max[2]) {
          // push out through the nearest face
          const d = [lp.x - b.min[0], b.max[0] - lp.x, lp.y - b.min[1], b.max[1] - lp.y, lp.z - b.min[2], b.max[2] - lp.z];
          let k = 0; for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
          const ax = k >> 1, s = k & 1 ? 1 : -1;
          const val = s > 0 ? b.max[ax] : b.min[ax];
          if (ax === 0) lp.x = val; else if (ax === 1) lp.y = val; else lp.z = val;
          changed = true;
        }
      }
      if (changed) p.copy(lp).applyMatrix4(truck.body.matrixWorld);
    },
  };
}

// --------------------------------------------------------------------------- simulation
// Planar rigid body (x, z, yaw) with Coulomb tyre friction, a strain -> breakaway phase,
// speed / yaw caps, a soft play-area boundary and spring-driven suspension + side lift.
const G = 9.81;
const TMP_Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
export class TruckSim {
  constructor(truck) {
    this.truck = truck;
    this.mass = 2250;
    this.inertia = this.mass * (5.5 * 5.5 + 2 * 2) / 12;
    this.muLong = 0.16; // rolling with the brakes dragging a little
    this.muLat = 0.30; // sideways scrub on grass
    this.breakaway = 6000; // N the line must exceed...
    this.strainNeeded = 0.55; // ...for this long (s) before the tyres let go
    this.maxSpeed = 2.4; // m/s
    this.maxYawRate = 0.8; // rad/s
    // soft bounds for the truck centre (world x/z) + the big tree to keep clear of
    this.bounds = { x0: -6.5, x1: 5.5, z0: -3.8, z1: 4.6 };
    this.avoid = [{ x: -6.5, z: 4.5, r: 3.0 }];
    this.reset();
  }
  reset() {
    const h = this.home || { x: 0, z: 0, yaw: 0 }; // rest pose (the driver POV mode parks elsewhere)
    this.pos = new THREE.Vector2(h.x, h.z); // x, z
    this.yaw = h.yaw;
    this.vel = new THREE.Vector2();
    this.yawRate = 0;
    this.stuck = true;
    this.force = new THREE.Vector3();
    this.forcePoint = new THREE.Vector3();
    this.susp = { heave: 0, heaveV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, lift: 0, liftV: 0, liftSide: 1 };
    this.strain = 0; // 0..1 how hard the line pulls while stuck
    this.strainTime = 0;
    this.lastMoveTime = -10;
    this.time = 0;
    this.prevForce = 0;
    this.events = { breakaway: false, released: false };
    this.slip = [0, 0, 0, 0];
    this.speed = 0;
    this.distance = 0;
    for (const w of this.truck.wheels || []) w.angle = 0;
    this.#apply();
    this.truck.tilt.rotation.set(0, 0, 0);
    this.truck.tilt.position.set(0, 0, 0);
    this.truck.body.position.set(0, 0, 0);
    this.truck.body.rotation.set(0, 0, 0);
  }
  // world-space force applied this frame at a world-space point
  setLineForce(f, point) { this.force.copy(f); this.forcePoint.copy(point); }
  clearForce() { this.force.set(0, 0, 0); }

  step(dt) {
    this.events.breakaway = false;
    this.events.released = false;
    this.time += dt;
    const n = 4, h = dt / n;
    for (let i = 0; i < n; i++) this.#sub(h);
    this.#apply(dt);
  }

  #sub(h) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const ax = new THREE.Vector2(c, -s); // local +X in world
    const az = new THREE.Vector2(s, c); // local +Z in world
    const F = new THREE.Vector2(this.force.x, this.force.z);
    const r = new THREE.Vector2(this.forcePoint.x - this.pos.x, this.forcePoint.z - this.pos.y);
    const torque = r.x * F.y - r.y * F.x;
    const fmag = F.length();
    if (this.stuck) {
      this.strain = Math.min(1, fmag / this.breakaway);
      // resistance phase: the tyres hold until the pull has stayed strong for a moment
      const recent = this.time - this.lastMoveTime < 3;
      if (fmag > this.breakaway * 0.7) this.strainTime += h; else this.strainTime = Math.max(0, this.strainTime - h * 2);
      const needed = recent ? 0.15 : this.strainNeeded;
      if (fmag < this.breakaway || this.strainTime < needed) { this.vel.set(0, 0); this.yawRate = 0; return; }
      // breakaway: a jerk in the pull direction plus a twist from the off-centre hook
      this.stuck = false;
      this.events.breakaway = true;
      const kick = recent ? 0.35 : 0.9;
      this.vel.addScaledVector(F.clone().divideScalar(fmag), kick);
      this.yawRate += THREE.MathUtils.clamp(-torque / this.inertia * 0.35, -0.35, 0.35);
      const S = this.susp;
      const fl = new THREE.Vector3(F.x, 0, F.y).applyQuaternion(TMP_Q.setFromAxisAngle(UP, -this.yaw)).normalize();
      S.rollV += fl.z * 0.9 * kick; S.pitchV += -fl.x * 0.6 * kick; S.heaveV += 0.25 * kick;
      S.liftV += Math.abs(fl.z) * 0.8 * kick;
    }
    // tyre friction at the four contact patches
    let fx = F.x, fz = F.y, tq = -torque;
    const D = this.truck.dims;
    const wheelsLocal = [[D.axleF, D.track], [D.axleF, -D.track], [D.axleR, D.track], [D.axleR, -D.track]];
    const N = this.mass * G / 4;
    for (let i = 0; i < 4; i++) {
      const [lx, lz] = wheelsLocal[i];
      const wx = ax.x * lx + az.x * lz, wz = ax.y * lx + az.y * lz;
      const vx = this.vel.x + this.yawRate * wz, vz = this.vel.y - this.yawRate * wx;
      const vl = vx * ax.x + vz * ax.y;
      const vt = vx * az.x + vz * az.y;
      const reg = 0.08;
      const fl = -this.muLong * N * vl / Math.max(Math.abs(vl), reg);
      const ft = -this.muLat * N * vt / Math.max(Math.abs(vt), reg);
      const fwx = ax.x * fl + az.x * ft, fwz = ax.y * fl + az.y * ft;
      fx += fwx; fz += fwz;
      tq += -(wx * fwz - wz * fwx);
      this.slip[i] = Math.abs(vt);
    }
    // soft walls keep the truck inside the play area (and off the big tree)
    const B = this.bounds, k = 90000;
    if (this.pos.x < B.x0) fx += (B.x0 - this.pos.x) * k;
    if (this.pos.x > B.x1) fx -= (this.pos.x - B.x1) * k;
    if (this.pos.y < B.z0) fz += (B.z0 - this.pos.y) * k;
    if (this.pos.y > B.z1) fz -= (this.pos.y - B.z1) * k;
    for (const a of this.avoid) {
      const dx = this.pos.x - a.x, dz = this.pos.y - a.z, d = Math.hypot(dx, dz);
      if (d < a.r && d > 1e-3) { fx += dx / d * (a.r - d) * k; fz += dz / d * (a.r - d) * k; }
    }
    this.vel.x += (fx / this.mass) * h;
    this.vel.y += (fz / this.mass) * h;
    this.yawRate += (tq / this.inertia) * h;
    this.yawRate *= Math.exp(-h * 1.2);
    // caps keep it controllable
    const sp = this.vel.length();
    if (sp > this.maxSpeed) this.vel.multiplyScalar(this.maxSpeed / sp);
    this.yawRate = THREE.MathUtils.clamp(this.yawRate, -this.maxYawRate, this.maxYawRate);
    this.pos.addScaledVector(this.vel, h);
    this.yaw += this.yawRate * h;
    if (sp > 0.05) this.lastMoveTime = this.time;
    // re-stick once the line is slack and the truck has slid to a stop
    if (fmag < this.breakaway * 0.5 && this.vel.length() < 0.04 && Math.abs(this.yawRate) < 0.04) {
      this.stuck = true; this.vel.set(0, 0); this.yawRate = 0; this.strainTime = 0;
    }
  }

  #apply(dt = 0) {
    const t = this.truck;
    t.root.position.set(this.pos.x, 0, this.pos.y);
    t.root.rotation.y = this.yaw;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const vl = this.vel.x * c - this.vel.y * s;
    this.speed = this.vel.length();
    this.distance += this.speed * dt;
    for (const w of t.wheels) {
      w.angle -= (vl / t.dims.wheelR) * dt;
      w.spin.rotation.z = w.angle;
    }
    if (dt <= 0) return;
    const S = this.susp;
    const invQ = TMP_Q.setFromAxisAngle(UP, -this.yaw);
    const fl = this.force.clone().applyQuaternion(invQ); // force in truck frame
    const rl = this.forcePoint.clone().sub(new THREE.Vector3(this.pos.x, 0, this.pos.y)).applyQuaternion(invQ);
    const fmag = this.force.length();
    // let go while loaded / moving: a damped wobble
    if (this.prevForce > 4000 && fmag < 500) {
      this.events.released = true;
      S.pitchV += (Math.random() - 0.5) * 0.5 + this.speed * 0.15;
      S.rollV += (Math.random() - 0.5) * 0.4;
      S.liftV -= 0.2;
    }
    this.prevForce = fmag;
    // body lean: the pull drags the body toward it, accelerations rock it
    const rollT = fl.z * 0.0000045 * (1 + (0.9 - rl.y)) + fl.y * rl.z * 0.000004;
    const pitchT = -fl.x * 0.0000032 - fl.y * rl.x * 0.000003;
    const heaveT = fl.y * 0.000003;
    const jitter = this.stuck ? 0 : (Math.random() - 0.5) * this.speed;
    const spring = (val, vel, target, k, c2) => (target - val) * k - vel * c2;
    S.rollV += spring(S.roll, S.rollV, rollT, 85, 5.5) * dt + jitter * 0.03;
    S.pitchV += spring(S.pitch, S.pitchV, pitchT, 85, 5.5) * dt + jitter * 0.02;
    S.heaveV += spring(S.heave, S.heaveV, heaveT, 110, 8) * dt + jitter * 0.015;
    S.roll += S.rollV * dt; S.pitch += S.pitchV * dt; S.heave += S.heaveV * dt;
    S.roll = THREE.MathUtils.clamp(S.roll, -0.075, 0.075);
    S.pitch = THREE.MathUtils.clamp(S.pitch, -0.06, 0.06);
    S.heave = THREE.MathUtils.clamp(S.heave, -0.05, 0.05);
    t.body.position.y = S.heave;
    t.body.rotation.set(S.roll, 0, S.pitch);
    for (const w of t.wheels) {
      const comp = S.heave + S.roll * w.s * t.dims.track * -1 + S.pitch * w.x;
      w.pivot.position.y = w.restY + THREE.MathUtils.clamp(comp * 0.25, -0.012, 0.012);
    }
    // side lift: a strong sideways pull tips the whole truck onto the near-side tyres
    const lat = Math.abs(fl.z);
    if (lat > 2000) S.liftSide = Math.sign(fl.z);
    const liftT = Math.min(0.05, Math.max(0, lat - 6000) / 9000 * 0.05);
    S.liftV += spring(S.lift, S.liftV, liftT, 60, 4.5) * dt;
    S.lift += S.liftV * dt;
    S.lift = THREE.MathUtils.clamp(S.lift, 0, 0.06);
    // rotate about the near-side contact line (z = pivot, y = 0)
    const a = S.lift * S.liftSide, pz = S.liftSide * (t.dims.track + 0.12);
    t.tilt.rotation.x = a;
    t.tilt.position.set(0, pz * Math.sin(a), pz - pz * Math.cos(a));
  }
}
