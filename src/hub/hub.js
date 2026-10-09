// The STATE PROPERTY series menu: one card per game in SITE.games, plus the creator links.
// It loads no 3D: a game's page (and its scene) loads only after its PLAY is pressed.
import { SITE } from '../site-config.js';
import { track } from '../analytics.js';

const list = document.getElementById('games');
for (const g of SITE.games) {
  const target = g.launch?.page || g.launch?.url;
  const live = g.available && !!target;
  const card = document.createElement('article');
  card.className = 'card' + (live ? '' : g.teaser ? ' teaser' : ' off');
  card.dataset.game = g.id;

  const shot = document.createElement('div');
  shot.className = 'card-img';
  const img = document.createElement('img');
  img.src = g.image; img.alt = g.teaser ? 'A mystery: the pickup in the dark, and a question mark' : `${g.title} screenshot`;
  img.width = 640; img.height = 400; img.decoding = 'async';
  shot.append(img);

  const body = document.createElement('div');
  body.className = 'card-body';
  const h = document.createElement('h2');
  h.className = 'card-title'; h.textContent = g.title;
  body.append(h);
  if (g.tagline) { const p = document.createElement('p'); p.className = 'card-tag'; p.textContent = g.tagline; body.append(p); }
  if (live) {
    const a = document.createElement('a');
    a.className = 'btn-play'; a.href = target; a.textContent = 'PLAY';
    a.setAttribute('aria-label', `Play ${g.title}`);
    a.addEventListener('click', () => { track('game_selected', { game: g.id }); a.classList.add('going'); });
    body.append(a);
  } else if (g.teaser) {
    // An announcement: a static status in place of a launch button.
    const s = document.createElement('p');
    s.className = 'coming-soon'; s.textContent = 'COMING SOON';
    body.append(s);
  } else {
    const s = document.createElement('p');
    s.className = 'soon'; s.textContent = 'Not available yet';
    body.append(s);
  }
  card.append(shot, body);
  list.append(card);
}

for (const a of document.querySelectorAll('a[data-link]')) {
  const key = a.dataset.link;
  if (SITE.links[key]) a.href = SITE.links[key]; else a.hidden = true;
  a.addEventListener('click', () => track(`${key}_clicked`, { from: 'menu' }));
}

// coming back with the browser's Back button: undo the pressed state
addEventListener('pageshow', () => { for (const a of document.querySelectorAll('.going')) a.classList.remove('going'); });
window.__hubReady = window.__ready = true;
