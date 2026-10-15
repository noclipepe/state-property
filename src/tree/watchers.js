// Two independent suspicion meters, one per character, in the spirit of stealth-game detection.
// A meter rises only while the binoculars are raised and aimed at that man (faster near the centre
// of the lenses). Looking elsewhere stops it and, after a moment, lets it fall slowly; lowering the
// binoculars behind the leaves lets it fall faster. Switching targets never resets the other meter.
//   level 0  calm        he keeps arguing
//   level 1  distracted  he pauses, glances around
//   level 2  suspicious  he starts looking toward the tree (the window to hide)
//   level 3  spotted     direct eye contact, "HEY!"  (or, for the other man, he turns to look)
import * as THREE from 'three';
import { V, smooth, mix } from '../god/common.js';

export const THRESHOLDS = [0.34, 0.67, 1];
// Seconds of steady, centred watching to fill a meter from empty. Off-centre watching is slower.
export const FILL_SECONDS = 4.5;
const RECOVER_WATCHING = 0.05, RECOVER_HIDDEN = 0.16;

const FISHER_FACE = { smile: 0.05, frown: 0, browUp: 0.1, browAngry: 0, browSad: 0, squint: 0.15, sneer: 0, pucker: 0 };
const DRIVER_FACE = { smile: 0, frown: 0.35, browUp: 0, browAngry: 0.35, browSad: 0, squint: 0.32, sneer: 0 };

class Watcher {
  constructor(who) { this.who = who; this.reset(); }
  reset() {
    this.value = 0; this.level = 0; this.focus = 0; this.lastSeen = -10; this.noticed = false;
    this.glance = null; this.glanceT = 0; this.shown = 0;
  }
}

export class Watchers {
  constructor(game) {
    this.g = game;
    this.fisherman = new Watcher('fisherman');
    this.driver = new Watcher('driver');
    this.list = [this.fisherman, this.driver];
  }
  reset() { for (const w of this.list) w.reset(); }
  other(w) { return w === this.fisherman ? this.driver : this.fisherman; }
  head(who, out = V()) { return who === 'fisherman' ? this.g.fisher.B.head.getWorldPosition(out) : this.g.driver.bones.head.getWorldPosition(out); }

  /** how centred a man is in the binocular view: 1 at the centre, 0 at the edge of the lenses */
  focusOn(who) {
    const g = this.g, cam = g.camera;
    const d = this.head(who).add(V(0, -0.15, 0)).applyMatrix4(cam.matrixWorldInverse);
    if (d.z > -0.5) return 0;
    const ax = Math.atan2(d.x, -d.z), ay = Math.atan2(d.y, -d.z);
    const a = Math.hypot(ax / 1.4, ay), lens = g.lensAngle; // the two lenses overlap: wider than tall
    return 1 - smooth(a, lens * 0.18, lens * 0.72);
  }

  update(dt) {
    const g = this.g, watching = g.state === 'play' && g.raise > 0.85;
    for (const w of this.list) {
      w.focus = watching ? this.focusOn(w.who) : 0;
      if (g.state !== 'play') continue;
      if (w.focus > 0.02) {
        w.value = Math.min(1, w.value + (dt / FILL_SECONDS) * (0.15 + 0.85 * w.focus));
        w.lastSeen = g.time;
      } else {
        const hidden = g.raise < 0.35, idle = g.time - w.lastSeen;
        if (idle > (hidden ? 0.25 : 0.8)) w.value = Math.max(0, w.value - (hidden ? RECOVER_HIDDEN : RECOVER_WATCHING) * dt);
      }
      // levels with a little hysteresis so the reactions never flicker
      let level = w.level;
      while (level < 2 && w.value >= THRESHOLDS[level]) level++;
      while (level > 0 && w.value < THRESHOLDS[level - 1] - 0.05) level--;
      if (w.value >= 1) level = 3;
      if (level !== w.level) this.#changed(w, level);
      if (level === 3) { g.detect(w.who); break; }
    }
  }

  #changed(w, level) {
    const up = level > w.level;
    w.level = level;
    if (level === 0) this.#calm(w);
    if (up && level < 3) this.g.audio.alert(level);
    this.g.ui.announce(w, level);
  }

  /** the other man reacts to the shout: he turns to look, but does not shout himself */
  notice(w) { w.noticed = true; w.level = 3; w.value = Math.max(w.value, 0.999); }

  #calm(w) {
    const g = this.g;
    if (w.who === 'fisherman') {
      g.fisher.anim.lookOverride = null; g.fisher.lookAt(() => g.eyeWorld(), 600);
      g.fisher.faceToward(() => g.eyeWorld()); g.fisher.setFace(FISHER_FACE);
    } else {
      g.driverAnim.lookOverride = null; g.driverAnim.setLean({ fwd: 0 }); g.driverAnim.setFace(DRIVER_FACE);
    }
  }

  /** per frame, after update(): poses that show each man's level */
  react(dt) {
    const g = this.g, tree = g.watchPoint;
    for (const w of this.list) {
      if (w.level === 0) continue;
      const head = this.head(w.who), fisher = w.who === 'fisherman';
      const anim = fisher ? g.fisher.anim : g.driverAnim;
      if (w.level === 1) {
        // distracted: short glances around, never quite at the tree
        w.glanceT -= dt;
        if (w.glanceT <= 0 || !w.glance) {
          w.glanceT = 0.8 + Math.random() * 0.6;
          const toTree = tree.clone().sub(head).setY(0).normalize(), side = Math.random() < 0.5 ? -1 : 1;
          const turn = side * (0.9 + Math.random() * 0.6);
          w.glance = head.clone().add(toTree.applyAxisAngle(V(0, 1, 0), turn).multiplyScalar(5)).add(V(0, Math.random() * 1.5 - 0.3, 0));
        }
        anim.lookAt(w.glance, 0.25);
        if (fisher) { g.fisher.setLeft('rod'); g.fisher.setFace({ browUp: 0.45, frown: 0.2, squint: 0.15, smile: 0, browAngry: 0 }); }
        else anim.setFace({ browUp: 0.35, browAngry: 0.1, frown: 0.2 });
      } else if (w.level === 2) {
        // suspicious: the search narrows toward the branch as the meter fills
        const k = smooth(w.value, THRESHOLDS[1], 1);
        const across = tree.clone().sub(head).cross(V(0, 1, 0)).normalize();
        const search = tree.clone().addScaledVector(across, Math.sin(g.time * 1.9) * 2.2 * (1 - k)).add(V(0, (1 - k) * Math.sin(g.time * 1.3) * 0.8, 0));
        anim.lookAt(search, 0.25);
        if (fisher) {
          const body = g.eyeWorld().lerp(tree, mix(0.35, 0.9, k));
          g.fisher.faceToward(body); g.fisher.setLeft('rod');
          g.fisher.setFace({ browUp: 0.1, frown: 0.45, squint: 0.55, browAngry: 0.35, smile: 0 });
        } else { anim.setLean({ fwd: mix(0.2, 0.7, k) }); anim.setFace({ squint: 0.6, browAngry: 0.5, frown: 0.45, browUp: 0 }); }
      } else {
        // spotted: eye contact with the player
        const eyes = g.camera.position.clone();
        anim.lookAt(eyes, 0.25);
        if (fisher) { g.fisher.faceToward(eyes); g.fisher.setFace({ browUp: 0.5, frown: 0.6, squint: 0.1, browAngry: 0.75, smile: 0 }); }
        else { anim.setLean({ fwd: 0.6 }); anim.setFace({ browUp: 0.4, browAngry: 0.8, frown: 0.6, squint: 0.1 }); }
      }
    }
  }
}
