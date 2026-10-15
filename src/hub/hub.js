// The STATE PROPERTY series menu: one card per game in SITE.games, plus the creator links.
// It loads no 3D: a game's page (and its scene) loads only after its PLAY is pressed.
import { SITE } from '../site-config.js';
import { track } from '../analytics.js';
import { createFishermanSkinPicker } from './fisherman-skin.js';
import { createCarousel } from './carousel.js';

const list = document.getElementById('games');
for (const g of SITE.games) {
  const target = g.launch?.page || g.launch?.url;
  const live = g.available && !!target;
  const card = document.createElement('article');
  card.className = 'card' + (live ? '' : g.teaser ? ' teaser' : ' off');
  card.classList.toggle('is-new', !!g.isNew);
  card.dataset.game = g.id;

  const shot = document.createElement('div');
  shot.className = 'card-img';
  const img = document.createElement('img');
  img.src = g.image; img.alt = g.teaser ? 'A mystery: the pickup in the dark, and a question mark' : `${g.title} screenshot`;
  img.width = 640; img.height = 400; img.decoding = 'async';
  shot.append(img);

  const body = document.createElement('div');
  body.className = 'card-body';
  if (g.isNew) { const badge = document.createElement('span'); badge.className = 'new-badge'; badge.textContent = 'NEW'; body.append(badge); }
  const h = document.createElement('h2');
  h.className = 'card-title'; h.textContent = g.title;
  body.append(h);
  if (g.tagline) { const p = document.createElement('p'); p.className = 'card-tag'; p.textContent = g.tagline; body.append(p); }
  if (live) {
    const a = document.createElement('a');
    a.className = 'btn-play'; a.href = target; a.textContent = 'PLAY';
    a.setAttribute('aria-label', `Play ${g.title}`);
    a.addEventListener('click', () => { track('game_selected', { game: g.id }); a.classList.add('going'); });
    if (g.id === 'fisherman') body.append(createFishermanSkinPicker({ card, img, launch: a, originalImage: g.image }));
    body.append(a);
  } else if (g.teaser) {
    // an announcement: no PLAY, a reason to follow instead
    const s = document.createElement('p');
    s.className = 'soon-badge'; s.textContent = 'COMING SOON';
    body.prepend(s);
    if (SITE.links.instagram) {
      const a = document.createElement('a');
      a.className = 'notify'; a.href = SITE.links.instagram; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Get notified';
      a.addEventListener('click', () => track('instagram_clicked', { from: 'teaser' }));
      body.append(a);
    }
  } else {
    const s = document.createElement('p');
    s.className = 'soon'; s.textContent = 'Not available yet';
    body.append(s);
  }
  card.append(shot, body);
  list.append(card);
}
createCarousel(list);

// The token block: the whole address is one big copy button; BUY and CHART open in a new tab.
const token = document.getElementById('token');
const ca = SITE.token?.ca;
if (!ca) token.hidden = true;
else {
  const copyBtn = document.getElementById('copy-ca');
  const label = document.getElementById('copy-ca-label');
  const status = document.getElementById('copy-ca-status');
  document.getElementById('token-ca').textContent = ca;
  copyBtn.setAttribute('aria-label', `Copy contract address ${ca}`);
  for (const [id, key] of [['token-buy', 'buy'], ['token-chart', 'chart']]) {
    const a = document.getElementById(id);
    if (SITE.token[key]) a.href = SITE.token[key]; else a.hidden = true;
    a.addEventListener('click', () => track(`token_${key}_clicked`, { from: 'menu' }));
  }
  let resetTimer = 0;
  copyBtn.addEventListener('click', async () => {
    let copied = false;
    try { await navigator.clipboard.writeText(ca); copied = true; } catch {
      // The phone's local HTTP preview may not provide the Clipboard API.
      const field = document.createElement('textarea');
      field.value = ca; field.readOnly = true;
      field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;font-size:16px';
      document.body.append(field); field.select(); field.setSelectionRange(0, ca.length);
      try { copied = document.execCommand('copy'); } catch {} finally { field.remove(); }
      copyBtn.focus({ preventScroll: true });
    }
    if (copied) track('token_ca_copied', { from: 'menu' });
    token.classList.toggle('copied', copied);
    label.textContent = copied ? 'COPIED' : 'COPY CA';
    status.textContent = copied ? 'Contract address copied!' : 'Press and hold the address to copy it';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      token.classList.remove('copied'); label.textContent = 'COPY CA'; status.textContent = 'Tap the address to copy';
    }, 2600);
  });
}

for (const a of document.querySelectorAll('a[data-link]')) {
  const key = a.dataset.link;
  if (SITE.links[key]) a.href = SITE.links[key]; else a.hidden = true;
  a.addEventListener('click', () => track(`${key}_clicked`, { from: 'menu' }));
}

// coming back with the browser's Back button: undo the pressed state
addEventListener('pageshow', () => { for (const a of document.querySelectorAll('.going')) a.classList.remove('going'); });
window.__hubReady = window.__ready = true;
