// DOM overlay: start screen, HUD buttons, target labels, tension meter, hints, record mode.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.stage = $('stage');
    this.labelsEl = $('target-labels');
    this.labels = new Map();
    this.hintEl = $('hint');
    this.tension = $('tension'); this.tensionFill = $('tension-fill');
    this.reelBtn = $('btn-reel'); this.releaseBtn = $('btn-release');
    this.menu = $('menu');
    this.record = false;
    this.hintText = '';

    $('btn-go').addEventListener('click', () => game.go());
    $('btn-mute').addEventListener('click', () => game.toggleMute());
    $('btn-reset').addEventListener('click', () => { this.closeMenu(); game.reset(); });
    $('btn-menu').addEventListener('click', (e) => { e.stopPropagation(); this.menu.classList.toggle('hidden'); });
    $('btn-skip').addEventListener('click', () => game.skipIntro());
    this.releaseBtn.addEventListener('click', () => game.onRelease());
    $('btn-rec-exit').addEventListener('click', () => game.setRecordMode(false));
    $('btn-rec-reset').addEventListener('click', () => game.reset());
    $('btn-rec-show').addEventListener('click', () => game.startShowcase());
    this.menu.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      this.closeMenu();
      if (act === 'showcase') game.startShowcase();
      if (act === 'record') game.setRecordMode(true);
      if (act === 'intro') game.replayIntro();
      if (act === 'games') game.backToGames();
    });
    document.addEventListener('pointerdown', (e) => { if (!this.menu.contains(e.target) && e.target !== $('btn-menu')) this.closeMenu(); });
  }

  closeMenu() { this.menu.classList.add('hidden'); }
  showLoading(on) { $('loading').classList.toggle('hidden', !on); }
  showStart(on) { $('start').classList.toggle('hidden', !on); }
  showHud(on) { $('hud').classList.toggle('hidden', !on); }
  showSkip(on) { $('btn-skip').classList.toggle('hidden', !on); }
  setMuted(m) { $('btn-mute').classList.toggle('muted', m); $('btn-mute').setAttribute('aria-label', m ? 'Unmute' : 'Mute'); }
  setControls(on) { this.reelBtn.classList.toggle('hidden', !on); }
  setRecord(on) {
    this.record = on;
    this.stage.classList.toggle('rec', on);
    $('rec-badge').classList.toggle('hidden', !on);
  }
  setHint(text) {
    if (text === this.hintText) return;
    this.hintText = text;
    this.hintEl.textContent = text;
  }

  ensureLabel(t) {
    let el = this.labels.get(t.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tlabel';
      el.textContent = t.label;
      this.labelsEl.appendChild(el);
      this.labels.set(t.id, el);
    }
    return el;
  }

  /** per frame: project labels, update meter & buttons */
  update({ camera, targets, hot, hooked, tension, showLabels, w, h, hookedState }) {
    const v = new THREE.Vector3();
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const edgeY = { l: [], r: [] };
    const placed = [];
    for (const t of targets) {
      const el = this.ensureLabel(t);
      if (!showLabels || !t.enabled() || (hooked && hooked !== t)) { el.style.opacity = 0; continue; }
      t.anchor(v);
      const dist = v.distanceTo(camPos);
      v.project(camera);
      if (dist > 8) { el.style.opacity = 0; continue; }
      let x, y, edge = '';
      if (v.z < 1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98) {
        x = (v.x * 0.5 + 0.5) * w; y = (-v.y * 0.5 + 0.5) * h;
      } else {
        // off-screen: pin to the nearest side edge with an arrow
        const cq = camera.getWorldQuaternion(new THREE.Quaternion()).invert();
        const rel = t.anchor(new THREE.Vector3()).sub(camPos).applyQuaternion(cq);
        const left = rel.x < 0;
        x = left ? 44 : w - 44;
        y = THREE.MathUtils.clamp((0.5 - rel.y / Math.max(0.3, -rel.z || 0.3) * 0.4) * h, h * 0.2, h * 0.62);
        edge = left ? 'l' : 'r';
        el.dataset.edge = edge;
      }
      if (!edge) {
        delete el.dataset.edge;
        // nudge on-screen labels apart vertically
        for (const p of placed) if (Math.abs(p.x - x) < 80 && Math.abs(p.y - y) < 24) y = p.y - 24;
        placed.push({ x, y });
      } else {
        // stack edge indicators so they never overlap
        for (const oy of edgeY[edge].sort((p, q) => p - q)) if (Math.abs(oy - y) < 28) y = oy + 28;
        edgeY[edge].push(y);
      }
      el.style.left = x + 'px';
      el.style.top = (y - 10) + 'px';
      const isHot = hot === t || hooked === t;
      el.classList.toggle('hot', isHot);
      const txt = hooked === t ? (hookedState || t.label) : t.label;
      el.textContent = el.dataset.edge === 'l' ? '‹ ' + txt : el.dataset.edge === 'r' ? txt + ' ›' : txt;
      el.style.opacity = el.dataset.edge ? 0.75 : isHot ? 1 : Math.max(0.6, 1 - dist / 9);
    }
    this.tension.classList.toggle('hidden', !hooked || this.record);
    this.tensionFill.style.width = Math.round(tension * 100) + '%';
    this.releaseBtn.classList.toggle('hidden', !hooked);
  }
}
