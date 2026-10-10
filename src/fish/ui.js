import { SITE } from '../site-config.js';

const $ = (id) => document.getElementById(id);
export class FishUI {
  constructor(game) {
    this.game = game; this.subtitle = null;
    try { this.subs = localStorage.getItem('state-property.fish.subtitles') !== 'off'; } catch { this.subs = true; }
    const bind = (id,fn) => $(id).addEventListener('click',fn);
    bind('btn-retry', () => location.reload());
    bind('btn-splash', () => game.splash());
    bind('btn-pause', () => game.pause());
    bind('btn-resume', () => game.resume());
    for (const id of ['btn-restart','btn-menu-restart','btn-again']) bind(id, () => game.reset());
    for (const id of ['btn-games','btn-other']) bind(id, () => game.backToGames());
    bind('btn-sound', () => game.toggleMute());
    bind('btn-unmute', () => game.audio.unlock());
    bind('btn-menu-showcase', () => game.go(true));
    bind('btn-live', () => { game.showcase = false; this.begin(); });
    bind('btn-record', () => this.toggleClean());
    bind('btn-show-ui', () => this.toggleClean());
    bind('btn-subs', () => {
      this.subs = !this.subs;
      try { localStorage.setItem('state-property.fish.subtitles', this.subs ? 'on' : 'off'); } catch { /* Storage may be unavailable. */ }
      this.setSubtitle(this.subtitle); this.update();
    });
    for (const slot of document.querySelectorAll('.social-slot')) slot.append($('fish-social').content.cloneNode(true));
    for (const a of document.querySelectorAll('a[data-link]')) {
      a.href = SITE.links[a.dataset.link];
      a.addEventListener('click', () => game.pause());
    }
  }
  progress(p,label) { $('load-fill').style.width = `${Math.round(p*100)}%`; $('load-text').textContent = label; }
  failed() { $('load-text').textContent = 'Could not load the scene. Please try again.'; $('btn-retry').hidden = false; }
  begin() {
    $('start').hidden = true; $('hud').hidden = false;
    $('showcase-bar').hidden = !this.game.showcase;
    document.querySelector('.fish-controls').hidden = this.game.showcase;
    $('fish-hint').hidden = this.game.showcase;
    if (this.game.params.has('clean')) this.toggleClean(true);
  }
  reset() { this.showPause(false); $('end').hidden = true; this.setSubtitle(null); this.game.showJump = false; }
  showPause(on) { $('pause').hidden = !on; }
  showEnd() { $('end').hidden = false; $('hud').hidden = true; $('btn-show-ui').hidden = true; }
  hideChoices() {}
  setSubtitle(cue) {
    this.subtitle = cue;
    const el = $('subtitle'); el.replaceChildren();
    el.classList.toggle('show', !!cue && this.subs);
    if (!cue || !this.subs) return;
    const who = document.createElement('span'); who.className = 'who'; who.textContent = cue.who === 'driver' ? 'Driver' : 'Fisherman';
    const text = document.createElement('span'); text.textContent = cue.text;
    el.append(who,text);
  }
  toggleClean(force) {
    const clean = force ?? !this.game.stage.classList.contains('clean');
    this.game.stage.classList.toggle('clean',clean);
    $('btn-show-ui').hidden = !clean;
  }
  update() {
    const g = this.game;
    $('depth-label').textContent = g.spill?.active ? (g.spill.t < 1.4 ? 'OVERBOARD' : 'ON DRY LAND') : g.wet > 0.5 ? 'UNDERWATER' : 'A LITTLE AIR';
    document.querySelector('.fish-controls').hidden = g.showcase || !!g.spill?.active;
    $('fish-hint').hidden = g.showcase || !!g.spill?.active;
    $('btn-splash').disabled = !!g.jump || g.cooldown > 0;
    $('btn-sound').setAttribute('aria-pressed', String(g.audio.muted));
    $('btn-sound').setAttribute('aria-label', g.audio.muted ? 'Unmute sound' : 'Mute sound');
    $('btn-unmute').hidden = g.mode !== 'play' || g.paused || g.audio.running || g.ending?.shown;
    $('btn-subs').textContent = `SUBTITLES: ${this.subs ? 'ON' : 'OFF'}`;
    $('btn-subs').setAttribute('aria-pressed', String(this.subs));
    $('fish-hint').style.opacity = g.time > 7 ? '0' : '1';
  }
}
