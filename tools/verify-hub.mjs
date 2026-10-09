// Verifies the STATE PROPERTY series menu and switching between the games:
//   node tools/verify-hub.mjs [outDir] [baseUrl]     baseUrl default http://localhost:8080/
//   (production: node tools/serve.mjs 8090 dist, then http://localhost:8090/)
// The menu: cards from SITE.games with screenshots and PLAY, no 3D loaded, brand font, the
// Follow for updates block (Instagram, X, >= 44 px), an unavailable game shown greyed out with no
// PLAY. Launch Driver POV -> back to games (sound stopped) -> Fisherman POV -> back -> Driver again.
// The "??? POV" teaser card: one static COMING SOON status after the tagline, no links or buttons.
// Layout: phones 360x800 / 390x844 / 430x932 portrait (cards stacked, everything on one screen),
// 844x390 and 667x375 landscape and 1280x800 desktop (cards side by side).
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] || 'check-out';
const BASE = (process.argv[3] || 'http://localhost:8080/').replace(/\/?$/, '/');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const errors = [];
async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => document.addEventListener('click', (e) => { if (e.target.closest?.('a[target=_blank]')) e.preventDefault(); }, true));
  return { ctx, page };
}
const hubReady = (page) => page.waitForFunction(() => window.__hubReady === true, null, { timeout: 30000 });

// =================================================================== desktop: the menu and switching games
{
  const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE);
  await hubReady(page);
  const hub = await page.evaluate(async () => {
    await document.fonts.ready;
    const cards = [...document.querySelectorAll('.card')];
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
    return {
      cards: cards.map((c) => ({ id: c.dataset.game, title: c.querySelector('.card-title').textContent, play: c.querySelector('.btn-play')?.getAttribute('href') ?? 'undefined', img: c.querySelector('img').naturalWidth })),
      three: performance.getEntriesByType('resource').some((r) => /three\.(module|core)\.js|meshes\//.test(r.name)),
      canvas: document.querySelectorAll('canvas').length,
      font: [...document.fonts].some((f) => f.family.includes('NewRodin') && f.status === 'loaded') && /NewRodin/.test(getComputedStyle(document.querySelector('.hub-title')).fontFamily),
      bg: getComputedStyle(document.querySelector('.hub')).backgroundImage,
      social: [...document.querySelectorAll('.social-btn')].map((a) => ({ k: a.dataset.link, href: a.href, w: a.offsetWidth, h: a.offsetHeight, label: a.textContent.trim() })),
      socialTitle: document.querySelector('.social-title').textContent.trim(),
      events: (window.__events || []).length,
      sideBySide: cards.length > 1 && Math.abs(cards[0].getBoundingClientRect().top - cards[1].getBoundingClientRect().top) < 2,
    };
  });
  check('menu: Fisherman POV and Driver POV cards with screenshots and PLAY, then the ??? POV teaser', hub.cards.map((c) => `${c.title}>${c.play}`).join() === 'FISHERMAN POV>fisherman.html,DRIVER POV>driver.html,??? POV>undefined' && hub.cards.every((c) => c.img > 0), JSON.stringify(hub.cards.map((c) => c.title)));
  const teaser = await page.evaluate(() => { const c = document.querySelector('.card.teaser'); const s = c?.querySelector('.coming-soon'); return { status: s?.textContent, count: c?.querySelectorAll('.coming-soon').length, interactive: !!c?.querySelector('a, button, [role=button], [tabindex]'), last: s === c?.querySelector('.card-body').lastElementChild, oldBadge: !!c?.querySelector('.soon-badge'), h: s?.offsetHeight }; });
  check('teaser: one static COMING SOON status in the button position, no interactive controls', teaser.status === 'COMING SOON' && teaser.count === 1 && !teaser.interactive && teaser.last && !teaser.oldBadge && teaser.h >= 48, JSON.stringify(teaser));
  check('menu loads no 3D (no three.js, meshes or canvas)', !hub.three && hub.canvas === 0);
  check('menu uses the brand font and the supplied background', hub.font && /assets\/brand\/background/.test(hub.bg));
  check('Follow for updates: Instagram + X, labelled, >= 44 px', hub.socialTitle === 'Follow for updates' && hub.social.map((s) => s.k).join() === 'instagram,x' && hub.social[0].href === 'https://www.instagram.com/noclipepe/' && hub.social[1].href === 'https://x.com/noclipepe' && hub.social.every((s) => s.w >= 44 && s.h >= 44 && s.label), JSON.stringify(hub.social.map((s) => [s.label, s.w, s.h])));
  check('desktop: the cards sit side by side', hub.sideBySide);
  check('opening the menu tracks nothing', hub.events === 0);
  await page.click('.social-btn[data-link=instagram]');
  await page.click('.social-btn[data-link=x]');
  await page.click('.card.teaser .coming-soon');
  check('only Instagram + X clicks are tracked; the teaser status does nothing', (await page.evaluate(() => window.__events.map((e) => e.name).join())) === 'instagram_clicked,x_clicked' && page.url() === BASE);
  await page.screenshot({ path: `${out}/hub-desktop.png` });

  // ---- Driver POV, back, Fisherman POV, back, Driver POV again
  await Promise.all([page.waitForURL(/driver\.html$/), page.click('.card[data-game=driver] .btn-play')]);
  await page.waitForFunction(() => window.__game?.mode === 'play', null, { timeout: 90000 });
  check('PLAY on Driver POV loads that game and starts it', await page.evaluate(() => document.querySelectorAll('canvas').length === 1 && window.__game.mode === 'play'));
  await page.waitForFunction(() => window.__game.state === 'choose', null, { timeout: 15000 });
  await page.click('#btn-pause');
  await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('exitAudio', window.__game.audio.ctx.state)));
  await Promise.all([page.waitForURL((u) => u.pathname.endsWith('/')), page.click('#btn-games')]);
  await hubReady(page);
  check('Pause > BACK TO GAMES returns to the menu with the sound stopped', (await page.evaluate(() => sessionStorage.getItem('exitAudio'))) === 'suspended' && (await page.locator('.card').count()) === 3);

  await Promise.all([page.waitForURL(/fisherman\.html$/), page.click('.card[data-game=fisherman] .btn-play')]);
  await page.waitForFunction(() => window.__ready === true && window.__game?.mode === 'title', null, { timeout: 90000 });
  await page.click('#btn-go');
  await page.waitForTimeout(600);
  const fish = await page.evaluate(() => ({ mode: window.__game.mode, canvas: document.querySelectorAll('canvas').length, driver: !!window.__game.conv }));
  check('PLAY on Fisherman POV opens the original fisherman game (GO FISHING works)', fish.mode === 'play' && fish.canvas === 1 && !fish.driver, JSON.stringify(fish));
  await page.click('#btn-menu');
  await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('exitAudio2', window.__game.audio.ctx.state)));
  await Promise.all([page.waitForURL((u) => u.pathname.endsWith('/')), page.click('#menu [data-act=games]')]);
  await hubReady(page);
  check('Fisherman Modes > Back to games returns to the menu with the sound stopped', (await page.evaluate(() => sessionStorage.getItem('exitAudio2'))) === 'suspended');

  await Promise.all([page.waitForURL(/driver\.html$/), page.click('.card[data-game=driver] .btn-play')]);
  await page.waitForFunction(() => window.__game?.state === 'choose', null, { timeout: 90000 });
  await page.click('#choices button >> nth=0');
  await page.waitForTimeout(800);
  check('Driver POV launches again and plays normally', await page.evaluate(() => window.__game.conv.clip?.id === 'd_who'));
  // end screen: CHOOSE ANOTHER POV
  await page.evaluate(() => window.__game.debugHook());
  await page.waitForFunction(() => !document.getElementById('end').hidden, null, { timeout: 20000 });
  await Promise.all([page.waitForURL((u) => u.pathname.endsWith('/')), page.click('#btn-other')]);
  await hubReady(page);
  check('end screen > CHOOSE ANOTHER POV returns to the menu', (await page.locator('.card').count()) === 3);
  await ctx.close();
}

// =================================================================== an unavailable game (config changed on the fly)
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.route('**/src/site-config.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace("available: true, launch: { page: 'fisherman.html' }", 'available: false, launch: {}');
    await route.fulfill({ response: res, body });
  });
  await page.goto(BASE);
  await hubReady(page);
  const off = await page.evaluate(() => { const c = document.querySelector('.card[data-game=fisherman]'); return { off: c.classList.contains('off'), play: !!c.querySelector('.btn-play, a'), soon: c.querySelector('.soon')?.textContent }; });
  check('unavailable game: greyed card, "Not available yet", no PLAY', off.off && !off.play && off.soon === 'Not available yet', JSON.stringify(off));
  await ctx.close();
}

// =================================================================== layouts
for (const [w, h, label] of [[360, 800, 'phone'], [390, 844, 'phone'], [430, 932, 'phone'], [844, 390, 'landscape'], [667, 375, 'landscape']]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE);
  await hubReady(page);
  const L = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.card')].map(r);
    const plays = [...document.querySelectorAll('.card .btn-play')].map(r);
    const social = [...document.querySelectorAll('.social-btn')].map(r);
    return {
      fits: document.scrollingElement.scrollHeight <= innerHeight + 1,
      stacked: cards.every((c, i) => i === 0 || c.top >= cards[i - 1].bottom), side: cards.every((c) => Math.abs(c.top - cards[0].top) < 2),
      plays: plays.every((p) => p.height >= 48), social: social.every((s) => s.height >= 44 && s.width >= 44),
      bottom: Math.round(social[0].bottom), h: innerHeight,
    };
  });
  const arrangement = label === 'phone' ? L.stacked : L.side;
  check(`${w}x${h}: ${label === 'phone' ? 'cards stacked' : 'cards side by side'}, everything on one screen, PLAY >= 48 px, links >= 44 px`,
    arrangement && L.fits && L.plays && L.social, `social block ends at ${L.bottom}/${L.h}`);
  await page.screenshot({ path: `${out}/hub-${w}x${h}.png` });
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed  (${BASE})`);
process.exit(pass === results.length ? 0 : 1);
