import { pickQuality, createRenderer } from '../boot.js';
import { FishGame } from './game.js';

const stage = document.getElementById('stage'), canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);
if (params.has('shot')) document.documentElement.classList.add('fish-recording');
const quality = pickQuality(document.documentElement.classList.contains('touch'), { phoneDpr: 1.35 });
try {
  const renderer = createRenderer(canvas, quality);
  const game = new FishGame({ renderer, stage, canvas, quality });
  window.__game = game;
  // Keep the opening dialogue intact if a browser requires a fresh sound gesture.
  const wakeSound = () => { if (!game.paused && !game.exited && !game.ending?.shown && !game.audio.running) game.audio.unlock(); };
  addEventListener('pointerdown', wakeSound, { capture: true });
  addEventListener('keydown', wakeSound, { capture: true });
  const fit = () => { const r = stage.getBoundingClientRect(); if (r.width && r.height) game.resize(Math.round(r.width),Math.round(r.height)); };
  new ResizeObserver(fit).observe(stage); fit();
  game.load().then(fit).catch((err) => { console.error(err); game.ui.failed(); });
} catch (err) {
  console.error(err);
  document.getElementById('load-text').textContent = 'This browser could not start WebGL. Please try another browser.';
  document.getElementById('btn-retry').hidden = false;
  document.getElementById('btn-retry').onclick = () => location.reload();
}
