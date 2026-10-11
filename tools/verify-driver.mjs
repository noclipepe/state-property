// Verifies the public driver POV game. Run against the dev page or the production build:
//   node tools/verify-driver.mjs [outDir] [url]
//     url default http://localhost:8080/driver.html  (npm start)
//     production: node tools/serve.mjs 8090 dist  ->  http://localhost:8090/
// Desktop: loading screen, brand font + background, the canonical route with the original clips in
// order (never overlapping), every alternative answer, the alternative ending, double-click
// protection, free look in every phase (none from clicking a choice), the hook and the drag, the end
// screen, analytics events, creator links, sharing, pause / page hidden / resume, restart mid-line,
// the blah-blah voice on invented lines (audible, mouth moves) and the finger gesture + reaction,
// and mid-pull, CHOOSE ANOTHER POV. Phone emulation (touch, 390x844): tap to
// play and answer, touch drag to look, 48 px touch targets, rotation keeping the game's progress.
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] || 'check-out';
const URL_ = process.argv[3] || 'http://localhost:8080/driver.html';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const errors = [];

async function open(contextOpts) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // links open in new tabs; keep the test page in charge (tracking still runs: it's on the element)
  await page.addInitScript(() => {
    document.addEventListener('click', (e) => { if (e.target.closest?.('a[target=_blank]')) e.preventDefault(); }, true);
  });
  await page.goto(URL_);
  return { ctx, page };
}

// voice log: every clip on the voice bus, to detect repeats and overlaps
const instrument = (page) => page.evaluate(() => {
  const g = window.__game, au = g.audio;
  window.__voice = [];
  // loudness on the voice bus, sampled every frame (max since the last read)
  const an = au.ctx.createAnalyser(); an.fftSize = 1024; au.voice.connect(an);
  const buf = new Float32Array(an.fftSize);
  window.__vmax = 0; window.__mouth = 0;
  const tick = () => {
    an.getFloatTimeDomainData(buf);
    let s = 0; for (const v of buf) s += v * v;
    window.__vmax = Math.max(window.__vmax, Math.sqrt(s / buf.length));
    if (g.conv.speaker === 'fisherman') window.__mouth = Math.max(window.__mouth, g.conv.speakerEnv);
    requestAnimationFrame(tick);
  };
  tick();
  const orig = au.playBuffer.bind(au);
  au.playBuffer = (buf, bus, gain) => {
    const src = orig(buf, bus, gain);
    if (bus === au.voice) {
      const id = Object.keys(g.clips).find((k) => g.clips[k].buffer === buf);
      const rec = { id, t0: performance.now() / 1000, t1: null };
      window.__voice.push(rec);
      src.addEventListener('ended', () => { rec.t1 = rec.t1 ?? performance.now() / 1000; });
      const stop = src.stop.bind(src);
      src.stop = (w) => { rec.t1 = rec.t1 ?? performance.now() / 1000; stop(w); };
    }
    return src;
  };
});
const overlaps = (log) => { const s = [...log].sort((a, b) => a.t0 - b.t0); for (let i = 1; i < s.length; i++) if (s[i - 1].t1 === null || s[i].t0 < s[i - 1].t1 - 0.02) return `${s[i - 1].id} & ${s[i].id}`; return null; };
const st = (page) => page.evaluate(() => {
  const g = window.__game, s = g.truck.sim, cam = g.camera;
  const head = g.fisher.headWorld.project(cam);
  const vis = (id) => !document.getElementById(id).hidden;
  return {
    mode: g.mode, state: g.state, step: g.conv.step, hist: g.conv.history.length, hook: g.hook.phase, paused: g.paused,
    x: s.pos.x, z: s.pos.y, yaw: s.yaw, stuck: s.stuck, viewYaw: g.view.yaw, userYaw: g.view.user.yaw,
    choices: vis('choices'), labels: [...document.querySelectorAll('#choices .label')].map((e) => e.textContent),
    sub: document.getElementById('subtitle').classList.contains('show') ? document.getElementById('subtitle').textContent : '',
    subYou: document.getElementById('subtitle').classList.contains('you'),
    subTextOnly: document.getElementById('subtitle').classList.contains('textonly'),
    end: vis('end'), endTitle: document.getElementById('end-title').textContent, pause: vis('pause'), pauseNote: vis('pause-note'),
    fisherInView: Math.abs(head.x) < 1 && Math.abs(head.y) < 1 && head.z < 1, ctx: g.audio.ctx.state,
    events: (window.__events || []).map((e) => e.name), aspect: cam.aspect,
  };
});
const voice = (page) => page.evaluate(() => window.__voice.map((r) => ({ ...r })));
const waitFor = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
const dragMouse = async (page, dx, dy) => {
  const box = await page.locator('#view').boundingBox();
  const x = box.x + box.width * 0.5, y = box.y + box.height * 0.3;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
};
const choice = (page, i) => page.locator('#choices button').nth(i);
const menuReady = (page, k) => waitFor(page, (k) => window.__game.state === 'choose' && window.__game.conv.step === k, k, 15000);

// =================================================================== desktop
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
  const startVisible = await page.locator('#start').isVisible();
  const tStart = Date.now();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const brand = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      font: document.fonts.check('20px "NewRodin Pro"') && [...document.fonts].some((f) => f.family.includes('NewRodin') && f.status === 'loaded'),
      fontReq: performance.getEntriesByType('resource').some((r) => r.name.endsWith('newrodin-db.woff2')),
      bg: getComputedStyle(document.getElementById('start')).backgroundImage,
      family: getComputedStyle(document.querySelector('#start .title')).fontFamily,
      events: (window.__events || []).length,
      links: Object.fromEntries([...document.querySelectorAll('a[data-link]')].map((a) => [a.dataset.link, a.href])),
    };
  });
  check('the branded loading screen shows before the game is ready', startVisible);
  check('brand font file loads and is used', brand.font && brand.fontReq && /NewRodin/.test(brand.family), brand.family.slice(0, 40));
  check('loading screen uses the supplied background', /assets\/brand\/background/.test(brand.bg));
  check('creator links (Instagram, X) come from the config', brand.links.instagram === 'https://www.instagram.com/noclipepe/' && brand.links.x === 'https://x.com/noclipepe');
  await instrument(page);

  // ---------------------------------------------------- 1. the game starts by itself once loaded
  // Capture the arrival from a fresh replay, before screenshot readback can consume it.
  await page.evaluate(() => window.__game.reset());
  let a = await st(page);
  await page.waitForTimeout(250);
  let b = await st(page);
  check('loaded: the game starts, the truck brakes into place', a.mode === 'play' && Math.hypot(b.x - a.x, b.z - a.z) > 0.05 && a.events.includes('play_started') && !(await page.locator('#start').isVisible()));
  await page.screenshot({ path: `${out}/desktop-start.png` });
  await dragMouse(page, -60, 0);
  let s = await st(page);
  check('look works during the opening', Math.abs(s.userYaw) > 0.1);
  await menuReady(page, 0);
  s = await st(page);
  check('menu 1 with the fisherman in view', s.choices && s.labels.every(Boolean) && s.fisherInView, s.labels.join(' | '));

  // ---------------------------------------------------- 2. every alternative answer responds (text only) and returns
  const y0 = s.viewYaw;
  await page.evaluate(() => { window.__vmax = 0; });
  await choice(page, 1).click();
  await page.waitForTimeout(500);
  s = await st(page);
  const v1 = await page.evaluate(() => ({ rms: window.__vmax, who: window.__game.conv.babble?.who }));
  check('alternative: your line with the blah-blah voice, no original clip', s.state === 'altDriver' && s.subTextOnly && s.subYou && (await voice(page)).length === 0 && v1.who === 'driver' && v1.rms > 0.01, `${s.sub} rms ${v1.rms.toFixed(3)}`);
  check('clicking a choice does not move the camera', Math.abs(s.viewYaw - y0) < 1e-6);
  await waitFor(page, () => window.__game.state === 'altFisherman', null, 4000);
  await page.evaluate(() => { window.__vmax = 0; window.__mouth = 0; });
  await page.waitForTimeout(700);
  s = await st(page);
  const v2 = await page.evaluate(() => ({ rms: window.__vmax, mouth: window.__mouth, who: window.__game.conv.babble?.who }));
  check('alternative: the fisherman answers, mumbling, his mouth moving', s.subTextOnly && !s.subYou && s.sub.length > 12 && v2.who === 'fisherman' && v2.rms > 0.01 && v2.mouth > 0.3, `${s.sub} rms ${v2.rms.toFixed(3)} mouth ${v2.mouth.toFixed(2)}`);
  await menuReady(page, 0);
  await choice(page, 2).click();
  await menuReady(page, 0);
  check('both alternatives in menu 1 return to it, no original clip used', (await voice(page)).length === 0);

  // ---------------------------------------------------- 2b. the finger while he waits: he reacts and grumbles
  await page.evaluate(() => { window.__mouth = 0; });
  await page.keyboard.press('f');
  await page.waitForTimeout(700);
  const f1 = await page.evaluate(() => { const g = window.__game; return { arm: g.driverAnim.arms.L.target, hand: g.driverAnim.hands.L.preset, who: g.conv.babble?.who, ev: window.__events.map((e) => e.name) }; });
  check('F / 🖕: your hand goes up with the middle finger, he grumbles', f1.arm === 'L_flip' && f1.hand === 'middle' && f1.who === 'fisherman' && f1.ev.includes('finger_shown'), JSON.stringify(f1).slice(0, 90));
  await page.click('#btn-finger');
  check('a second press while the finger is up is ignored', (await page.evaluate(() => window.__events.filter((e) => e.name === 'finger_shown').length)) === 1);
  await page.waitForTimeout(2200);
  const f2 = await page.evaluate(() => ({ arm: window.__game.driverAnim.arms.L.target, finger: window.__game.finger, state: window.__game.state }));
  check('the hand goes back to the sill, the menu is still waiting', f2.arm === 'L_sill' && !f2.finger && f2.state === 'choose');

  // ---------------------------------------------------- 3. canonical exchange 1 (double click)
  await choice(page, 0).dblclick({ force: true });
  await choice(page, 0).click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  s = await st(page);
  let log = await voice(page);
  check('double click: one clip, one step', log.length === 1 && log[0].id === 'd_who' && s.hist === 3 && s.state === 'driver', log.map((r) => r.id).join(','));
  check('your line subtitled as you', s.subYou && /Who told you/.test(s.sub), s.sub);
  await dragMouse(page, 80, 20);
  s = await st(page);
  check('look works while a line plays', Math.abs(s.viewYaw - y0) > 0.1);
  await page.click('#btn-finger');
  await page.waitForTimeout(600);
  const f3 = await page.evaluate(() => ({ babble: window.__game.conv.babble, clip: window.__game.conv.clip?.id }));
  check('the finger during an original line: nobody talks over it', !f3.babble && f3.clip === 'd_who' && (await voice(page)).length === 1);
  await waitFor(page, () => window.__game.state === 'fisherman', null, 5000);
  await page.waitForTimeout(400);
  s = await st(page);
  check('his reply subtitled as the fisherman', !s.subYou && /state property/i.test(s.sub), s.sub);

  // ---------------------------------------------------- 4. pause, page hidden, resume (mid-dialogue)
  await menuReady(page, 1);
  await page.keyboard.press('2'); // STATE?!
  await page.waitForTimeout(1200);
  await page.click('#btn-pause');
  await page.waitForTimeout(250);
  const p1 = await page.evaluate(() => ({ t: window.__game.audio.ctx.currentTime, state: window.__game.audio.ctx.state }));
  s = await st(page);
  check('pause opens the menu and stops the sound', s.paused && s.pause && p1.state === 'suspended');
  await page.waitForTimeout(700);
  const p2 = await page.evaluate(() => window.__game.audio.ctx.currentTime);
  check('while paused, dialogue time stands still', Math.abs(p2 - p1.t) < 0.05, `${(p2 - p1.t).toFixed(3)} s`);
  await page.screenshot({ path: `${out}/desktop-pause.png` });
  await page.click('#btn-resume');
  await page.waitForTimeout(300);
  s = await st(page);
  check('resume continues the same line', !s.paused && !s.pause && s.ctx === 'running' && ['driver', 'fisherman'].includes(s.state));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  s = await st(page);
  check('leaving the page pauses, with a "you were away" note', s.paused && s.pause && s.pauseNote);
  await page.click('#btn-resume');
  await menuReady(page, 2);
  s = await st(page);
  check('the STATE?! exchange completes after pause/resume', s.step === 2 && s.labels[2] === "What's your name?");

  // ---------------------------------------------------- 5. menu 3: the other alternative returns; then the canonical line
  await choice(page, 1).click();
  await menuReady(page, 2);
  await choice(page, 2).click();
  await waitFor(page, () => window.__game.state === 'hook', null, 9000);
  log = await voice(page);
  check('original clips in order, once each, no overlap', log.map((r) => r.id).join(',') === 'd_who,d_state,d_name' && !overlaps(log), log.map((r) => r.id).join(','));

  // ---------------------------------------------------- 6. hook, drag, end screen
  await waitFor(page, () => window.__game.hook.phase === 'flight', null, 4000);
  const home = await st(page);
  await waitFor(page, () => window.__game.hook.phase === 'drag', null, 8000);
  await page.waitForTimeout(1500);
  s = await st(page);
  check('the hook catches and the whole truck moves', Math.hypot(s.x - home.x, s.z - home.z) > 1.0 && !s.stuck);
  check('he stays in view during the drag', s.fisherInView || Math.abs(s.userYaw) > 0.05);
  const yv = s.viewYaw;
  await dragMouse(page, -120, 0);
  check('look works during the drag', Math.abs((await st(page)).viewYaw - yv) > 0.2);
  await waitFor(page, () => !document.getElementById('end').hidden, null, 15000);
  s = await st(page);
  const total = (Date.now() - tStart) / 1000;
  const endUi = await page.evaluate(() => ['btn-again', 'btn-other'].every((id) => document.getElementById(id).offsetHeight >= 44) && [...document.querySelectorAll('#end .social-btn')].map((a) => a.dataset.link).join() === 'instagram,x');
  check('end screen: "Reeled in." with PLAY AGAIN, CHOOSE ANOTHER POV, Instagram and X', s.end && endUi && s.endTitle === 'Reeled in.' && s.events.filter((e) => e === 'game_completed').length === 1, `${total.toFixed(1)} s incl. detours and pauses`);
  check('no extra voice lines after the conversation', (await voice(page)).length === 3);
  await page.screenshot({ path: `${out}/desktop-end.png` });

  // ---------------------------------------------------- 7. social buttons (tracking; navigation is suppressed by the test)
  await page.click('#end a[data-link=instagram]');
  await page.click('#end a[data-link=x]');
  const sh = await page.evaluate(() => ({ events: window.__events.map((e) => e.name), paused: window.__game.paused }));
  check('Instagram + X clicks are tracked; the finished game is not paused', sh.events.includes('instagram_clicked') && sh.events.includes('x_clicked') && !sh.paused);

  // ---------------------------------------------------- 8. play again -> alternative ending
  await page.click('#btn-again');
  s = await st(page);
  check('PLAY AGAIN restarts cleanly', s.state === 'opening' && !s.end && s.hist === 0 && s.events.includes('replay_clicked'));
  await menuReady(page, 0); await choice(page, 0).click();
  await menuReady(page, 1); await choice(page, 1).click();
  await menuReady(page, 2); await choice(page, 0).click(); // "Alright, please pack up and leave."
  await waitFor(page, () => !document.getElementById('end').hidden, null, 12000);
  s = await st(page);
  check('alternative ending: "Peaceful ending." end screen', s.end && s.endTitle === 'Peaceful ending.' && s.hook === 'idle');
  await page.screenshot({ path: `${out}/desktop-end-alt.png` });

  // ---------------------------------------------------- 9. restart mid-line and mid-pull
  await page.keyboard.press('r');
  await menuReady(page, 0);
  await choice(page, 0).click();
  await page.waitForTimeout(1200);
  const before = (await voice(page)).length;
  await page.click('#btn-restart');
  await page.waitForTimeout(100);
  s = await st(page);
  log = await voice(page);
  check('restart mid-line stops the clip and clears the conversation', log[before - 1].t1 !== null && s.state === 'opening' && s.hist === 0 && !s.choices && !s.sub);
  await menuReady(page, 0);
  await page.evaluate(() => window.__game.debugHook());
  await waitFor(page, () => window.__game.hook.phase === 'drag', null, 9000);
  await page.waitForTimeout(800);
  await page.keyboard.press('r');
  await page.waitForTimeout(60);
  const restored = await page.evaluate(() => {
    const g = window.__game, sim = g.truck.sim;
    return {
      hook: g.hook.phase === 'idle' && g.hook.force === 0 && sim.force.lengthSq() === 0,
      fisher: g.fisher.pos.distanceTo(g.fisher.home) < 1e-6 && g.fisher.walkSpeed === 0 && !g.fisher.reeling,
      view: g.view.user.yaw === 0 && g.view.user.pitch === 0,
      prop: g.dashProp.p.x === g.dashProp.rest.x && g.dashProp.p.y === g.dashProp.rest.z,
      flags: Object.keys(g.conv.played).length === 0 && !g.ending && !g.leaving,
      line: g.hook.line.length <= 0.35,
      input: !g.input.drag && g.input.keys.size === 0,
    };
  });
  check('restart mid-pull resets truck, fisherman, hook, line, view, prop, input, flags', Object.values(restored).every(Boolean), JSON.stringify(restored));
  await page.waitForTimeout(1300);
  s = await st(page);
  check('the truck parks at its home again', s.stuck && Math.abs(s.yaw - home.yaw) < 1e-3 && Math.hypot(s.x - home.x, s.z - home.z) < 0.02);
  const loops = await page.evaluate(() => new Promise((res) => { let n = 0; const orig = window.__game.renderer.render.bind(window.__game.renderer); window.__game.renderer.render = (...a) => { n++; orig(...a); }; requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res(n)))); }));
  check('one render loop after several restarts', loops <= 3, `${loops} renders in 3 frames`);

  // ---------------------------------------------------- 10. a social link mid-game pauses; BACK TO GAMES leaves cleanly
  await menuReady(page, 0);
  await page.click('#btn-pause');
  await page.click('#btn-resume');
  await page.evaluate(() => window.__game.pauseForLink());
  s = await st(page);
  check('a creator link opened mid-game pauses it (resume afterwards)', s.paused && s.pause);
  await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('audioAtExit', window.__game.audio.ctx.state)));
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('driver.html')), page.click('#btn-games')]);
  await page.waitForFunction(() => window.__hubReady === true, null, { timeout: 20000 });
  const exit = await page.evaluate(() => ({ audio: sessionStorage.getItem('audioAtExit'), canvas: document.querySelectorAll('canvas').length, cards: document.querySelectorAll('.card').length }));
  check('BACK TO GAMES: sound stopped, series menu loaded, no 3D left running', exit.audio === 'suspended' && exit.canvas === 0 && exit.cards >= 2, JSON.stringify(exit));
  await ctx.close();
}

// =================================================================== phone (touch emulation)
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await menuReady(page, 0);
  let s = await st(page);
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#choices button, .hud-btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check('touch targets are at least 48 px', sizes.every(([bw, bh]) => bw >= 48 && bh >= 48), JSON.stringify(sizes));
  const gaps = await page.evaluate(() => { const r = [...document.querySelectorAll('#choices button')].map((b) => b.getBoundingClientRect()); return [r[1].top - r[0].bottom, r[2].top - r[1].bottom]; });
  check('answers are separated', gaps.every((g) => g >= 8), gaps.join(', '));
  const face = await page.evaluate(() => { const g = window.__game, p = g.fisher.headWorld.project(g.camera); const top = document.getElementById('choices').getBoundingClientRect().top; return { y: (-p.y * 0.5 + 0.5) * innerHeight, top }; });
  check("the answers don't cover his face", face.y < face.top - 40, `face ${face.y.toFixed(0)} px, answers from ${face.top.toFixed(0)} px`);
  await page.screenshot({ path: `${out}/phone-390-menu.png` });
  // touch drag on the scene turns the view
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const y0 = s.viewYaw;
  await touch('touchStart', 200, 250); for (let i = 1; i <= 6; i++) await touch('touchMove', 200 - i * 15, 255); await touch('touchEnd');
  s = await st(page);
  check('touch drag looks around', Math.abs(s.viewYaw - y0) > 0.1);
  const y1 = s.viewYaw;
  await page.tap('#choices button >> nth=0');
  await page.waitForTimeout(200);
  s = await st(page);
  check('tapping an answer says it, without turning the camera', s.state === 'driver' && Math.abs(s.viewYaw - y1) < 1e-6);
  // rotate mid-line: same line keeps playing, no restart
  await page.waitForTimeout(800);
  const clipBefore = await page.evaluate(() => window.__game.conv.clip?.id);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  s = await st(page);
  const clipAfter = await page.evaluate(() => window.__game.conv.clip?.id);
  check('rotating to landscape keeps the game going', clipBefore === 'd_who' && clipAfter === 'd_who' && s.hist === 1 && s.aspect > 2, `aspect ${s.aspect.toFixed(2)}`);
  await menuReady(page, 1);
  await page.screenshot({ path: `${out}/phone-landscape-menu.png` });
  await page.evaluate(() => { window.__game.view.user.yaw = 0; window.__game.view.user.pitch = 0; }); // the default view, not the test's drag
  await page.waitForTimeout(100);
  const land = await page.evaluate(() => { const g = window.__game, p = g.fisher.headWorld.project(g.camera); const c = document.getElementById('choices').getBoundingClientRect(); return { x: (p.x * 0.5 + 0.5) * innerWidth, left: c.left }; });
  check('landscape: answers on the right, his face clear of them', land.x < land.left - 20, `face x ${land.x.toFixed(0)}, answers from ${land.left.toFixed(0)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  s = await st(page);
  check('rotating back keeps the menu', s.state === 'choose' && s.step === 1 && s.aspect < 1);
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed  (${URL_})`);
process.exit(pass === results.length ? 0 : 1);
