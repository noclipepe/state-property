// Verifies the STATE PROPERTY series menu and switching between the games:
//   node tools/verify-hub.mjs [outDir] [baseUrl]     baseUrl default http://localhost:8080/
//   (production: node tools/serve.mjs 8090 dist, then http://localhost:8090/)
// The menu: cards from SITE.games with screenshots and PLAY, no 3D loaded, brand font, the
// NEW GAMES & UPDATES block (Instagram, X, >= 44 px), an unavailable game shown greyed out with no
// PLAY. Exercise Fisherman skins, persistence and dismissal, then launch all three POVs.
// Fish POV replaces the teaser with a real screenshot and a working PLAY button.
// Layout: mobile cards use a native horizontal rail; desktop keeps all four side by side.
// Actual finger gestures, preview failures and warm cache: tools/verify-hub-touch.mjs.
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
      social: [...document.querySelectorAll('.social-btn')].map((a) => ({ k: a.dataset.link, href: a.href, w: a.offsetWidth, h: a.offsetHeight, label: a.getAttribute('aria-label') || a.textContent.trim() })),
      events: (window.__events || []).length,
      sideBySide: cards.length > 1 && Math.abs(cards[0].getBoundingClientRect().top - cards[1].getBoundingClientRect().top) < 2,
    };
  });
  check('menu: five playable POV cards with screenshots', hub.cards.map((c) => `${c.title}>${c.play}`).join() === 'FISHERMAN POV>fisherman.html?skin=original,DRIVER POV>driver.html,FISH POV>fish.html,ANT POV>ant.html,GOD POV>god.html' && hub.cards.every((c) => c.img > 0), JSON.stringify(hub.cards.map((c) => c.title)));
  check('Fish POV replaces the secret teaser', await page.locator('.card.teaser').count() === 0 && await page.locator('[data-game=fish] .card-tag').textContent() === "You're already caught.");
  check('only GOD POV has NEW and a highlighted border; skin label no longer says New', await page.evaluate(() => {
    const card=document.querySelector('[data-game=god]'),style=getComputedStyle(card);
    return document.querySelectorAll('.new-badge').length===1 && card.querySelector('.new-badge')?.textContent==='NEW'
      && document.querySelectorAll('.card.is-new').length===1 && card.classList.contains('is-new')
      && style.borderColor==='rgb(255, 229, 154)' && style.boxShadow.includes('2px')
      && !document.querySelector('#choose-skin').getAttribute('aria-label').startsWith('New.');
  }));
  check('menu loads no 3D (no three.js, meshes or canvas)', !hub.three && hub.canvas === 0);
  check('menu uses the brand font and the supplied background', hub.font && /assets\/brand\/background/.test(hub.bg));
  check('NEW GAMES & UPDATES: Instagram + X, labelled, >= 44 px', hub.social.map((s) => s.k).join() === 'instagram,x' && hub.social[0].href === 'https://www.instagram.com/noclipepe/' && hub.social[1].href === 'https://x.com/noclipepe' && hub.social.every((s) => s.w >= 44 && s.h >= 44 && s.label), JSON.stringify(hub.social.map((s) => [s.label, s.w, s.h])));
  check('X shows only its logo and retains an accessible label', await page.locator('.social-btn[data-link=x]').evaluate(el => el.textContent.trim() === '' && el.querySelectorAll('svg').length === 1 && el.getAttribute('aria-label') === 'X'));
  check('desktop: the cards sit side by side', hub.sideBySide);
  check('desktop: preview tops and PLAY buttons align across cards', await page.evaluate(() => {
    const images = [...document.querySelectorAll('.card-img')].map(el => el.getBoundingClientRect().top);
    const plays = [...document.querySelectorAll('.card .btn-play')].map(el => el.getBoundingClientRect().bottom);
    return Math.max(...images) - Math.min(...images) < 2 && Math.max(...plays) - Math.min(...plays) < 2;
  }));
  check('opening the menu tracks nothing', hub.events === 0);
  await page.click('.social-btn[data-link=instagram]');
  await page.click('.social-btn[data-link=x]');
  check('Instagram + X clicks are tracked', (await page.evaluate(() => window.__events.map((e) => e.name).join())) === 'instagram_clicked,x_clicked');
  await page.screenshot({ path: `${out}/hub-desktop.png` });

  check('only Fisherman has a skin selector, between description and PLAY', await page.evaluate(() => {
    const card = document.querySelector('[data-game=fisherman]');
    const picker = card.querySelector('.fisherman-skin');
    return document.querySelectorAll('.fisherman-skin').length === 1 && !document.querySelector('.skin-teaser')
      && picker.previousElementSibling.classList.contains('card-tag') && picker.nextElementSibling.classList.contains('btn-play');
  }));
  const skinState = () => page.evaluate(() => ({
    label: document.querySelector('#skin-current').textContent,
    open: !document.querySelector('#skin-options').hidden,
    expanded: document.querySelector('#choose-skin').getAttribute('aria-expanded'),
    selected: [...document.querySelectorAll('[data-skin][aria-pressed=true]')].map(el => el.dataset.skin).join(),
    image: document.querySelector('[data-game=fisherman] img').getAttribute('src'),
    stored: JSON.parse(localStorage.getItem('state-property:fisherman-skin'))?.skin,
    focus: document.activeElement.id || document.activeElement.dataset.skin,
  }));
  const choose = async skin => { await page.click('#choose-skin'); await page.click(`[data-skin=${skin}]`); };
  check('default Fisherman label and preview are Original', (await skinState()).label === 'SKIN: ORIGINAL' && (await skinState()).image.endsWith('card-fisherman.jpg'));
  await page.focus('#choose-skin');
  await page.keyboard.press('Enter');
  check('keyboard opens the panel and focuses the selected option', (await skinState()).focus === 'original' && (await skinState()).expanded === 'true');
  await page.keyboard.press('ArrowDown');
  check('arrow navigation changes focus without committing a skin', (await skinState()).focus === 'gru' && (await skinState()).selected === 'original');
  await page.keyboard.press('Escape');
  check('Escape closes without changing the skin and restores trigger focus', !(await skinState()).open && (await skinState()).focus === 'choose-skin' && (await skinState()).label === 'SKIN: ORIGINAL');
  await page.keyboard.press('Space');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  let selected = await skinState();
  check('keyboard selects Gru, updates the preview, highlights it and closes', selected.label === 'SKIN: GRU' && selected.image.endsWith('card-fisherman-gru.jpg') && selected.selected === 'gru' && !selected.open && selected.focus === 'choose-skin');
  check('selecting a skin stays on the menu and saves only the Fisherman preference', page.url() === BASE && selected.stored === 'gru' && await page.evaluate(() => localStorage.length === 1));
  await page.locator('[data-game=fisherman] img').evaluate(img => img.decode());
  await page.screenshot({ path: `${out}/hub-desktop-gru.png` });
  await page.click('#choose-skin');
  await page.screenshot({ path: `${out}/hub-desktop-picker.png` });
  await page.click('.hub-title');
  check('outside click dismisses the panel without changing Gru', !(await skinState()).open && (await skinState()).label === 'SKIN: GRU');
  await page.click('#choose-skin');
  await page.keyboard.press('Tab');
  check('Tab exits the panel to PLAY and dismisses it without a selection', !(await skinState()).open && await page.locator('[data-game=fisherman] .btn-play').evaluate(el => el === document.activeElement) && (await skinState()).selected === 'gru');
  await page.reload();
  await hubReady(page);
  selected = await skinState();
  check('reload restores the Fisherman label, image, selection and launch URL', selected.label === 'SKIN: GRU' && selected.selected === 'gru' && selected.image.endsWith('card-fisherman-gru.jpg') && await page.locator('[data-game=fisherman] .btn-play').getAttribute('href') === 'fisherman.html?skin=gru');
  const revisit = await ctx.newPage();
  await revisit.goto(BASE);
  await hubReady(revisit);
  check('a separate menu visit remembers Gru', await revisit.locator('#skin-current').textContent() === 'SKIN: GRU');
  await revisit.close();
  check('switching skin still loads no 3D, audio or game scene on the menu', await page.evaluate(() => !document.querySelector('canvas') && !performance.getEntriesByType('resource').some(r => /three\.(module|core)\.js|meshes\/|audio\/|src\/game\.js/.test(r.name))));
  check('Driver and Fish retain their original links and have no selectors', await page.evaluate(() => ['driver', 'fish'].every(id => {
    const card = document.querySelector(`[data-game=${id}]`);
    return !card.querySelector('.fisherman-skin') && card.querySelector('.btn-play').getAttribute('href') === `${id}.html`;
  })));

  await Promise.all([page.waitForURL(/fisherman\.html\?skin=gru$/), page.click('[data-game=fisherman] .btn-play')]);
  await page.waitForFunction(() => window.__ready && window.__game?.mode === 'title', null, { timeout: 90000 });
  await page.click('#btn-go');
  check('Fisherman PLAY launches Gru with the mounted ray and shrinkable bucket', await page.evaluate(() => __game.skin === 'gru' && __game.mode === 'play' && __game.gru.state === 'mounted' && !!__game.bucket));
  await page.click('#btn-menu');
  await page.click('#menu [data-act=games]');
  await hubReady(page);
  check('returning from Gru restores its selected card', (await skinState()).label === 'SKIN: GRU' && !(await skinState()).open);

  // ---- Driver POV, back, Fisherman POV, back, Driver POV again
  await Promise.all([page.waitForURL(/driver\.html$/), page.click('.card[data-game=driver] .btn-play')]);
  await page.waitForFunction(() => window.__game?.mode === 'play', null, { timeout: 90000 });
  check('Driver POV ignores the saved Gru skin and starts its original game', await page.evaluate(() => document.querySelectorAll('canvas').length === 1 && window.__game.mode === 'play' && !__game.gru && !__game.truck.gru && !performance.getEntriesByType('resource').some(r => /gru\.(bin|json)|gru-vehicle/.test(r.name))));
  await page.waitForFunction(() => window.__game.state === 'choose', null, { timeout: 15000 });
  await page.click('#btn-pause');
  await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('exitAudio', window.__game.audio.ctx.state)));
  await Promise.all([page.waitForURL((u) => u.pathname.endsWith('/')), page.click('#btn-games')]);
  await hubReady(page);
  check('Pause > BACK TO GAMES returns to the menu with the sound stopped', (await page.evaluate(() => sessionStorage.getItem('exitAudio'))) === 'suspended' && (await page.locator('.card').count()) === 5);

  await choose('original');
  check('switching back restores Original preview and its saved preference', (await skinState()).image.endsWith('card-fisherman.jpg') && (await skinState()).stored === 'original' && !(await skinState()).open);
  await page.reload();
  await hubReady(page);
  check('Original also persists after reload', (await skinState()).label === 'SKIN: ORIGINAL');
  await Promise.all([page.waitForURL(/fisherman\.html\?skin=original$/), page.click('.card[data-game=fisherman] .btn-play')]);
  await page.waitForFunction(() => window.__ready === true && window.__game?.mode === 'title', null, { timeout: 90000 });
  await page.click('#btn-go');
  await page.waitForTimeout(600);
  const fish = await page.evaluate(() => ({ mode: window.__game.mode, canvas: document.querySelectorAll('canvas').length, driver: !!window.__game.conv, skin: __game.skin, gru: !!__game.gru }));
  check('PLAY on Fisherman POV opens the original fisherman game (GO FISHING works)', fish.mode === 'play' && fish.canvas === 1 && !fish.driver && fish.skin === 'original' && !fish.gru, JSON.stringify(fish));
  await page.click('#btn-pause');
  await page.waitForTimeout(100);
  const frozen = await page.evaluate(() => ({ audio:__game.audio.ctx.currentTime, line:__game.dialogue.current?.id, sim:__game.truck.sim.time }));
  await page.waitForTimeout(400);
  check('Fisherman pause freezes speech and simulation', await page.evaluate(f => __game.paused && __game.audio.ctx.state === 'suspended' && Math.abs(__game.audio.ctx.currentTime-f.audio)<0.04 && __game.dialogue.current?.id === f.line && __game.truck.sim.time === f.sim, frozen));
  await page.click('#btn-resume');
  await page.waitForTimeout(150);
  check('Fisherman resumes the original line', await page.evaluate(f => !__game.paused && __game.audio.running && __game.dialogue.current?.id === f.line, frozen));
  await page.click('#btn-reset');
  await page.waitForTimeout(150);
  check('Fisherman restart begins one fresh introduction', await page.evaluate(() => __game.dialogue.current?.id === 'g_who' && __game.dialogue.queue.length === 0));
  await page.click('#btn-menu');
  await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('exitAudio2', window.__game.audio.ctx.state)));
  await Promise.all([page.waitForURL((u) => u.pathname.endsWith('/')), page.click('#menu [data-act=games]')]);
  await hubReady(page);
  check('Fisherman Modes > Back to games returns to the menu with the sound stopped', (await page.evaluate(() => sessionStorage.getItem('exitAudio2'))) === 'suspended');

  await choose('gru');
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
  check('end screen > CHOOSE ANOTHER POV returns to the menu', (await page.locator('.card').count()) === 5);
  await page.click('.card[data-game=fish] .btn-play');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  check('Fish POV needs no second PLAY after loading', await page.evaluate(() => __game.mode === 'play' && !document.querySelector('#btn-go')));
  await page.waitForFunction(() => window.__game.conv.clip?.id === 'd_who');
  check('Fish POV ignores saved Gru and plays its original scene and audio', await page.evaluate(() => __game.audio.running && __game.mode === 'play' && !__game.gru && !__game.truck.gru && !performance.getEntriesByType('resource').some(r => /gru\.(bin|json)|gru-vehicle/.test(r.name))));
  await page.click('#btn-pause');
  await page.click('#btn-games');
  await hubReady(page);
  check('Fish POV returns to the five-mode menu', (await page.locator('.card .btn-play').count()) === 5);
  check('playing Driver and Fish preserves the Fisherman preference', (await skinState()).stored === 'gru' && (await skinState()).label === 'SKIN: GRU');
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
  check('unavailable Fisherman does not show a skin picker', await page.locator('.fisherman-skin').count() === 0);
  await ctx.close();
}

// Previous unversioned selections reset to Original; new explicit selections still persist.
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE);
  await hubReady(page);
  await page.evaluate(() => localStorage.setItem('state-property:fisherman-skin', 'gru'));
  await page.reload();
  await hubReady(page);
  check('a legacy saved Gru choice now defaults to Original', await page.locator('#skin-current').textContent() === 'SKIN: ORIGINAL' && await page.locator('[data-game=fisherman] .btn-play').getAttribute('href') === 'fisherman.html?skin=original');
  await page.click('#choose-skin');
  await page.click('[data-skin=gru]');
  await page.reload();
  await hubReady(page);
  check('a new manual Gru choice persists after the default reset', await page.locator('#skin-current').textContent() === 'SKIN: GRU');
  await ctx.close();
}

// A selected skin still launches correctly without access to persistent browser storage.
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
  });
  await page.goto(BASE);
  await hubReady(page);
  for (const skin of ['gru', 'original']) {
    await page.click('#choose-skin');
    await page.click(`[data-skin=${skin}]`);
    check(`blocked storage: ${skin} selection stays on the menu with an explicit launch URL`, await page.locator('#skin-current').textContent() === `SKIN: ${skin.toUpperCase()}` && await page.locator('[data-game=fisherman] .btn-play').getAttribute('href') === `fisherman.html?skin=${skin}` && page.url() === BASE);
  }
  await ctx.close();
}

// =================================================================== layouts
for (const [w, h, label] of [[320, 568, 'phone'], [360, 800, 'phone'], [390, 844, 'phone'], [430, 932, 'phone'], [844, 390, 'landscape'], [667, 375, 'landscape']]) {
  const { ctx, page } = await newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE);
  await hubReady(page);
  await page.evaluate(() => document.fonts.ready);
  const L = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.card')].map(r);
    const plays = [...document.querySelectorAll('.card .btn-play')].map(r);
    const social = [...document.querySelectorAll('.social-btn')].map(r);
    return {
      fits: document.scrollingElement.scrollHeight <= innerHeight + 1,
      noHorizontalScroll: document.scrollingElement.scrollWidth <= innerWidth + 1,
      stacked: cards.every((c, i) => i === 0 || c.top >= cards[i - 1].bottom), side: cards.every((c) => Math.abs(c.top - cards[0].top) < 2),
      nonOverlapping: cards.every((a,i)=>cards.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)),
      railScrolls: document.querySelector('.cards').scrollWidth > document.querySelector('.cards').clientWidth,
      plays: plays.every((p) => p.height >= 48), social: social.every((s) => s.height >= 44 && s.width >= 44),
      bottom: Math.round(social[0].bottom), h: innerHeight,
    };
  });
  const arrangement = L.side && L.nonOverlapping && L.railScrolls;
  check(`${w}x${h}: cards scroll inside their rail, no page overflow, PLAY >= 48 px, links >= 44 px`,
    arrangement && L.noHorizontalScroll && L.plays && L.social, `social block ends at ${L.bottom}/${L.h}; vertical scrolling ${!L.fits}`);
  await page.screenshot({ path: `${out}/hub-${w}x${h}.png` });
  await page.tap('#choose-skin');
  const panel = await page.evaluate(() => {
    const panel = document.querySelector('#skin-options').getBoundingClientRect();
    const controls = [...document.querySelectorAll('.fisherman-skin button')].map(el => el.getBoundingClientRect());
    return { fits: panel.left >= 0 && panel.right <= innerWidth && document.scrollingElement.scrollWidth <= innerWidth + 1,
      targets: controls.every(r => r.width >= 44 && r.height >= 44),
      textFits: [...document.querySelectorAll('.fisherman-skin button')].every(el => el.scrollWidth <= el.clientWidth + 1) };
  });
  check(`${w}x${h}: open skin panel fits, text does not overflow, touch targets >= 44 px`, panel.fits && panel.targets && panel.textFits, JSON.stringify(panel));
  await page.screenshot({ path: `${out}/hub-picker-${w}x${h}.png` });
  await page.tap('[data-skin=gru]');
  check(`${w}x${h}: touch selects Gru and dismisses without launching`, await page.locator('#skin-current').textContent() === 'SKIN: GRU' && await page.locator('#skin-options').isHidden() && page.url() === BASE);
  await page.locator('[data-game=fisherman] img').evaluate(img => img.decode());
  await page.screenshot({ path: `${out}/hub-gru-${w}x${h}.png` });
  await page.tap('#choose-skin');
  await page.tap('.hub-title');
  check(`${w}x${h}: outside tap dismisses without changing selection`, await page.locator('#skin-options').isHidden() && await page.locator('#skin-current').textContent() === 'SKIN: GRU');
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed  (${BASE})`);
fs.writeFileSync(`${out}/hub-report.json`, JSON.stringify({ passed: pass, total: results.length, errors, base: BASE }, null, 2));
process.exit(pass === results.length ? 0 : 1);
