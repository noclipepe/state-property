// Entry point of the driver POV game (driver.html).
// The loading screen is plain HTML and is already on screen; this script creates the renderer,
// loads the scene with real progress ("Try again" on failure) and starts the game when it is in.
import { pickQuality, createRenderer } from '../boot.js';
import { DriverGame } from './driverGame.js';
import { DriverUI } from './ui.js';

// ?shot renders the outside preview view full-window (tools/capture-previews.mjs)
if (new URLSearchParams(location.search).has('shot')) document.documentElement.classList.add('shot');
const stage = document.getElementById('stage');
const canvas = document.getElementById('view');
const isTouch = document.documentElement.classList.contains('touch');
const quality = pickQuality(isTouch, { phoneDpr: 1.5 });

let renderer;
try {
  renderer = createRenderer(canvas, quality);
} catch (e) {
  console.error(e);
  const ui = new DriverUI({ toggleMute() {}, reset() {}, pause() {}, resume() {}, unlockAudio() {}, backToGames() { location.href = './'; }, paused: false });
  ui.setLoading('failed');
  document.getElementById('load-text').textContent = "This browser can't show 3D graphics (WebGL is off or unsupported).";
  throw e;
}

const game = new DriverGame({ renderer, stage, canvas, quality, isTouch });
window.__game = game;
window.__driverReady = true;

// the stage follows the window (orientation changes, browser toolbars) without restarting anything
const fit = () => {
  const r = stage.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) game.resize(Math.round(r.width), Math.round(r.height));
};
new ResizeObserver(fit).observe(stage);
addEventListener('orientationchange', () => setTimeout(fit, 250));
fit();

// the first tap or key wakes the sound if the browser kept it asleep after the page opened
const wake = () => { if (game.mode === 'play' && !game.paused && !game.audio.running) game.unlockAudio(); };
addEventListener('pointerdown', wake, true);
addEventListener('keydown', wake, true);

game.load((p, label) => game.loadProgress(p, label))
  .then(() => { fit(); game.ready(); })
  .catch((err) => { console.error(err); game.loadFailed(err); });
