// Page boot shared by both modes: 9:16 stage sizing, renderer, quality preset, loading, start.
import * as THREE from 'three';

export function boot(GameClass) {
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('view');
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  document.body.classList.toggle('touch', isTouch);

  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    let w, h;
    if (vw / vh <= 0.66) { w = vw; h = vh; } // phone portrait: use the whole screen
    else { h = vh; w = Math.round(h * 9 / 16); if (w > vw) { w = vw; h = Math.round(w * 16 / 9); } }
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    return { w, h };
  }
  let size = layout();

  const quality = pickQuality(isTouch);
  const renderer = createRenderer(canvas, quality);
  renderer.setSize(size.w, size.h, false);

  const loadFill = document.getElementById('load-fill');
  const loadText = document.getElementById('load-text');
  const game = new GameClass({ renderer, stage, canvas, quality, isTouch });
  window.__game = game;

  addEventListener('resize', () => { size = layout(); game.resize(size.w, size.h); });

  game.load((p, label) => {
    loadFill.style.width = Math.round(p * 100) + '%';
    if (label) loadText.textContent = label;
  }).then(() => {
    game.resize(size.w, size.h);
    game.start();
  }).catch((err) => {
    console.error(err);
    loadText.textContent = "Couldn't load the game. Check your connection.";
    const retry = document.createElement('button');
    retry.className = 'pill-btn';
    retry.textContent = 'Try again';
    retry.style.marginTop = '12px';
    retry.addEventListener('click', () => location.reload());
    loadText.after(retry);
  });
  return game;
}

// Quality preset: phones get fewer grass blades / leaves, a smaller shadow map and a capped pixel ratio.
// ?q=low / ?q=high forces a preset.
export function pickQuality(isTouch, { phoneDpr = 1.6 } = {}) {
  const q = new URLSearchParams(location.search).get('q');
  const low = q === 'low' || (q !== 'high' && isTouch);
  return low
    ? { name: 'low', shadow: 1024, grass: 14000, leaves: 140, reeds: 160, dpr: Math.min(window.devicePixelRatio, phoneDpr) }
    : { name: 'high', shadow: 2048, grass: 32000, leaves: 260, reeds: 320, dpr: Math.min(window.devicePixelRatio, 2) };
}

export function createRenderer(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}
