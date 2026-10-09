// Fishing loop: aim -> cast -> hook attaches -> line tightens -> reel (with reel drag) -> release.
import * as THREE from 'three';

const IDLE_LEN = 0.32;
const REEL_SPEED = 0.5; // m/s of line wound in
const MIN_LEN = 0.45;

// hook + bobber visual at the end of the line (scale > 1 for viewing from a distance)
export function makeLure(scale = 1) {
  const g = new THREE.Group();
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.017, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
  const bobTop = new THREE.Mesh(new THREE.SphereGeometry(0.0172, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8261c, roughness: 0.35 }));
  bob.position.y = 0.02; bobTop.position.y = 0.02;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0015, 6, 12, Math.PI * 1.4), new THREE.MeshStandardMaterial({ color: 0x8b9298, metalness: 0.9, roughness: 0.3 }));
  hook.position.y = -0.012; hook.rotation.z = Math.PI * 0.8;
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.03, 6), hook.material);
  shank.position.y = 0.006;
  g.add(bob, bobTop, hook, shank);
  g.scale.setScalar(scale);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export class Fishing {
  constructor(game) {
    this.game = game;
    this.rod = game.rod;
    this.line = game.line;
    this.audio = game.audio;
    this.state = 'idle';
    this.target = null;
    this.L = IDLE_LEN;
    this.tension = 0;
    this.reeling = false;
    this.slipping = false;
    this.hookPos = new THREE.Vector3();
    this.flight = null;
    this.lineDir = new THREE.Vector3();
    this.reelClickAcc = 0;
    this.slipClickAcc = 0;
    this.onState = null;
    this.lure = makeLure();
    game.scene.add(this.lure);
  }

  reset() {
    if (this.target) this.target.detach('reset');
    this.target = null;
    this.state = 'idle';
    this.L = IDLE_LEN;
    this.tension = 0;
    this.flight = null;
    this.reeling = false;
    this.line.endMass = 1;
    this.line.inited = false;
    this.#emit();
  }

  get hooked() { return this.state === 'hooked'; }

  #emit() { this.onState?.(this.state, this.target); }

  canCast() { return this.state === 'idle' || this.state === 'hooked' || this.state === 'retrieving'; }

  cast(target) {
    if (!this.canCast() || !target) return false;
    if (this.target === target && this.state === 'hooked') return false;
    if (this.state === 'hooked') this.release('recast', true);
    this.state = 'casting';
    this.target = target;
    this.rod.flick();
    this.audio.whoosh(0.4, 0.3);
    const start = this.line.end.clone();
    this.flight = { t: -0.22, dur: 0.0, from: start, ctrl: new THREE.Vector3() };
    this.#emit();
    return true;
  }

  // used by the truck showcase: hook already attached
  attachNow(target) {
    this.target = target;
    target.attach();
    this.state = 'hooked';
    const end = target.attachPoint(new THREE.Vector3());
    this.L = this.rod.tipWorld.distanceTo(end) + 0.05;
    this.line.length = this.L;
    this.line.resetBetween(this.rod.tipWorld, end);
    this.tension = 0;
    this.#emit();
  }

  release(reason = 'player', quiet = false) {
    if (!this.target && this.state !== 'casting') return;
    const t = this.target;
    this.target = null;
    if (t && this.state === 'hooked') t.detach(reason);
    this.state = 'retrieving';
    this.flight = null;
    this.tension = 0;
    if (!quiet) this.audio.click(0.2, 1500, 0.04);
    this.#emit();
  }

  update(dt) {
    const tip = this.rod.tipWorld;
    let endTarget = null;
    this.slipping = false;
    if (this.state === 'casting') {
      const f = this.flight;
      f.t += dt;
      const dest = this.target.anchor(new THREE.Vector3());
      if (f.t < 0) {
        // rod loading: hook stays near the tip
        endTarget = null;
      } else {
        if (!f.dur) {
          f.from.copy(this.line.end);
          const d = f.from.distanceTo(dest);
          f.dur = 0.28 + d * 0.07;
          this.audio.zip(f.dur);
        }
        const u = Math.min(1, f.t / f.dur);
        const e = 1 - Math.pow(1 - u, 2);
        const p = f.from.clone().lerp(dest, e);
        p.y += Math.sin(u * Math.PI) * (0.25 + f.from.distanceTo(dest) * 0.12);
        endTarget = p;
        this.L = tip.distanceTo(p) * 1.06 + 0.05;
        if (u >= 1) {
          this.state = 'hooked';
          this.target.attach();
          this.L = tip.distanceTo(dest) + 0.12; // a little slack so the line sags
          this.#emit();
        }
      }
    } else if (this.state === 'hooked') {
      const t = this.target;
      if (!t.pinned()) endTarget = null;
      else endTarget = t.attachPoint(new THREE.Vector3());
      if (this.reeling) this.L = Math.max(MIN_LEN, this.L - (t.reelSpeed ?? REEL_SPEED) * dt);
      // current line path length (wraps around obstacles)
      const dist = endTarget ? Math.max(tip.distanceTo(endTarget), this.line.pathLength() * 0.98) : this.line.pathLength();
      const stretch = t.stretch ?? 0.3;
      let excess = dist - this.L;
      if (!endTarget) {
        // free end (carrying the cap): weight gives a constant small tension
        excess = Math.max(0, excess) + 0.04;
      }
      if (excess > stretch) { this.L = dist - stretch; excess = stretch; this.slipping = this.reeling; }
      const target = THREE.MathUtils.clamp(excess / stretch, 0, 1);
      this.tension += (target - this.tension) * (1 - Math.exp(-12 * dt));
      const dir = this.line.endDir(this.lineDir);
      t.applyPull(this.tension, dir, dt);
      if (this.state === 'hooked' && t === this.target && endTarget) endTarget = t.attachPoint(endTarget);
    } else if (this.state === 'retrieving') {
      this.L = Math.max(IDLE_LEN, this.L - 2.6 * dt);
      this.tension *= Math.exp(-10 * dt);
      if (this.L <= IDLE_LEN + 1e-3) { this.state = 'idle'; this.#emit(); }
      if (this.reelClickAcc > 0.03) this.reelClickAcc = 0;
    } else {
      this.L = IDLE_LEN;
      this.tension = 0;
    }
    this.line.length = this.L;
    this.line.simulate(dt, tip, endTarget);
    this.lure.position.copy(this.line.end);
    const ld = this.line.endDir(new THREE.Vector3());
    this.lure.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ld);
    this.lure.visible = !(this.target && this.target.id === 'cap' && this.target.state === 'hanging');

    // reel ratchet / drag sounds
    const reelingNow = this.reeling && (this.state === 'hooked' || this.state === 'retrieving');
    if (reelingNow && !this.slipping) {
      this.reelClickAcc += dt * 22;
      while (this.reelClickAcc > 1) { this.reelClickAcc -= 1; this.audio.click(0.05, 5200, 0.006); }
    }
    if (this.slipping) {
      this.slipClickAcc += dt * 38;
      while (this.slipClickAcc > 1) { this.slipClickAcc -= 1; this.audio.click(0.07, 3300, 0.008); }
    }
  }
}
