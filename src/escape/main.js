import { pickQuality, createRenderer } from '../boot.js';
import { EscapeGame } from './game.js';

const stage = document.getElementById('stage'), canvas = document.getElementById('view');
const quality = pickQuality(document.documentElement.classList.contains('touch'), { phoneDpr: 1.5 });
const fail = (e) => { console.error(e); document.getElementById('load-text').textContent = 'Could not load the course. Please try again.'; document.getElementById('btn-retry').hidden = false; };
try {
  const game = new EscapeGame({ renderer: createRenderer(canvas, quality), canvas, stage, quality }); window.__game = game;
  const fit = () => { if (game.destroyed) return; const r = stage.getBoundingClientRect(); if (r.width && r.height) game.resize(Math.round(r.width), Math.round(r.height)); };
  game.resizeObserver = new ResizeObserver(fit); game.resizeObserver.observe(stage); fit();
  game.load().then(fit).catch(fail);
} catch (e) { fail(e); document.getElementById('btn-retry').onclick = () => location.reload(); }
// A restored page must not resurrect a disposed renderer or a closed AudioContext.
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
