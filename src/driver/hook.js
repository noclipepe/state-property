// The twist: the fisherman casts at the pickup, the hook catches the rear door frame (driver's
// side, just behind the B-pillar) and he hauls the whole truck sideways toward himself and the
// pond, walking backwards and reeling. The line force goes through the shared TruckSim
// (static friction -> breakaway -> sliding tyres, suspension roll, side lift), so the entire
// vehicle moves, with the player still inside.
import * as THREE from 'three';
import { FishingLine } from '../gameplay/rod.js';
import { makeLure } from '../gameplay/fishing.js';
import { truckLineCollider } from '../scene/truck.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// timeline of the sequence (s from the start of the cast)
const T = { windup: 0, cast: 0.55, release: 0.72, flight: 0.55, slackReel: 0.45, tug: 2.0, tugEnd: 2.3, strain: 2.75, strainFull: 3.7, maxDrag: 6.5 };
const F = { tug: 3200, strain0: 4200, strain1: 10500, drag: 15000 };

export class Hook {
  constructor({ scene, truck, fisherman, audio, resolution, pond }) {
    this.scene = scene; this.truck = truck; this.fisher = fisherman; this.audio = audio; this.pond = pond;
    this.line = new FishingLine(scene, resolution);
    this.line.mat.linewidth = 2.2;
    this.line.mat.opacity = 0.95;
    const body = truckLineCollider(truck);
    let frame = -1;
    this.frameNo = 0;
    this.line.colliders.push((p) => {
      if (frame !== this.frameNo) { frame = this.frameNo; body.begin(); }
      if (p.y < 0.02) p.y = 0.02;
      body.apply(p);
    });
    this.lure = makeLure(1.7);
    scene.add(this.lure);
    // catch point: the front edge of the rear door's window frame, on the outside of the cab
    const D = truck.dims, TH = truck.tumble;
    const y = 1.60;
    this.local = V(D.doorRear.x0 + 0.11, y, TH.a[0] - (y - TH.a[1]) * TH.n[1] / TH.n[0] + 0.012);
    this.reset();
  }

  reset() {
    this.phase = 'idle'; // idle | windup | cast | flight | slack | tug | strain | drag | settle | done
    this.t = 0;
    this.force = 0;
    this.tension = 0;
    this.L = 0.32;
    this.flight = null;
    this.events = {};
    this.dragT = 0;
    this.settleT = 0;
    this.keep = null; // distance he keeps from the catch point while backing off
    this.truck.sim.clearForce();
    this.line.inited = false;
    this.line.length = this.L;
    this.lure.visible = true;
  }

  get hooked() { return ['slack', 'tug', 'strain', 'drag', 'settle', 'done'].includes(this.phase); }
  hookWorld(out = new THREE.Vector3()) { return this.truck.worldPoint(out.copy(this.local), out); }

  /** start the cast; onEvent(name) gets 'cast', 'hooked', 'strain', 'moving', 'stopped' */
  start(onEvent) {
    this.onEvent = onEvent;
    this.phase = 'windup';
    this.t = 0;
    const f = this.fisher;
    f.faceToward(() => this.hookWorld());
    f.lookAt(() => this.hookWorld(), 2.2);
    f.setLeft('rod');
    f.setHold('back', 6);
    f.setFace({ smile: 0.2, browUp: 0.1, squint: 0.35, browAngry: 0 });
  }

  #emit(name) { if (!this.events[name]) { this.events[name] = true; this.onEvent?.(name); } }

  /** before the truck sim steps: drive the sequence and set the line force */
  update(dt) {
    if (this.phase === 'idle') { this.truck.sim.clearForce(); return; }
    this.t += dt;
    const f = this.fisher, sim = this.truck.sim, t = this.t;
    if (this.phase === 'windup' && t >= T.cast) {
      this.phase = 'cast';
      f.setHold('forward', 16);
      f.whip = 0.22;
      this.audio.whoosh(0.45, 0.32);
    }
    if (this.phase === 'cast' && t >= T.release) {
      this.phase = 'flight';
      this.flight = { t: 0, from: this.line.end.clone(), zip: 0 };
      this.#emit('cast');
    }
    if (this.phase === 'flight') {
      this.flight.t += dt;
      // line paying out from the spool (ticks driven by the frame clock, so a restart stops them)
      this.flight.zip += dt * 45;
      while (this.flight.zip > 1) { this.flight.zip -= 1; this.audio.click(0.05 * (1 - this.flight.t / T.flight) + 0.02, 6000, 0.006); }
      if (this.flight.t >= T.flight) {
        this.phase = 'slack';
        this.slackT = 0;
        this.audio.click(0.3, 1900, 0.03);
        this.audio.thud(0.16, 300);
        this.L = this.line.pathLength() + 0.25;
        f.setHold('fight', 3);
        f.setLeft('reel');
        f.lookAt(() => this.hookWorld(), 0.9);
        f.setFace({ smile: 0.5, squint: 0.4, browUp: 0.3 });
        this.#emit('hooked');
      }
    }
    // pull force profile
    let force = 0;
    if (this.hooked) {
      const dist = this.#dist();
      if (this.phase === 'slack') {
        f.reeling = true;
        this.L = Math.max(dist * 0.985, this.L - 1.1 * dt);
        if (this.L <= dist * 0.99 && t > T.release + T.flight + T.slackReel) { this.phase = 'tug'; f.reeling = false; }
      }
      if (this.phase === 'tug') {
        // one sharp test pull: the truck rocks on its springs, nothing more
        force = t < T.tug ? 0 : t < T.tugEnd ? F.tug : 0;
        if (t >= T.tug && !this.events.tug) { this.events.tug = true; this.audio.creak(0.14, 620); f.whip = -0.1; }
        if (t >= T.strain) { this.phase = 'strain'; f.reeling = true; f.setLean({ back: 0.7 }); this.#emit('strain'); }
      }
      if (this.phase === 'strain') {
        force = F.strain0 + (F.strain1 - F.strain0) * smooth(T.strain, T.strainFull, t);
        if (!sim.stuck) { this.phase = 'drag'; this.audio.groan(0.4); this.audio.creak(0.18, 520); this.#emit('moving'); }
      }
      if (this.phase === 'drag') {
        this.dragT += dt;
        force = F.drag;
        // he backs off toward the pond at the truck's own pace (so he stays where you see him),
        // keeping his distance to the catch point; stops near the bank
        const toward = this.#pullDir();
        this.keep ??= this.#horiz();
        f.walkVel.set(sim.vel.x, 0, sim.vel.y).addScaledVector(toward, (this.keep - this.#horiz()) * 1.6);
        if (f.walkVel.length() > 1.6) f.walkVel.setLength(1.6);
        if (this.#nearBank() || this.dragT > T.maxDrag) { this.phase = 'settle'; this.settleT = 0; }
      }
      if (this.phase === 'settle') {
        this.settleT += dt;
        force = F.drag * (1 - smooth(0, 0.7, this.settleT));
        f.walkVel.set(sim.vel.x, 0, sim.vel.y); // eases off with the truck, so he stays put in your view
        if (this.settleT > 0.5) f.reeling = false;
        if (this.settleT > 0.8 && sim.speed < 0.05) { this.phase = 'done'; f.walkVel.set(0, 0, 0); this.#emit('stopped'); f.setLean({ back: 0 }); f.setHold('ready', 2); f.setFace({ smile: 0.6, squint: 0.3, browUp: 0.2 }); }
      }
      if (this.phase === 'done') force = 0;
      // the line slips a little on the reel drag but stays tight while loaded
      if (this.phase !== 'slack') this.L = Math.max(0.5, dist * (force > 1 ? 0.975 : 0.995));
    }
    this.force = force;
    this.tension += (Math.min(1, force / F.strain1) - this.tension) * (1 - Math.exp(-8 * dt));
    f.tension = this.tension;
    if (force > 1) {
      // the line acts at the catch point; for the turning moment it is taken midway between the
      // axles (where the tyre friction balances; the sim has no restoring yaw torque), so the pickup
      // slides sideways and you keep facing him. Applied 1 m up, it still rolls the body toward him.
      const dir = this.#pullDir();
      const D = this.truck.dims;
      const mid = V((D.axleF + D.axleR) / 2, 0, 0).applyAxisAngle(V(0, 1, 0), sim.yaw);
      const at = V(sim.pos.x + mid.x, 1.0, sim.pos.y + mid.z);
      sim.setLineForce(V(dir.x * force, force * 0.12, dir.z * force), at);
    } else sim.clearForce();
  }

  // horizontal direction from the catch point to the fisherman's hands
  #pullDir() {
    const h = this.hookWorld(), p = this.fisher.handsWorld();
    const d = V(p.x - h.x, 0, p.z - h.z);
    return d.lengthSq() > 1e-6 ? d.normalize() : V(1, 0, 0);
  }
  #horiz() { const h = this.hookWorld(), p = this.fisher.pos; return Math.hypot(p.x - h.x, p.z - h.z); }
  #dist() { return this.fisher.tipWorld.distanceTo(this.hookWorld()); }
  #nearBank() {
    const p = this.fisher.pos, P = this.pond;
    return Math.hypot((p.x - P.x) / P.rx, (p.z - P.z) / P.rz) < P.stop;
  }

  /** after the truck and the fisherman moved: simulate the line and place the lure */
  updateLine(dt) {
    this.frameNo++;
    const tip = this.fisher.tipWorld;
    let end = null;
    if (this.phase === 'flight') {
      const u = Math.min(1, this.flight.t / T.flight);
      const dest = this.hookWorld();
      const e = 1 - Math.pow(1 - u, 2);
      end = this.flight.from.clone().lerp(dest, e);
      end.y += Math.sin(u * Math.PI) * (0.35 + this.flight.from.distanceTo(dest) * 0.12);
      this.L = tip.distanceTo(end) * 1.06 + 0.05;
    } else if (this.hooked) {
      end = this.hookWorld();
    } else {
      this.L = this.phase === 'cast' ? 0.5 : 0.32;
    }
    this.line.length = this.L;
    this.line.simulate(dt, tip, end);
    this.lure.position.copy(this.line.end);
    const ld = this.line.endDir(new THREE.Vector3());
    this.lure.quaternion.setFromUnitVectors(V(0, 1, 0), ld);
    this.fisher.lineDir = this.line.tipDir(new THREE.Vector3());
  }
}
