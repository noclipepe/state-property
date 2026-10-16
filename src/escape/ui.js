const $ = (id) => document.getElementById(id);

export class EscapeUI {
  constructor(game) {
    this.g = game;
    const on = (id, fn) => $(id).addEventListener('click', fn, { signal: game.abort.signal });
    on('btn-again', () => game.restart());
    on('btn-sound', () => game.toggleMute());
    on('btn-retry', () => location.reload());
    on('btn-play', () => game.begin());
    for (const id of ['btn-menu', 'btn-other']) $(id).addEventListener('click', () => game.destroy(), { signal: game.abort.signal });
    const touch = document.documentElement.classList.contains('touch');
    $('hint').textContent = touch ? 'Tap to hop forward · swipe left, right or back' : 'W A S D or arrow keys to hop · Space hops forward';
    $('skip').textContent = touch ? 'Tap to skip' : 'Press any key to skip';
  }
  progress(p, label) { $('load-fill').style.width = `${Math.round(p * 100)}%`; $('load-text').textContent = label; }
  failed() { $('load-text').textContent = 'Could not load the course. Please try again.'; $('btn-retry').hidden = false; }
  /** loaded: the PLAY button (the first tap also turns the sound on) */
  loaded() { $('load-fill').parentElement.parentElement.hidden = true; $('btn-play').hidden = false; $('btn-play').focus({ preventScroll: true }); }
  ready() { $('start').classList.add('gone'); setTimeout(() => { $('start').hidden = true; }, 450); this.hud(true); }
  /** the opening scene: letterbox bars, captions, no score */
  cinema(on) { $('bars').classList.toggle('on', on); $('hud').classList.toggle('cinema', on); $('skip').hidden = !on; }
  hud(on) { $('hud').hidden = !on; }
  reset() { $('end').hidden = true; this.warn(false); this.update(); }
  moved(n) { if (n >= 3) $('hint').classList.add('gone'); }
  /** caption for a line of the original recording ({speaker, text}) or null */
  line(cue) {
    const key = cue ? cue.t0 : null; if (key === this.lineKey) return; this.lineKey = key;
    $('line').classList.toggle('on', !!cue);
    if (cue) { $('line-who').textContent = cue.speaker === 'driver' ? 'DRIVER' : 'FISHERMAN'; $('line-text').textContent = cue.text.replace(/�/g, '…'); }
  }
  warn(on) { $('hook-warning').classList.toggle('on', on); }
  results(cause, score, best, record) {
    const T = { hook: ['Back in the bucket', 'You stood still too long: the fisherman hooked you.'], crab: ['Pinched!', 'A crab got you.'],
      car: ['Flattened!', 'Hit by the pickup. It never stops for fish.'], swept: ['Swept away!', 'The current carried you off. Hop out sooner.'] }[cause];
    $('end-title').textContent = T[0]; $('end-why').textContent = T[1];
    $('end-score').textContent = String(score);
    $('end-best').textContent = record ? 'New record!' : `Best: ${best}`;
    $('end-best').classList.toggle('record', record);
    $('end').hidden = false; $('hud').hidden = true;
    $('btn-again').focus({ preventScroll: true });
  }
  update() {
    const g = this.g;
    $('score').textContent = String(g.score ?? 0);
    $('best').textContent = `BEST ${Math.max(g.best || 0, g.score || 0)}`;
    const s = $('btn-sound'); s.textContent = g.audio.muted ? 'SOUND OFF' : 'SOUND ON'; s.setAttribute('aria-pressed', String(!g.audio.muted));
  }
}
