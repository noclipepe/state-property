// The endless course, generated ahead of the fish and recycled behind it. Four kinds of row:
//   grass   safe ground; buckets, boulders and bushes block cells
//   sand    a crab lane: one crab species per lane, walking sideways in groups
//   road    cars, pickups and box trucks at real size: a vehicle lane is 2 or 3 rows wide; an
//           "express" lane sends one fast pickup through, announced by lights
//   stream  water: the current carries the fish sideways; drift off the edge and you're swept away
// A grass row can be a "PRIVATE PROPERTY" fence with one or two gates: you have to go round.
// Everything is in "course space": the group's -Z is forward, +X is right, one row = one cell.
// Row r sits at z = -r·cell, column c at x = c·cell.
//
// Fairness rules the generator keeps:
//   - a grass row never loses all its cells, and the cells you can reach stay connected to the next
//     row (at least ESCAPE.course.minFreeCells of them);
//   - no dead ends: every stretch of a row you can reach leads straight on into the next row, so
//     you never have to go back to get round blockers or to a fence's gate;
//   - every moving lane leaves gaps that stay open long enough to hop across all of its rows;
//   - in consecutive lanes, the gap you stand in lasts longer than the next lane stays blocked,
//     so a crossing is always possible by waiting in the right spot;
//   - streams are one to three rows with grass on both sides;
//   - the number of rows and movers is bounded (rows behind are recycled).
import * as THREE from 'three';
import { ESCAPE, at, lerp } from './config.js';
import { patchMaterial } from '../scene/shading.js';
import { merge, crabGeometries, bucketGeometries, bucketMaterials, vehicleGeometries, truckDecalGeometry, wordTexture, signGeometries, antGeometry, bobberGeometries, lostHookGeometry, boulderGeometry, flowerGeometry, shellGeometry, tuftGeometry, mushroomGeometries, cloverGeometry } from './models.js';

const C = ESCAPE.cell, COLS = ESCAPE.columns, F = ESCAPE.fish, MAX_VEHICLES = 40;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wrap = (x, len) => x - len * Math.floor((x + len / 2) / len);
const SPECIES = Object.keys(ESCAPE.crabs).filter((k) => k !== 'king');
const KINDS = Object.keys(ESCAPE.vehicles);

// a small seeded generator, so a run (and a test) can be replayed
export function rng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(a + next() * (b - a + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

// ------------------------------------------------------------------ ground materials
function groundMaterial(kind, parity) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: kind === 'stream' ? 0.12 : 0.95, metalness: 0 });
  const shade = (parity ? 0.88 : 1.0).toFixed(2);
  const body = {
    // crisp alternating lawn stripes with soft patches
    grass: `vec3 g1 = vec3(0.13, 0.29, 0.05), g2 = vec3(0.18, 0.36, 0.075), dry = vec3(0.32, 0.34, 0.12);
      c = mix(g1, g2, smoothstep(0.3, 0.7, n)); c = mix(c, dry, smoothstep(0.66, 0.82, m) * 0.35);
      c *= 0.9 + 0.2 * f;`,
    // the damp, sandy shore crabs come up on: wet patches, pebbles, ripples left by the tide
    sand: `vec3 s1 = vec3(0.50, 0.41, 0.25), s2 = vec3(0.62, 0.52, 0.33), wet = vec3(0.36, 0.29, 0.17);
      c = mix(s1, s2, smoothstep(0.3, 0.7, n)); c = mix(c, wet, smoothstep(0.55, 0.78, m) * 0.55);
      c *= 0.93 + 0.07 * sin(vOPos.x * 9.0 + n * 6.0);
      c = mix(c, vec3(0.55, 0.53, 0.47), step(0.94, pp_noise(p * 31.0)) * 0.6);
      c *= 0.88 + 0.24 * f;`,
    // tarmac with a lighter worn strip in the middle of the lane
    road: `vec3 a1 = vec3(0.10, 0.10, 0.11), a2 = vec3(0.16, 0.16, 0.17);
      c = mix(a1, a2, smoothstep(0.25, 0.75, n)); c *= 0.85 + 0.3 * f;
      c = mix(c, c * 1.25, smoothstep(0.2, 0.0, abs(vOPos.z)) * 0.4);
      c = mix(c, vec3(0.28), step(0.97, pp_noise(p * 40.0)) * 0.5);`,
    // flowing water: streaks that move with the current, foam where it meets the banks
    stream: `float flow = vFlow;
      vec2 q = vec2(vOPos.x - uTime * flow * ${C.toFixed(2)}, vOPos.z * 3.0);
      float w1 = pp_noise(q * vec2(1.4, 3.0)), w2 = pp_noise(q * vec2(4.0, 8.0) + 3.0);
      vec3 deep = vec3(0.04, 0.18, 0.22), shallow = vec3(0.12, 0.40, 0.42);
      c = mix(deep, shallow, smoothstep(0.3, 0.8, w1 * 0.6 + w2 * 0.4));
      float streak = smoothstep(0.72, 0.78, w2) * (1.0 - smoothstep(0.78, 0.86, w2));
      float edge = smoothstep(${(C * 0.36).toFixed(3)}, ${(C * 0.5).toFixed(3)}, abs(vOPos.z) + (w2 - 0.5) * 0.06);
      c += vec3(0.5, 0.62, 0.6) * streak * 0.5;
      c = mix(c, vec3(0.78, 0.86, 0.82), edge * 0.85);`,
  }[kind];
  patchMaterial(m, {
    canopy: false,
    vertexHook: kind === 'stream' ? (vs) => vs.replace('#include <common>', '#include <common>\nvarying float vFlow;')
      // the row's flow speed rides on the strip's (flat) y scale: 10 + cells per second
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = length(modelMatrix[1].xyz) - 10.0;') : undefined,
    fragmentHook: (fs) => fs.replace('#include <common>', '#include <common>\n' + (kind === 'stream' ? 'varying float vFlow;' : ''))
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 p = vWPos.xz;
        float n = pp_fbm(p * 0.35), m = pp_fbm(p * 2.1 + 7.0), f = pp_noise(p * 18.0);
        vec3 c;
        ${body}
        diffuseColor.rgb = c * ${shade}; }`),
  });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
  return m;
}

const inst = (geo, mat, n, { shadow = true, color = false } = {}) => {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
  if (color) m.setColorAt(0, new THREE.Color(1, 1, 1));
  return m;
};

export class Course {
  constructor(parent, { leafMaterial, leafGeometry, inPond, depth }) {
    this.depth = depth || (() => 0); // how far below the surface a crab is (in the lake)
    this.group = new THREE.Group(); parent.add(this.group);
    this.inPond = inPond; // (local x, z) → true where the real pond is (no decoration, no roads there)
    this.mats = {
      grass: [groundMaterial('grass', 0), groundMaterial('grass', 1)], sand: [groundMaterial('sand', 0), groundMaterial('sand', 1)],
      road: [groundMaterial('road', 0), groundMaterial('road', 0)], stream: [groundMaterial('stream', 0), groundMaterial('stream', 0)],
    };
    this.stripGeo = new THREE.PlaneGeometry(72, C).rotateX(-Math.PI / 2);
    this.strips = [];
    const add = (...meshes) => { for (const m of meshes) this.group.add(m); };
    const white = (o = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, ...o });
    // crabs: body, claws (mirrored for the left side, so both faces are drawn) and legs
    const cg = crabGeometries(), MAX_CRABS = 360;
    this.crabBody = inst(cg.body, white(), MAX_CRABS, { color: true });
    this.crabClaw = inst(cg.claw, white({ roughness: 0.5, side: THREE.DoubleSide }), MAX_CRABS * 2, { color: true });
    this.crabLeg = inst(cg.leg, white({ roughness: 0.6 }), MAX_CRABS * 6, { color: true });
    add(this.crabBody, this.crabClaw, this.crabLeg);
    // vehicles: one set of instanced parts per kind (car, pickup, box truck), painted per instance
    const MAX_CARS = MAX_VEHICLES, vm = {
      paint: white({ roughness: 0.32, metalness: 0.12 }), cargo: white({ roughness: 0.55 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1b2a38, roughness: 0.08, metalness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.75 }),
      wheels: new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.8 }), hubs: new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.3, metalness: 0.7 }),
      head: new THREE.MeshBasicMaterial({ color: 0xfff1b8 }), tail: new THREE.MeshBasicMaterial({ color: 0xc8231b }),
    };
    this.vehicles = {};
    for (const kind of KINDS) {
      const V0 = ESCAPE.vehicles[kind], L = V0.length * C * 0.97, W = V0.rows * C - 0.14, geos = vehicleGeometries(kind, L, W);
      const parts = {};
      for (const [name, geo] of Object.entries(geos)) parts[name] = inst(geo, vm[name], MAX_CARS, { shadow: !['head', 'tail', 'hubs'].includes(name), color: name === 'paint' || name === 'cargo' });
      add(...Object.values(parts));
      this.vehicles[kind] = { parts };
      if (kind === 'truck') {
        const d = truckDecalGeometry(L, W);
        this.vehicles[kind].decal = inst(d.geometry, new THREE.MeshBasicMaterial({ map: wordTexture('truck'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), MAX_CARS, { shadow: false });
        this.vehicles[kind].decalOffset = d.offset; add(this.vehicles[kind].decal);
      }
    }
    // words painted on the tarmac now and then
    this.roadWords = inst(new THREE.PlaneGeometry(2.6, 0.65).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: wordTexture('paint'), transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 40, { shadow: false });
    add(this.roadWords);
    // express-lane warning posts at both ends of the row
    this.posts = inst(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 6).translate(0, 0.275, 0), new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.5 }), 40);
    this.lamps = inst(new THREE.SphereGeometry(0.07, 10, 8).translate(0, 0.6, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), 40, { shadow: false, color: true });
    add(this.posts, this.lamps);
    // road markings: dashes between road rows, a pale kerb where the road meets grass
    this.dashes = inst(new THREE.BoxGeometry(0.42, 0.006, 0.05), new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.7 }), 1400, { shadow: false });
    this.kerbs = inst(new THREE.BoxGeometry(72, 0.035, 0.07), new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.85 }), 60, { shadow: false });
    this.centre = inst(new THREE.BoxGeometry(72, 0.006, 0.035), new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.7 }), 60, { shadow: false }); // double yellow between opposite lanes
    add(this.dashes, this.kerbs, this.centre);
    // "PRIVATE PROPERTY" fences: posts and two rails per cell, signs on some of them
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.85 });
    this.fencePosts = inst(new THREE.BoxGeometry(0.06, 0.44, 0.06).translate(0, 0.22, 0), wood, 900);
    this.fenceRails = inst(merge([new THREE.BoxGeometry(C, 0.05, 0.03).translate(0, 0.16, 0), new THREE.BoxGeometry(C, 0.05, 0.03).translate(0, 0.33, 0)]), wood, 900);
    const sg = signGeometries();
    this.signWood = inst(sg.wood, wood, 120);
    this.signFaces = { private: inst(sg.face, new THREE.MeshStandardMaterial({ map: wordTexture('private'), roughness: 0.6 }), 80, { shadow: false }), state: inst(sg.face, new THREE.MeshStandardMaterial({ map: wordTexture('state'), roughness: 0.6 }), 80, { shadow: false }) };
    add(this.fencePosts, this.fenceRails, this.signWood, ...Object.values(this.signFaces));
    // ants marching across the lawn (some carry a crumb), the fisherman's floats drifting downstream, lost hooks
    this.ants = inst(antGeometry(), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.45 }), 700, { shadow: false });
    this.crumbs = inst(new THREE.BoxGeometry(0.022, 0.016, 0.02).translate(0.022, 0.04, 0), new THREE.MeshStandardMaterial({ color: 0xe8cc8a, roughness: 0.9 }), 300, { shadow: false });
    const bb = bobberGeometries();
    this.bobTop = inst(bb.top, new THREE.MeshStandardMaterial({ color: 0xd9322b, roughness: 0.45 }), 60, { shadow: false });
    this.bobBottom = inst(bb.bottom, new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45 }), 60, { shadow: false });
    this.bobStick = inst(bb.stick, new THREE.MeshStandardMaterial({ color: 0xd9322b, roughness: 0.5 }), 60, { shadow: false });
    this.lostHooks = inst(lostHookGeometry(), new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.9, roughness: 0.2 }), 200, { shadow: false });
    add(this.ants, this.crumbs, this.bobTop, this.bobBottom, this.bobStick, this.lostHooks);
    // blockers on grass
    const bg = bucketGeometries(), bm = bucketMaterials();
    this.bucketWall = inst(bg.wall, bm.steel, 200); this.bucketTrim = inst(bg.trim, bm.rim, 200);
    this.boulders = inst(boulderGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a877d, roughness: 0.92, flatShading: true }), 200, { color: true });
    add(this.bucketWall, this.bucketTrim, this.boulders);
    // decoration: leafy bushes (also blocking bushes), reeds, stones, trees, flowers, shells, gear
    this.leaves = inst(leafGeometry, leafMaterial, 5200);
    this.reeds = inst(new THREE.ConeGeometry(0.015, 1, 3, 1, true).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x6d7a3a, roughness: 0.9, side: THREE.DoubleSide }), 2600, { shadow: false });
    this.stones = inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x7c7a72, roughness: 0.9, flatShading: true }), 900);
    this.trunks = inst(new THREE.CylinderGeometry(0.6, 1, 1, 7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.95 }), 160);
    this.flowers = inst(flowerGeometry(), white({ roughness: 0.7 }), 1600, { shadow: false, color: true });
    this.shells = inst(shellGeometry(), white({ roughness: 0.6 }), 900, { shadow: false, color: true });
    this.tackle = inst(new THREE.BoxGeometry(0.34, 0.16, 0.2).translate(0, 0.08, 0), new THREE.MeshStandardMaterial({ color: 0x3f6b4a, roughness: 0.6 }), 200);
    this.tackleLid = inst(new THREE.BoxGeometry(0.35, 0.04, 0.21).translate(0, 0.18, 0), new THREE.MeshStandardMaterial({ color: 0x5f8f63, roughness: 0.5 }), 200);
    this.rods = inst(new THREE.CylinderGeometry(0.006, 0.014, 1.9, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.4 }), 200);
    this.tufts = inst(tuftGeometry(), white({ roughness: 0.9, side: THREE.DoubleSide }), 9000, { shadow: false, color: true });
    this.clover = inst(cloverGeometry(), white({ roughness: 0.85, side: THREE.DoubleSide }), 900, { shadow: false, color: true });
    const mg = mushroomGeometries();
    this.mushStem = inst(mg.stem, white({ color: 0xf0ead8, roughness: 0.8 }), 300);
    this.mushCap = inst(mg.cap, white({ roughness: 0.5 }), 300, { color: true });
    add(this.leaves, this.reeds, this.stones, this.trunks, this.flowers, this.shells, this.tackle, this.tackleLid, this.rods, this.tufts, this.clover, this.mushStem, this.mushCap);
    // the sides of the course are shaded, so the playable width reads at a glance
    const side = new THREE.MeshBasicMaterial({ color: 0x06100a, transparent: true, opacity: 0.26, depthWrite: false });
    this.sides = [-1, 1].map((s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 90).rotateX(-Math.PI / 2), side); m.userData.side = s; m.renderOrder = 1; this.group.add(m); return m; });
    this.wobble = new Map(); // "row:col" -> seconds left (a blocker the fish just bumped)
    this.reset(1);
  }

  reset(seed) {
    this.rand = rng(seed);
    this.rows = new Map(); this.next = 0; this.hazardNext = true; this.#setReach([this.#allCols()]); this.lastGate = 0;
    for (const s of this.strips) s.visible = false;
    this.lowest = 0; this.wobble.clear(); this.dirty = true;
  }

  #allCols() { const a = []; for (let c = -COLS; c <= COLS; c++) a.push(c); return a; }
  /** the stretches of free cells in a row */
  #freeRuns(blocked) { const runs = [[]]; for (const c of this.#allCols()) { if (blocked.has(c)) runs.push([]); else runs.at(-1).push(c); } return runs.filter((r) => r.length); }
  /** the reachable stretches of the newest row (reach = their cells) */
  #setReach(runs) { this.runs = runs; this.reach = new Set(runs.flat()); }
  difficulty(row) { return Math.min(1, Math.max(0, (row - 6) / ESCAPE.course.difficultyRows)); }
  row(r) { return this.rows.get(r); }
  /** a cell the fish can stand in (inside the course, existing, not blocked) */
  open(r, c) { const row = this.rows.get(r); return !!row && Math.abs(c) <= COLS && r >= this.lowest && !row.blocked.has(c); }
  blocked(r, c) { return !!this.rows.get(r)?.blocked.has(c); }
  /** sideways current of a row in cells per second (0 unless it is a stream) */
  flow(r) { const f = this.rows.get(r)?.flow; return f ? f.speed * f.dir : 0; }

  // ------------------------------------------------------------------ generation
  /** keep rows from `furthest - rowsBehind` to `furthest + rowsAhead` */
  update(furthest) {
    while (this.next <= furthest + ESCAPE.rowsAhead) this.#section();
    const keep = Math.max(0, furthest - ESCAPE.rowsBehind);
    for (const r of [...this.rows.keys()]) if (r < keep) { this.rows.delete(r); this.dirty = true; }
    this.lowest = keep;
  }

  #push(row) { row.index = this.next++; row.decor = this.#decor(row); this.rows.set(row.index, row); this.dirty = true; }

  /** true where a road could not run: the real pond is in the way of this row */
  #pondAcross(r) { for (let x = -14; x <= 14; x += 2) if (this.inPond(x, -r * C)) return true; return false; }

  #section() {
    const r = this.next, d = this.difficulty(r), R = this.rand, K = ESCAPE.course;
    if (r < K.openingSafeRows) { this.#push(this.#grass(r === K.openingSafeRows - 1 ? 1 : 0)); return; }
    if (r === K.openingSafeRows) { // the first crossing teaches the idea: one slow lane, one crab at a time
      this.#crossing(['sand'], { speed: ESCAPE.crab.speed[0][0], group: 1, king: 0, species: 'shore', gapBoost: 2 });
      // …and the first fence: straight ahead is closed, the gate is off to one side
      this.#push(this.#grass(1)); this.#push(this.#fence(0));
      this.hazardNext = true; return;
    }
    if (!this.hazardNext) {
      const n = R.int(Math.round(lerp(K.safe[0][0], K.safe[1][0], d)), Math.round(lerp(K.safe[0][1], K.safe[1][1], d)));
      for (let i = 0; i < n; i++) this.#push(this.#grass(R() < at(K.blockChance, d) ? R.int(K.blocksPerRow[0], Math.round(lerp(K.blocksPerRow[0], K.blocksPerRow[1], d))) : 0));
      if (R() < at(ESCAPE.fence.chance, d)) this.#push(this.#fence(d)); // the gate leads straight into the next hazard
      this.hazardNext = true; return;
    }
    this.hazardNext = false;
    let roads = r >= K.roadFrom; for (let k = 0; k <= 14 && roads; k += 2) roads = !this.#pondAcross(r + k);
    const options = [['sand', 1], ['stream', r >= K.streamFrom ? 0.55 : 0], ['road', roads ? 0.9 : 0], ['mixed', roads && r >= K.roadFrom + 12 ? 0.7 : 0]];
    let pick = R() * options.reduce((s, o) => s + o[1], 0), kind = 'sand';
    for (const [k, w] of options) { if ((pick -= w) < 0) { kind = k; break; } }
    const max = Math.round(lerp(K.crossing[0], K.crossing[1], d)), n = R.int(Math.max(1, max - 2), max);
    if (kind === 'stream') this.#stream(R.int(1, d > 0.2 ? (d > 0.6 ? 3 : 2) : 1));
    else if (kind === 'road') { const L = ESCAPE.car.lanes; this.#crossing(Array(R.int(Math.round(lerp(L[0][0], L[1][0], d)), Math.round(lerp(L[0][1], L[1][1], d)))).fill('road')); }
    else if (kind === 'mixed') this.#crossing(Array.from({ length: Math.min(n, 4) }, (_, i) => (i % 2 ? 'road' : 'sand')));
    else this.#crossing(Array(n).fill('sand'));
  }

  /** a grass row with `count` blockers (buckets, boulders, bushes), keeping reachable cells connected */
  #grass(count) {
    const R = this.rand, all = this.#allCols();
    for (let attempt = 0; attempt < 30; attempt++) {
      const blocked = new Set(), props = [];
      for (let i = 0; i < count; i++) {
        const c = R.int(-COLS, COLS); if (blocked.has(c)) continue;
        blocked.add(c);
        const k = R();
        props.push(k < 0.5 ? { c, kind: 'bucket', lying: R() < 0.7, yaw: R.range(-0.5, 0.5) + (R() < 0.5 ? 0 : Math.PI), open: R() < 0.5 ? 1 : -1, tilt: R.range(-0.08, 0.08) }
          : k < 0.75 ? { c, kind: 'boulder', s: R.range(0.22, 0.27), yaw: R.range(0, 6), tone: R.range(0.82, 1.1) }
          : { c, kind: 'bush', s: R.range(0.85, 1.05), seed: R.range(0, 9) });
      }
      // cells reachable in this row: free stretches that touch a reachable cell below; and every
      // reachable stretch below must lead on into this row (no dead ends)
      const runs = this.#freeRuns(blocked).filter((run) => run.some((c) => this.reach.has(c)));
      const deadEnd = this.runs.some((prev) => prev.every((c) => blocked.has(c)));
      if (!deadEnd && runs.flat().length >= Math.min(ESCAPE.course.minFreeCells, all.length - blocked.size)) { this.#setReach(runs); return { type: 'grass', blocked, props }; }
      count = Math.max(0, count - (attempt % 3 === 2 ? 1 : 0));
    }
    this.#setReach([all]);
    return { type: 'grass', blocked: new Set(), props: [] };
  }

  /** a "PRIVATE PROPERTY" fence across the row with a gate (1–2 cells) near the middle, away from the last one */
  #fence(d) {
    const R = this.rand, K = ESCAPE.fence, width = Math.round(at(K.gate, d)), all = this.#allCols();
    // the gate must be reachable from every stretch of the row below; if it can't be, an open row first
    const cells = (c) => Array.from({ length: width }, (_, i) => c + i);
    const fits = () => all.filter((c) => c >= -K.maxGateCol && c + width - 1 <= K.maxGateCol && this.runs.every((run) => cells(c).some((x) => run.includes(x))));
    let options = fits();
    if (!options.length) { this.#push(this.#grass(0)); options = fits(); }
    const far = options.filter((c) => Math.abs(c - this.lastGate) >= 2), g = R.pick(far.length ? far : options);
    const gate = new Set(Array.from({ length: width }, (_, i) => g + i)); this.lastGate = g;
    const blocked = new Set(all.filter((c) => !gate.has(c))), props = [...blocked].map((c) => ({ c, kind: 'fence' }));
    for (let i = R.int(1, 2); i > 0; i--) R.pick(props).sign = R() < 0.6 ? 'private' : 'state';
    this.#setReach([[...gate]]);
    return { type: 'grass', fence: true, blocked, props };
  }

  /** a moving lane: crabs ('sand') or vehicles ('road', 2–3 rows wide), possibly an express lane */
  #lane(d, kind, o = {}) {
    const R = this.rand, hop = F.hop, margin = ESCAPE.course.crossMargin;
    if (kind === 'road' && o.express) {
      const X = ESCAPE.car.express, speed = at(X.speed, d), half = ESCAPE.vehicles.pickup.length / 2;
      return { kind, vehicle: 'pickup', rows: ESCAPE.vehicles.pickup.rows, express: true, speed, dir: R() < 0.5 ? -1 : 1, len: X.length, movers: [{ x: R.range(-X.length / 2, X.length / 2), half, paint: 0 }], minGap: X.length - 2 * half, maxGroup: 2 * half };
    }
    const road = kind === 'road', K = road ? ESCAPE.car : ESCAPE.crab, len = road ? ESCAPE.car.laneLength : ESCAPE.laneLength;
    const species = kind === 'sand' ? o.species ?? R.pick(SPECIES) : null, spec = kind === 'sand' ? ESCAPE.crabs[species] : null;
    let vehicle = null;
    if (road) { let w = R() * KINDS.reduce((a, k) => a + ESCAPE.vehicles[k].weight, 0); vehicle = KINDS.find((k) => (w -= ESCAPE.vehicles[k].weight) < 0) || 'car'; }
    const rows = road ? ESCAPE.vehicles[vehicle].rows : 1, sp = road ? ESCAPE.vehicles[vehicle].speed : K.speed;
    let speed = o.speed ?? R.range(at([sp[0][0], sp[1][0]], d), at([sp[0][1], sp[1][1]], d));
    if (spec) speed *= spec.speed;
    // a gap must stay open long enough to hop in, across every row of the lane and out
    const minGap = Math.max(at(K.minGap, d) + (o.gapBoost || 0), speed * ((rows + 1) * hop + margin) + 2 * F.halfWidth + 0.3);
    const extra = at(K.extraGap, d);
    const groups = []; let pos = 0;
    for (;;) {
      const k = o.group ?? R.int(K.group[0], Math.round(lerp(K.group[0], K.group[1], d)));
      const members = []; let p = pos;
      for (let j = 0; j < k; j++) {
        let m;
        if (road) m = { half: ESCAPE.vehicles[vehicle].length / 2, paint: R.int(0, 4) };
        else { const king = R() < (o.king ?? at(ESCAPE.crab.kingChance, d)); m = { half: ESCAPE.crabs[king ? 'king' : species].half, species: king ? 'king' : species, tone: R.range(0.88, 1.1) }; }
        if (j) p += road ? ESCAPE.car.spacing : ESCAPE.crab.groupSpacing * m.half;
        p += m.half; m.x = p; members.push(m); p += m.half;
      }
      if (p + minGap > len && groups.length) break; // no room left for this group and a fair closing gap
      groups.push({ start: pos, end: p, members });
      pos = p + minGap + R() * extra;
      if (pos + 0.6 + minGap > len) break;
    }
    const gaps = groups.map((g, i) => (i < groups.length - 1 ? groups[i + 1].start - g.end : len - g.end + groups[0].start));
    const phase = R.range(0, len), movers = groups.flatMap((g) => g.members);
    for (const m of movers) m.x = wrap(m.x + phase, len);
    return { kind, species, vehicle, rows, speed, dir: R() < 0.5 ? -1 : 1, len, movers, minGap: Math.min(...gaps), maxGroup: Math.max(...groups.map((g) => g.end - g.start)),
      words: road && R() < 0.35 ? R.range(-5, 5) : null }; // "PRIVATE PROPERTY" painted across the lane at this x
  }

  /** consecutive moving lanes (kinds: 'sand' | 'road' for each) that can always be crossed in turn */
  #crossing(kinds, opts = {}) {
    const d = this.difficulty(this.next), hop = F.hop, margin = ESCAPE.course.crossMargin, R = this.rand;
    // you stand in lane i-1 while waiting for lane i: that lane's gap must outlast lane i's movers
    const fits = (prev, lane) => (prev.minGap - 2 * F.halfWidth) / prev.speed >= (lane.maxGroup + 2 * F.halfWidth) / lane.speed + 2 * hop + margin;
    const lanes = []; let express = false;
    for (let i = 0; i < kinds.length; i++) {
      const ex = kinds[i] === 'road' && !express && R() < at(ESCAPE.car.express.chance, d);
      let lane = this.#lane(d, kinds[i], { ...opts, express: ex });
      for (let tries = 0; i > 0 && !fits(lanes[i - 1], lane) && tries < 10; tries++) lane = this.#lane(d, kinds[i], { ...opts, express: ex, group: tries > 3 ? 1 : opts.group, king: tries > 6 ? 0 : opts.king });
      if (i > 0 && !fits(lanes[i - 1], lane)) break; // still no fit: end the crossing here
      if (lane.express) express = true;
      lanes.push(lane);
    }
    for (const lane of lanes) { lane.r0 = this.next; for (let i = 0; i < lane.rows; i++) this.#push({ type: lane.kind, blocked: new Set(), props: [], lane, part: i }); }
    this.#setReach([this.#allCols()]); // nothing static blocks a moving lane
  }

  /** one to three stream rows; neighbouring currents usually run opposite ways */
  #stream(n) {
    const d = this.difficulty(this.next), R = this.rand, [lo, hi] = [at([ESCAPE.stream.speed[0][0], ESCAPE.stream.speed[1][0]], d), at([ESCAPE.stream.speed[0][1], ESCAPE.stream.speed[1][1]], d)];
    let dir = R() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) { this.#push({ type: 'stream', blocked: new Set(), props: [], flow: { speed: R.range(lo, hi), dir } }); if (R() < 0.8) dir = -dir; }
    this.#setReach([this.#allCols()]);
  }

  // ------------------------------------------------------------------ decoration
  #decor(row) {
    const R = this.rand, items = [], z = -row.index * C;
    if (row.type === 'road') return items; // tarmac edge to edge
    for (const side of [-1, 1]) {
      // bushes hug the course edge; reeds and stones scatter further out; now and then a tree
      for (let i = 0; i < 2; i++) {
        const x = side * (COLS * C + R.range(0.75, 4.5));
        if (this.inPond(x, z)) continue;
        items.push({ kind: row.type === 'stream' || R() > 0.55 ? 'reeds' : 'bush', x, z: z + R.range(-0.25, 0.25), s: R.range(0.7, 1.25) });
      }
      if (row.type === 'stream') continue;
      if (R() < 0.45) { const x = side * (COLS * C + R.range(0.55, 6)); if (!this.inPond(x, z)) items.push({ kind: 'stone', x, z: z + R.range(-0.25, 0.25), s: R.range(0.05, 0.13) }); }
      if (R() < 0.12) { const x = side * (COLS * C + R.range(4, 9)); if (!this.inPond(x, z)) items.push({ kind: 'tree', x, z, s: R.range(0.8, 1.3) }); }
      if (R() < 0.06) { const x = side * (COLS * C + R.range(0.9, 2.2)); if (!this.inPond(x, z)) items.push({ kind: R() < 0.5 ? 'tackle' : 'rod', x, z, s: R.range(-0.6, 0.6) }); }
      // the argument, posted along the way
      if (!row.fence && R() < 0.07) { const x = side * (COLS * C + R.range(0.7, 1.6)); if (!this.inPond(x, z)) items.push({ kind: 'sign', x, z, style: R() < 0.6 ? 'private' : 'state', yaw: -side * R.range(0.15, 0.4) }); }
    }
    // flowers on the lawn, shells on the sand: small, flat, never on a blocked cell
    const scatter = (kind, n, s0, s1, avoid = true) => {
      for (let i = 0; i < n; i++) {
        const x = R.range(-COLS - 7, COLS + 7); if (avoid && row.blocked.has(Math.round(x))) continue;
        items.push({ kind, x: x * C, z: z + R.range(-0.27, 0.27), s: R.range(s0, s1), hue: R.int(0, 3), yaw: R.range(0, 6) });
      }
    };
    if (row.type === 'grass') {
      scatter('tuft', R.int(24, 34), 0.8, 1.5); scatter('flower', R.int(2, 6), 0.8, 1.3); scatter('clover', R.int(1, 3), 0.8, 1.4);
      if (R() < 0.22) scatter('mushroom', R.int(1, 3), 0.7, 1.2);
      if (R() < 0.06) scatter('hook', 1, 1, 1.3);
      // a line of ants marching across the lawn, some carrying crumbs home
      if (!row.fence && R() < 0.4) items.push({ kind: 'ants', z: z + R.range(-0.18, 0.18), x0: R.range(0, 20), speed: R.range(0.1, 0.16), dir: R() < 0.5 ? -1 : 1, n: R.int(7, 13), crumbs: R() < 0.6 });
    } else if (row.type === 'sand') {
      scatter('shell', R.int(2, 5), 0.8, 1.3); scatter('pebble', R.int(3, 7), 0.018, 0.04); scatter('weed', R.int(2, 5), 0.6, 1.1);
      if (R() < 0.3) scatter('hook', 1, 1, 1.3);
    } else if (row.type === 'stream') {
      scatter('weed', R.int(4, 8), 0.9, 1.4, false);
      // the fisherman's floats, lost and drifting downstream
      for (let i = R.int(0, 2); i > 0; i--) items.push({ kind: 'bobber', z: z + R.range(-0.15, 0.15), x0: R.range(-12, 12), phase: R.range(0, 6) });
    }
    return items;
  }

  // ------------------------------------------------------------------ queries
  moverX(m, lane, t) { return wrap(m.x + lane.dir * lane.speed * t, lane.len); }
  crabX(m, lane, t) { return this.moverX(m, lane, t); } // kept for tests

  /** seconds until an express truck reaches the course (0 while it is passing through) */
  expressIn(lane, t) {
    const m = lane.movers[0], s = lane.dir * this.moverX(m, lane, t), edge = COLS + 1;
    if (s - m.half < edge && s + m.half > -edge) return 0;
    // still coming, or already gone and coming round again (the lane loops)
    return s + m.half <= -edge ? (-edge - (s + m.half)) / lane.speed : (lane.len - s - m.half - edge) / lane.speed;
  }

  /** the mover hitting a fish at (x, z) in cells, or null. Hopping does not lift you over them. */
  hit(fx, fz, t) {
    let seen = null;
    for (let r = Math.floor(fz - 0.6); r <= Math.ceil(fz + 0.6); r++) {
      const L = this.rows.get(r)?.lane;
      if (!L || L === seen) continue;
      seen = L;
      // a lane covers rows r0 … r0 + rows - 1; its movers fill all of them
      const mid = (L.r0 ?? r) + (L.rows - 1) / 2;
      if (Math.abs(fz - mid) > (L.rows - 1) / 2 + 0.3 + F.halfDepth) continue;
      for (const m of L.movers) {
        const x = this.moverX(m, L, t);
        if (Math.abs(x - fx) < m.half + F.halfWidth) return { row: r, mover: m, x, dir: L.dir, kind: L.kind };
      }
    }
    return null;
  }

  bump(r, c) { this.wobble.set(`${r}:${c}`, 0.45); this.dirty = true; }

  // ------------------------------------------------------------------ rendering
  render(dt, t, fishRow = 0) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = V(), p = V(), color = new THREE.Color();
    // ground strips: one per live row, reused; a stream's flow rides on its strip's y scale
    let si = 0;
    for (const [r, row] of this.rows) {
      let strip = this.strips[si];
      if (!strip) { strip = new THREE.Mesh(this.stripGeo, this.mats.grass[0]); strip.receiveShadow = true; this.group.add(strip); this.strips.push(strip); }
      strip.material = this.mats[row.type][r & 1];
      strip.position.set(0, 0.004, -r * C); strip.scale.y = row.flow ? 10 + row.flow.speed * row.flow.dir : 1; strip.visible = true; si++;
    }
    for (; si < this.strips.length; si++) this.strips[si].visible = false;
    for (const sd of this.sides) sd.position.set(sd.userData.side * (COLS * C + C / 2 + 15), 0.03, -(fishRow + 12) * C);
    const near = (r) => r >= fishRow - 9 && r <= fishRow + 26;

    // crabs walk sideways; legs step, claws open and close; each species has its own colours
    let n = 0, nc = 0, nl = 0;
    for (const [r, row] of this.rows) {
      if (row.lane?.kind !== 'sand' || !near(r)) continue;
      for (const crab of row.lane.movers) {
        const x = this.moverX(crab, row.lane, t), sp = ESCAPE.crabs[crab.species], sc = sp.visual;
        if (Math.abs(x) > 19 || n >= this.crabBody.instanceMatrix.count) continue;
        const step = t * row.lane.speed * 9 + crab.x * 3, bob = Math.abs(Math.sin(step)) * 0.012 * sc;
        p.set(x * C, bob - this.depth(x * C, -r * C), -r * C);
        q.setFromEuler(e.set(0, Math.sin(step * 0.5) * 0.06, row.lane.dir * Math.sin(step) * 0.05));
        m.compose(p, q, s.setScalar(sc)); this.crabBody.setMatrixAt(n, m);
        this.crabBody.setColorAt(n, color.setRGB(...sp.shell).multiplyScalar(crab.tone));
        const body = m.clone();
        for (const sd of [-1, 1]) {
          const pinch = Math.sin(t * 3 + crab.x * 5 + sd) * 0.18;
          m.compose(V(0.12 * sd, 0.06, 0.08), new THREE.Quaternion().setFromEuler(e.set(-0.25 + pinch, 0.35 * sd, 0)), s.set(sd, 1, 1));
          this.crabClaw.setMatrixAt(nc, m.premultiply(body)); this.crabClaw.setColorAt(nc++, color.setRGB(...sp.claw).multiplyScalar(crab.tone));
          for (let k = 0; k < 3; k++) {
            const swing = Math.sin(step + k * 2.1 + (sd > 0 ? Math.PI : 0)) * 0.35;
            m.compose(V(0.12 * sd, 0.06, 0.04 - k * 0.055), new THREE.Quaternion().setFromEuler(e.set(0, (sd > 0 ? 0 : Math.PI) + (k - 1) * 0.45 * sd + swing * 0.4, swing * 0.3)), s.set(1, 1, 1));
            this.crabLeg.setMatrixAt(nl, m.premultiply(body)); this.crabLeg.setColorAt(nl++, color.setRGB(...sp.leg));
          }
        }
        n++;
      }
    }
    this.crabBody.count = n; this.crabClaw.count = nc; this.crabLeg.count = nl;
    for (const im of [this.crabBody, this.crabClaw, this.crabLeg]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }

    // vehicles: a lane's vehicles fill all of its rows; each kind has five paint colours, the box
    // trucks carry the words. Express lanes blink a warning.
    const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
    let np = 0, seen = null;
    for (const [r, row] of this.rows) {
      const L = row.lane; if (L?.kind !== 'road' || L === seen || !near(r)) continue;
      seen = L;
      const set = this.vehicles[L.vehicle], spec = ESCAPE.vehicles[L.vehicle], zc = -(L.r0 + (L.rows - 1) / 2) * C;
      for (const car of L.movers) {
        const x = this.moverX(car, L, t), n = counts[L.vehicle];
        if (Math.abs(x) > 24 || n >= MAX_VEHICLES) continue;
        q.setFromEuler(e.set(0, L.dir > 0 ? 0 : Math.PI, Math.sin(t * 14 + car.x) * 0.004));
        const bounce = Math.abs(Math.sin(t * 9 + car.x)) * 0.01;
        m.compose(p.set(x * C, bounce, zc), q, s.set(1, 1, 1));
        for (const part of Object.values(set.parts)) part.setMatrixAt(n, m);
        set.parts.paint.setColorAt(n, color.setRGB(...spec.colors[car.paint]));
        if (set.parts.cargo) set.parts.cargo.setColorAt(n, color.setRGB(0.95, 0.94, 0.9 - (car.paint % 2) * 0.05));
        if (set.decal) { m.compose(p.set(x * C + L.dir * set.decalOffset, bounce, zc), q.identity(), s.set(1, 1, 1)); set.decal.setMatrixAt(n, m); }
        counts[L.vehicle]++;
      }
      if (L.express && np < 38) {
        const wait = this.expressIn(L, t), on = wait < ESCAPE.car.express.warn && Math.sin(t * 20) > 0;
        for (const sd of [-1, 1]) {
          m.compose(p.set(sd * (COLS * C + 0.55), 0, -(L.r0 + L.rows - 1) * C - C * 0.38), q.identity(), s.set(1, 1, 1));
          this.posts.setMatrixAt(np, m); this.lamps.setMatrixAt(np, m);
          this.lamps.setColorAt(np, on ? color.setRGB(1, 0.12, 0.08) : color.setRGB(0.25, 0.08, 0.07)); np++;
        }
      }
    }
    for (const kind of KINDS) {
      const set = this.vehicles[kind];
      for (const part of [...Object.values(set.parts), set.decal].filter(Boolean)) { part.count = counts[kind]; part.instanceMatrix.needsUpdate = true; if (part.instanceColor) part.instanceColor.needsUpdate = true; }
    }
    this.posts.count = this.lamps.count = np; this.posts.instanceMatrix.needsUpdate = this.lamps.instanceMatrix.needsUpdate = true; this.lamps.instanceColor.needsUpdate = true;

    // ants march across the lawn; floats drift downstream with the current
    let na = 0, ncr = 0, nbob = 0;
    for (const [r, row] of this.rows) {
      if (!near(r)) continue;
      for (const it of row.decor) {
        if (it.kind === 'ants') {
          for (let i = 0; i < it.n && na < 700; i++) {
            const x = wrap(it.x0 + it.dir * (t * it.speed / C) - i * 0.55 * it.dir, 30) * C, wob = Math.sin(t * 6 + i * 1.7) * 0.012;
            q.setFromEuler(e.set(0, (it.dir > 0 ? 0 : Math.PI) + Math.sin(t * 4 + i) * 0.25, 0));
            m.compose(p.set(x, Math.abs(Math.sin(t * 22 + i)) * 0.002, it.z + wob), q, s.setScalar(1.15)); this.ants.setMatrixAt(na++, m);
            if (it.crumbs && i % 2 === 0 && ncr < 300) this.crumbs.setMatrixAt(ncr++, m);
          }
        } else if (it.kind === 'bobber' && nbob < 60) {
          const f = row.flow ? row.flow.speed * row.flow.dir : 0, x = wrap(it.x0 + f * t, 30) * C;
          q.setFromEuler(e.set(Math.sin(t * 2.3 + it.phase) * 0.18, 0, Math.cos(t * 1.9 + it.phase) * 0.18));
          m.compose(p.set(x, 0.005 + Math.sin(t * 3 + it.phase) * 0.012, it.z), q, s.set(1, 1, 1));
          this.bobTop.setMatrixAt(nbob, m); this.bobBottom.setMatrixAt(nbob, m); this.bobStick.setMatrixAt(nbob++, m);
        }
      }
    }
    this.ants.count = na; this.crumbs.count = ncr; this.bobTop.count = this.bobBottom.count = this.bobStick.count = nbob;
    for (const im of [this.ants, this.crumbs, this.bobTop, this.bobBottom, this.bobStick]) im.instanceMatrix.needsUpdate = true;

    // blockers wobble briefly when bumped
    let wobbling = false;
    for (const [k, left] of this.wobble) { const v = left - dt; if (v <= 0) this.wobble.delete(k); else { this.wobble.set(k, v); wobbling = true; } }
    if (!this.dirty && !wobbling) return;
    this.dirty = wobbling;
    let nb = 0, nbo = 0, nleaf = 0;
    const leaf = (x, y, z, sc, seed) => {
      if (nleaf >= this.leaves.instanceMatrix.count) return;
      q.setFromEuler(e.set(seed * 1.7, seed * 2.3, seed * 0.9)); m.compose(p.set(x, y, z), q, s.setScalar(sc)); this.leaves.setMatrixAt(nleaf++, m);
    };
    for (const [r, row] of this.rows) for (const b of row.props) {
      const w = this.wobble.get(`${r}:${b.c}`) || 0, shake = Math.sin(w * 40) * w * 0.25;
      if (b.kind === 'bucket') {
        p.set(b.c * C, b.lying ? 0.265 : 0, -r * C);
        q.setFromEuler(e.set(b.tilt + shake, b.yaw, b.lying ? b.open * Math.PI / 2 : shake));
        if (b.lying) p.add(V(b.open * 0.19, 0, 0).applyAxisAngle(V(0, 1, 0), b.yaw)); // centre the pail on its cell
        m.compose(p, q, s.setScalar(b.lying ? 0.8 : 0.86));
        this.bucketWall.setMatrixAt(nb, m); this.bucketTrim.setMatrixAt(nb++, m);
      } else if (b.kind === 'boulder') {
        q.setFromEuler(e.set(shake * 0.3, b.yaw, 0)); m.compose(p.set(b.c * C, b.s * 0.55, -r * C), q, s.set(b.s * 1.1, b.s, b.s)); this.boulders.setMatrixAt(nbo, m);
        this.boulders.setColorAt(nbo++, color.setRGB(b.tone, b.tone, b.tone * 0.96));
      } else if (b.kind === 'fence') continue; // drawn with the whole fence below
      else for (let i = 0; i < 9; i++) { // a round bush that fills its cell
        const a = i * 2.4 + b.seed, rr = i < 3 ? 0.05 : 0.16;
        leaf(b.c * C + Math.cos(a) * rr + shake * 0.2, (0.16 + (i % 3) * 0.13) * b.s, -r * C + Math.sin(a) * rr, 0.36 * b.s, b.seed + i);
      }
    }
    this.bucketWall.count = this.bucketTrim.count = nb; this.boulders.count = nbo;
    for (const im of [this.bucketWall, this.bucketTrim, this.boulders]) im.instanceMatrix.needsUpdate = true;
    if (this.boulders.instanceColor) this.boulders.instanceColor.needsUpdate = true;
    // fences: posts and rails right across (beyond the course too), open at the gate; signs on some posts
    let nfp = 0, nfr = 0, nsw = 0; const nsf = { private: 0, state: 0 };
    const sign = (x, z, yaw, style, shake = 0) => {
      if (nsw >= 120 || nsf[style] >= 80) return;
      q.setFromEuler(e.set(shake, yaw, 0)); m.compose(p.set(x, 0, z), q, s.set(1, 1, 1));
      this.signWood.setMatrixAt(nsw++, m); this.signFaces[style].setMatrixAt(nsf[style]++, m);
    };
    for (const [r, row] of this.rows) {
      if (!row.fence) continue;
      const z = -r * C;
      for (let c = -COLS - 9; c <= COLS + 9; c++) {
        if (Math.abs(c) <= COLS && !row.blocked.has(c)) continue; // the gate
        const w = this.wobble.get(r + ':' + c) || 0, shake = Math.sin(w * 40) * w * 0.25;
        q.setFromEuler(e.set(shake, 0, 0));
        if (nfr < 900) { m.compose(p.set(c * C, 0, z), q, s.set(1, 1, 1)); this.fenceRails.setMatrixAt(nfr++, m); }
        for (const sd of [-0.5, 0.5]) if (nfp < 900) { m.compose(p.set((c + sd) * C, 0, z), q, s.set(1, 1, 1)); this.fencePosts.setMatrixAt(nfp++, m); }
        const prop = row.props.find((o) => o.c === c);
        if (prop?.sign) sign(c * C, z + 0.03, 0, prop.sign, shake);
      }
    }
    for (const [, row] of this.rows) for (const it of row.decor) if (it.kind === 'sign') sign(it.x, it.z, it.yaw, it.style);
    this.fencePosts.count = nfp; this.fenceRails.count = nfr; this.signWood.count = nsw;
    for (const k of Object.keys(nsf)) { this.signFaces[k].count = nsf[k]; this.signFaces[k].instanceMatrix.needsUpdate = true; }
    for (const im of [this.fencePosts, this.fenceRails, this.signWood]) im.instanceMatrix.needsUpdate = true;
    // road markings: nothing inside a lane; between lanes white dashes (same direction) or a double
    // yellow line (opposite directions); kerbs where a road starts and ends; now and then words
    let nd = 0, nk = 0, ncen = 0, nw = 0;
    for (const [r, row] of this.rows) {
      if (row.type !== 'road') continue;
      for (const [dr, other] of [[1, this.rows.get(r + 1)], [-1, this.rows.get(r - 1)]]) {
        const zEdge = -(r + dr * 0.5) * C;
        if (other?.type === 'road') {
          if (dr < 0 || other.lane === row.lane) continue;
          if (other.lane.dir !== row.lane.dir) { for (const o of [-0.035, 0.035]) if (ncen < 60) { m.compose(p.set(0, 0.008, zEdge + o), q.identity(), s.set(1, 1, 1)); this.centre.setMatrixAt(ncen++, m); } }
          else for (let x = -14; x <= 14 && nd < 1400; x += 1.1) { m.compose(p.set(x, 0.008, zEdge), q.identity(), s.set(1, 1, 1)); this.dashes.setMatrixAt(nd++, m); }
        } else if (nk < 60) { m.compose(p.set(0, 0.012, zEdge), q.identity(), s.set(1, 1, 1)); this.kerbs.setMatrixAt(nk++, m); }
      }
      if (row.part === 0 && row.lane.words != null && nw < 40) {
        m.compose(p.set(row.lane.words * C, 0.007, -(r + (row.lane.rows - 1) / 2) * C), q.identity(), s.set(1, 1, 1)); this.roadWords.setMatrixAt(nw++, m);
      }
    }
    this.dashes.count = nd; this.kerbs.count = nk; this.centre.count = ncen; this.roadWords.count = nw;
    for (const im of [this.dashes, this.kerbs, this.centre, this.roadWords]) im.instanceMatrix.needsUpdate = true;
    // decoration
    let nreed = 0, nstone = 0, ntrunk = 0, ngear = 0, nrod = 0, nfl = 0, nsh = 0, ntu = 0, ncl = 0, nmu = 0, nho = 0;
    const TUFT = [[0.22, 0.42, 0.08], [0.28, 0.5, 0.1], [0.36, 0.48, 0.12], [0.18, 0.36, 0.07]], WEED = [[0.34, 0.36, 0.14], [0.24, 0.32, 0.12], [0.42, 0.4, 0.18], [0.3, 0.42, 0.16]], CAPS = [[0.78, 0.16, 0.12], [0.62, 0.42, 0.24], [0.86, 0.72, 0.5], [0.7, 0.2, 0.14]];
    const FLOWERS = [[0.95, 0.94, 0.88], [0.98, 0.84, 0.25], [0.93, 0.55, 0.7], [0.65, 0.6, 0.95]];
    for (const [, row] of this.rows) for (const it of row.decor) {
      const h = Math.abs(Math.sin(it.x * 12.9 + it.z * 78.2));
      if (it.kind === 'bush') for (let i = 0; i < 7; i++) { const a = i * 2.4 + h * 6; leaf(it.x + Math.cos(a) * 0.32 * it.s, (0.22 + (i % 3) * 0.14) * it.s, it.z + Math.sin(a) * 0.28 * it.s, 0.42 * it.s, h + i); }
      if (it.kind === 'reeds') for (let i = 0; i < 9 && nreed < this.reeds.instanceMatrix.count; i++) {
        const a = i * 2.39 + h * 5, rr = 0.06 + (i % 4) * 0.07;
        q.setFromEuler(e.set(Math.sin(a) * 0.15, a, Math.cos(a) * 0.15)); m.compose(p.set(it.x + Math.cos(a) * rr, 0, it.z + Math.sin(a) * rr), q, s.set(1, (0.5 + ((i * 7) % 5) * 0.14) * it.s, 1)); this.reeds.setMatrixAt(nreed++, m);
      }
      if (it.kind === 'flower' && nfl < 1600) { q.setFromEuler(e.set(0, it.yaw, 0)); m.compose(p.set(it.x, 0, it.z), q, s.setScalar(it.s)); this.flowers.setMatrixAt(nfl, m); this.flowers.setColorAt(nfl++, color.setRGB(...FLOWERS[it.hue])); }
      if (it.kind === 'shell' && nsh < 900) { q.setFromEuler(e.set(0, it.yaw, 0)); m.compose(p.set(it.x, 0.004, it.z), q, s.setScalar(it.s)); this.shells.setMatrixAt(nsh, m); this.shells.setColorAt(nsh++, color.setRGB(0.95, 0.88 - it.hue * 0.06, 0.82 - it.hue * 0.08)); }
      if ((it.kind === 'tuft' || it.kind === 'weed') && ntu < 9000) {
        q.setFromEuler(e.set(Math.sin(it.x * 3) * 0.08, it.yaw, Math.cos(it.z * 2) * 0.08)); // static: rebuilt only when rows change
        m.compose(p.set(it.x, it.kind === 'weed' && row.type === 'stream' ? -0.01 : 0, it.z), q, s.set(it.s, it.s * (it.kind === 'weed' ? 1.3 : 1), it.s));
        this.tufts.setMatrixAt(ntu, m); this.tufts.setColorAt(ntu++, color.setRGB(...(it.kind === 'weed' ? WEED : TUFT)[it.hue]));
      }
      if (it.kind === 'clover' && ncl < 900) { q.setFromEuler(e.set(0, it.yaw, 0)); m.compose(p.set(it.x, 0, it.z), q, s.setScalar(it.s)); this.clover.setMatrixAt(ncl, m); this.clover.setColorAt(ncl++, color.setRGB(0.2 + it.hue * 0.03, 0.42, 0.12)); }
      if (it.kind === 'mushroom' && nmu < 300) { q.setFromEuler(e.set(0, it.yaw, 0.1)); m.compose(p.set(it.x, 0, it.z), q, s.setScalar(it.s)); this.mushStem.setMatrixAt(nmu, m); this.mushCap.setMatrixAt(nmu, m); this.mushCap.setColorAt(nmu++, color.setRGB(...CAPS[it.hue])); }
      if (it.kind === 'pebble' && nstone < this.stones.instanceMatrix.count) { q.setFromEuler(e.set(it.yaw, it.yaw * 2, 0)); m.compose(p.set(it.x, it.s * 0.3, it.z), q, s.set(it.s * 1.3, it.s * 0.6, it.s)); this.stones.setMatrixAt(nstone++, m); }
      if (it.kind === 'tackle' && ngear < 200) { q.setFromEuler(e.set(0, it.s, 0)); m.compose(p.set(it.x, 0, it.z), q, s.set(1, 1, 1)); this.tackle.setMatrixAt(ngear, m); this.tackleLid.setMatrixAt(ngear++, m); }
      if (it.kind === 'hook' && nho < 200) { q.setFromEuler(e.set(0, it.yaw, 0)); m.compose(p.set(it.x, 0.002, it.z), q, s.setScalar(it.s)); this.lostHooks.setMatrixAt(nho++, m); }
      if (it.kind === 'rod' && nrod < 200) { q.setFromEuler(e.set(0, it.s + 0.4, 0.04)); m.compose(p.set(it.x, 0.03, it.z), q, s.set(1, 1, 1)); this.rods.setMatrixAt(nrod++, m); }
      if (it.kind === 'stone' && nstone < this.stones.instanceMatrix.count) { q.setFromEuler(e.set(h, h * 3, 0)); m.compose(p.set(it.x, it.s * 0.4, it.z), q, s.set(it.s * 1.3, it.s * 0.7, it.s)); this.stones.setMatrixAt(nstone++, m); }
      if (it.kind === 'tree' && ntrunk < this.trunks.instanceMatrix.count) {
        m.compose(p.set(it.x, 0, it.z), q.identity(), s.set(0.16 * it.s, 3.2 * it.s, 0.16 * it.s)); this.trunks.setMatrixAt(ntrunk++, m);
        for (let i = 0; i < 26; i++) { const a = i * 2.4, rr = (0.5 + (i % 5) * 0.25) * it.s; leaf(it.x + Math.cos(a) * rr, (3.0 + Math.sin(i * 1.3) * 0.8) * it.s, it.z + Math.sin(a) * rr, 1.0 * it.s, h + i); }
      }
    }
    this.leaves.count = nleaf; this.reeds.count = nreed; this.stones.count = nstone; this.trunks.count = ntrunk; this.tackle.count = this.tackleLid.count = ngear; this.rods.count = nrod; this.flowers.count = nfl; this.shells.count = nsh; this.tufts.count = ntu; this.clover.count = ncl; this.mushStem.count = this.mushCap.count = nmu; this.lostHooks.count = nho;
    for (const im of [this.lostHooks, this.leaves, this.reeds, this.stones, this.trunks, this.tackle, this.tackleLid, this.rods, this.flowers, this.shells, this.tufts, this.clover, this.mushStem, this.mushCap]) im.instanceMatrix.needsUpdate = true;
    for (const im of [this.flowers, this.shells, this.tufts, this.clover, this.mushCap]) im.instanceColor.needsUpdate = true;
  }
}
