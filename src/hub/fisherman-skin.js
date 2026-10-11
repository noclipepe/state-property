// Static Fisherman card previews share the game's existing, POV-specific preference.
import { getFishermanSkin, saveFishermanSkin } from '../skins.js';

export function createFishermanSkinPicker({ card, img, launch, originalImage }) {
  const skins = {
    original: { label: 'Original', image: originalImage, alt: 'Original driver at the white pickup window, seen by the fisherman' },
    gru: { label: 'Gru', image: 'assets/brand/card-fisherman-gru.jpg', alt: 'Gru at the window of his riveted metal vehicle with the mounted shrink ray' },
  };
  const picker = document.createElement('div');
  picker.className = 'fisherman-skin';
  picker.innerHTML = `
    <button class="skin-toggle" id="choose-skin" type="button" aria-expanded="false" aria-controls="skin-options">
      <span class="new-badge">NEW</span>
      <span id="skin-current"></span><span class="skin-chevron" aria-hidden="true">▾</span>
    </button>
    <div id="skin-options" class="skin-options" role="group" aria-label="Fisherman POV skin" hidden>
      <div class="skin-buttons">
        <button type="button" data-skin="original" aria-pressed="false">Original<span aria-hidden="true">✓</span></button>
        <button type="button" data-skin="gru" aria-pressed="false">Gru<span aria-hidden="true">✓</span></button>
      </div>
    </div>`;
  const toggle = picker.querySelector('.skin-toggle');
  const panel = picker.querySelector('.skin-options');
  const buttons = [...picker.querySelectorAll('[data-skin]')];
  const launchPage = launch.getAttribute('href').split(/[?#]/)[0];
  const launchUrl = new URL(launch.href);
  let selected = getFishermanSkin();

  function reflect(skin) {
    selected = skin;
    const choice = skins[skin];
    picker.querySelector('#skin-current').textContent = `SKIN: ${choice.label.toUpperCase()}`;
    toggle.setAttribute('aria-label', `New. Skin: ${choice.label}. Choose Fisherman POV skin`);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.skin === skin));
    img.src = choice.image;
    img.alt = choice.alt;
    // An explicit query also launches the right skin when browser storage is blocked.
    launchUrl.searchParams.set('skin', skin);
    launch.href = launchPage + launchUrl.search + launchUrl.hash;
    launch.setAttribute('aria-label', `Play Fisherman POV with ${choice.label} skin`);
  }
  function close(restoreFocus = false) {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    card.classList.remove('skin-open');
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }
  function open() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    card.classList.add('skin-open');
    buttons.find(button => button.dataset.skin === selected).focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => panel.hidden ? open() : close(true));
  panel.addEventListener('click', event => {
    const skin = event.target.closest('[data-skin]')?.dataset.skin;
    if (!skins[skin]) return;
    saveFishermanSkin(skin);
    reflect(skin);
    close(true);
  });
  picker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      close(true);
    } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (panel.hidden) { open(); return; }
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  });
  document.addEventListener('pointerdown', event => { if (!picker.contains(event.target)) close(); });
  picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget)) close(); });
  addEventListener('pageshow', event => { close(); if (event.persisted) reflect(getFishermanSkin()); });
  addEventListener('storage', () => { close(); reflect(getFishermanSkin()); });
  reflect(selected);
  return picker;
}
