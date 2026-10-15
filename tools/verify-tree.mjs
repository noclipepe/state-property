// Witness POV checks in a real browser (WebGL, real input events):
//   opening framing, mouse and touch binocular controls, independent suspicion meters, hiding and
//   recovery, detection by either man (exactly once), the whole fall into the pond, the ending,
//   and a full reset with "Try again".
//   node tools/verify-tree.mjs [baseUrl] [outDir]      (baseUrl default http://localhost:8095/)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:8095/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'check-out/tree-verify';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0, passed = 0;
const check = (ok, name, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); ok ? passed++ : failed++; };
const errors = [];

async function open(viewport, touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + 'tree.html');
  await page.waitForFunction(() => window.__ready, null, { polling: 100, timeout: 90000 });
  await page.click('#btn-enter');
  await page.waitForFunction(() => __game.state === 'play', null, { polling: 100 });
  return { context, page, cdp: touch ? await context.newCDPSession(page) : null };
}
const state = (page) => page.evaluate(() => {
  const g = __game, w = g.watchers;
  return { state: g.state, raise: g.raise, fov: g.camera.fov, base: g.baseFov, aim: { ...g.aimAngles }, f: w.fisherman.value, fl: w.fisherman.level, d: w.driver.value, dl: w.driver.level, time: g.time };
});
// aim the binoculars (angles only; the hold itself is always a real input event)
const aimAt = (page, who) => page.evaluate((who) => {
  const g = __game, head = who === 'fisherman' ? g.fisher.headWorld : g.driver.bones.head.getWorldPosition(g.camera.position.clone());
  head.y -= 0.15; Object.assign(g.aimAngles, g.anglesTo(head));
}, who);
const aimAway = (page) => page.evaluate(() => { const g = __game; g.aimAngles.yaw = g.aimHome.yaw + 0.7; g.aimAngles.pitch = g.aimHome.pitch + 0.3; });
const wait = (page, ms) => page.waitForTimeout(ms);

// ------------------------------------------------------------------ desktop
{
  const W = 1280, H = 720, { context, page } = await open({ width: W, height: H });
  // the original argument is audible: the clip is playing and there is signal on the voice bus
  await page.evaluate(() => { const a = __game.audio; window.__voiceMeter = a.ctx.createAnalyser(); a.voice.connect(__voiceMeter); });
  await page.waitForFunction(() => __game.conv.state === 'playing' && __game.conv.elapsed > 0.6, null, { polling: 100, timeout: 8000 }).catch(() => {});
  let voice = 0;
  for (let i = 0; i < 20 && voice < 0.01; i++) {
    voice = Math.max(voice, await page.evaluate(() => { const d = new Float32Array(__voiceMeter.fftSize); __voiceMeter.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length); }));
    await wait(page, 100);
  }
  check(voice > 0.01, 'the argument plays (voice signal after START)', `rms ${voice.toFixed(3)}`);
  const opening = await page.evaluate(() => {
    const g = __game, pts = [g.fisher.headWorld, g.driver.bones.head.getWorldPosition(g.camera.position.clone())];
    // a ray from the eye to each head must not hit the perch (leaves, branches, the player's body)
    const hits = pts.map((p) => g.occluders(p));
    return { inside: pts.every((p) => g.project(p).inside), hits, legs: g.perch.legParts.every((l) => g.project(l.leg.localToWorld(l.ankle.clone())).inside), binoculars: g.project(g.perch.binoculars.position).inside };
  });
  await page.screenshot({ path: `${OUT}/desktop-opening.png` });
  check(opening.inside, 'opening: both men in view'); check(opening.hits.every((n) => n === 0), 'opening: nothing of the tree covers either man', JSON.stringify(opening.hits));
  check(opening.legs && opening.binoculars, 'opening: legs on the branch and the lowered binoculars are visible');

  // drag straight away: look around with the binoculars down
  const look0 = (await state(page)).aim;
  await page.mouse.move(W / 2, H / 2); await page.mouse.down(); await page.mouse.move(W / 2 + 200, H / 2, { steps: 8 }); await wait(page, 300);
  let s = await state(page);
  const lean = await page.evaluate(() => __game.body.x);
  check(s.raise < 0.05 && s.aim.yaw < look0.yaw - 0.15, 'dragging without holding still looks around (binoculars stay down)', `yaw ${look0.yaw.toFixed(2)} -> ${s.aim.yaw.toFixed(2)}`);
  check(lean > 0.02, 'looking right leans the body to the right', `lean ${lean.toFixed(3)} m`);
  await page.mouse.up(); await page.evaluate(() => Object.assign(__game.aimAngles, __game.aimHome));
  // press and hold still: binoculars
  await page.mouse.move(W / 2, H / 2); await page.mouse.down();
  await page.waitForFunction(() => __game.raise > 0.95, null, { polling: 50, timeout: 3000 }).catch(() => {});
  s = await state(page);
  check(s.raise > 0.95 && s.fov < s.base / 3, 'mouse: pressing and holding still raises the binoculars (zoomed)', `raise ${s.raise.toFixed(2)} fov ${s.fov.toFixed(1)}`);
  const before = s.aim; await page.mouse.move(W / 2 + 80, H / 2 + 30, { steps: 6 }); s = await state(page);
  check(s.aim.yaw < before.yaw - 0.01 && s.aim.pitch < before.pitch - 0.005, 'mouse: dragging right/down aims right/down');
  await page.mouse.move(W / 2 + 40000, H / 2, { steps: 4 }); s = await state(page);
  check(Math.abs(s.aim.yaw - (await page.evaluate(() => __game.aimHome.yaw - 0.95))) < 1e-6, 'aim is limited to a seated range');
  await page.mouse.up(); await page.waitForFunction(() => __game.raise < 0.02, null, { polling: 50, timeout: 3000 }).catch(() => {}); s = await state(page);
  check(s.raise < 0.02 && Math.abs(s.fov - s.base) < 0.5, 'mouse: releasing lowers them');
  await page.mouse.move(W / 2, H / 2); await page.mouse.down({ button: 'right' }); await page.waitForFunction(() => __game.raise > 0.95, null, { polling: 50, timeout: 3000 }).catch(() => {}); s = await state(page);
  await page.mouse.up({ button: 'right' });
  check(s.raise > 0.95, 'the right mouse button raises them at once');
  await page.waitForFunction(() => __game.raise < 0.02, null, { polling: 50, timeout: 3000 }).catch(() => {});

  // independent meters
  await aimAt(page, 'fisherman'); await page.mouse.move(W / 2, H / 2); await page.mouse.down(); await wait(page, 2600);
  const a = await state(page);
  check(a.f > 0.25 && a.d < 0.1, 'watching the fisherman fills only his meter', `f ${a.f.toFixed(2)} d ${a.d.toFixed(2)}`);
  const meter = await page.evaluate(() => { const m = document.querySelector('.meter[data-who="fisherman"]'); return !m.hidden && m.querySelector('.m-icon svg') && m.querySelector('.m-state').textContent; });
  check(!!meter, 'his eye icon, bar and state words are shown above him', String(meter));
  await aimAt(page, 'driver'); await wait(page, 1600);
  const b = await state(page);
  check(b.d > a.d + 0.12 && b.f > a.f - 0.08, 'switching to the driver fills his meter and keeps the fisherman\'s', `f ${b.f.toFixed(2)} d ${b.d.toFixed(2)}`);
  // recovery: looking away (binoculars up) vs. hiding (binoculars down)
  await aimAway(page); await wait(page, 2400); const c = await state(page);
  await page.mouse.up(); await wait(page, 2400); const d = await state(page);
  const awayRate = (b.d - c.d), hideRate = (c.d - d.d);
  check(awayRate >= 0 && hideRate > awayRate * 1.5, 'looking away lets suspicion fall; hiding in the leaves makes it fall faster', `away −${awayRate.toFixed(3)} hidden −${hideRate.toFixed(3)} (2.4 s each)`);
  check(d.state === 'play', 'careful watching (with breaks) does not get you caught');

  // the levels show on the characters: push the fisherman to "suspicious" and look at his head turn
  await page.evaluate(() => { __game.watchers.fisherman.value = 0.8; });
  await aimAt(page, 'fisherman'); await page.mouse.move(W / 2, H / 2); await page.mouse.down(); await wait(page, 350);
  const turning = await page.evaluate(() => {
    const g = __game, w = g.watchers.fisherman, toTree = g.watchPoint.clone().sub(g.fisher.pos).setY(0).normalize();
    return { level: w.level, facing: g.fisher.forward.dot(toTree) };
  });
  await page.screenshot({ path: `${OUT}/desktop-suspicious.png` });
  check(turning.level === 2, 'level 2: the fisherman is suspicious', JSON.stringify(turning));
  await page.mouse.up(); await wait(page, 2600);
  const hid = await state(page);
  check(hid.state === 'play' && hid.fl < 2, 'hiding while he turns toward the tree gets you out of it', `f ${hid.f.toFixed(2)} level ${hid.fl}`);

  // detection by the fisherman, and everything that follows
  await aimAt(page, 'fisherman'); await page.mouse.move(W / 2, H / 2); await page.mouse.down();
  await page.waitForFunction(() => __game.state === 'caught', null, { polling: 100, timeout: 15000 });
  await wait(page, 150); await page.screenshot({ path: `${OUT}/desktop-hey.png` });
  const hey = await page.evaluate(() => ({ who: __game.caught.who, sub: document.getElementById('subtitle').textContent, callout: !document.getElementById('callout').hidden, lvl3: document.querySelector('.meter[data-who="fisherman"]').classList.contains('lvl3'), again: __game.detect('driver'), shout: !!__game.shout?.start }));
  check(hey.who === 'fisherman' && hey.sub.includes('HEY!') && hey.callout && hey.lvl3 && hey.shout, 'full suspicion: red "!", "HEY!" from the fisherman (the original recording)', JSON.stringify(hey));
  check(hey.again === false, 'a second detection is ignored');
  await page.mouse.up();
  await page.waitForFunction(() => __game.caught.done.notice, null, { polling: 100 });
  check(await page.evaluate(() => __game.watchers.driver.level === 3 && __game.watchers.driver.noticed), 'the driver notices and turns toward the tree');
  await page.waitForFunction(() => __game.caught.done.flinch, null, { polling: 100 }); await wait(page, 250);
  check(await page.evaluate(() => __game.raise < 0.4), 'the flinch knocks the binoculars down');
  await page.waitForFunction(() => __game.caught.done.crack, null, { polling: 50 });
  const crack = await page.evaluate(() => ({ broken: __game.perch.broken, loose: !!__game.perch.loose, hands: __game.perch.handMode }));
  await page.waitForFunction(() => __game.perch.bend > 0.15, null, { polling: 50, timeout: 1500 });
  check(crack.broken && crack.loose && crack.hands === 'reach', 'the branch bends and cracks; hands grab for it; the binoculars slip', JSON.stringify(crack));
  await page.screenshot({ path: `${OUT}/desktop-crack.png` });
  await page.waitForFunction(() => __game.state === 'falling', null, { polling: 100 }); await wait(page, 300);
  await page.screenshot({ path: `${OUT}/desktop-fall.png` });
  await page.waitForFunction(() => __game.state === 'underwater', null, { polling: 100, timeout: 15000 })
    .catch(async (e) => { console.log('STATE', JSON.stringify(await page.evaluate(() => ({ s: __game.state, y: __game.camera.position.y, fall: __game.fall, paused: __game.paused, t: __game.caught?.t, hidden: document.hidden })))); console.log(errors.join(' | ')); throw e; });
  await wait(page, 2000); await page.screenshot({ path: `${OUT}/desktop-underwater.png` });
  const under = await page.evaluate(() => {
    const g = __game, dh = g.driver.bones.head.getWorldPosition(g.camera.position.clone());
    return { y: g.camera.position.y, fisher: g.project(g.fisher.headWorld).inside, driver: g.project(dh).inside, binoculars: g.perch.binoculars.visible && g.project(g.perch.binoculars.position).inside, water: g.underwater.active };
  });
  check(under.y < 0 && under.water && under.fisher && under.driver && under.binoculars, 'underwater: both men peer down from the bank, the binoculars sink in front', JSON.stringify(under));
  await page.waitForSelector('#end:not([hidden])', { timeout: 15000 });
  const end = await page.evaluate(() => document.querySelector('#end h2').textContent);
  check(end.includes('Caught watching 💀'), '"Caught watching 💀" and "Try again"');
  await page.screenshot({ path: `${OUT}/desktop-end.png` });

  await page.click('#btn-again'); await wait(page, 300);
  const reset = await page.evaluate(() => {
    const g = __game, w = g.watchers;
    return { state: g.state, meters: [w.fisherman.value, w.driver.value, w.fisherman.level, w.driver.level, w.driver.noticed], driverInTruck: g.driver.group.parent === g.truck.body,
      fisherHome: g.fisher.pos.distanceTo(g.fisher.home) < 0.01, bend: Math.abs(g.perch.bend), branch: g.perch.pivot.visible && !g.perch.stub.visible, binoculars: !g.perch.loose && !g.perch.sinking && g.perch.binoculars.visible,
      hands: g.perch.handMode, legs: g.perch.legs.visible, hud: !document.getElementById('hud').hidden && !!document.getElementById('stance').offsetParent, underwater: g.underwater.active, cameraY: g.camera.position.y, fov: g.camera.fov === g.baseFov, caught: g.caught, end: document.getElementById('end').hidden, conv: g.conv.state };
  });
  await page.waitForFunction(() => __game.conv.state === 'playing', null, { polling: 100, timeout: 4000 }).catch(() => {});
  check(await page.evaluate(() => __game.conv.state === 'playing'), 'after Try again the argument starts over');
  check(reset.state === 'play' && reset.meters.every((v) => !v) && reset.driverInTruck && reset.fisherHome && reset.bend < 0.01 && reset.branch && reset.binoculars
    && reset.hands === 'hold' && reset.legs && reset.hud && !reset.underwater && reset.cameraY > 3 && reset.fov && reset.caught === null && reset.end, 'Try again restores every character, the branch, the camera and the meters', JSON.stringify(reset));

  // detection by the driver
  await aimAt(page, 'driver'); await page.mouse.move(W / 2, H / 2); await page.mouse.down();
  await page.waitForFunction(() => __game.state === 'caught', null, { polling: 100, timeout: 15000 });
  const byDriver = await page.evaluate(() => ({ who: __game.caught.who, f: __game.watchers.fisherman.value }));
  check(byDriver.who === 'driver', 'the driver can spot you too', JSON.stringify(byDriver));
  await page.mouse.up();
  await page.waitForSelector('#end:not([hidden])', { timeout: 9000 });
  check((await page.textContent('#end-detail')).includes('the driver'), 'the ending names who spotted you');
  await page.keyboard.press('KeyR'); await wait(page, 200);
  check((await state(page)).state === 'play', 'R restarts too');
  // timing: a curious first-timer who keeps the fisherman centred is spotted well inside 15–20 s
  const t0 = await page.evaluate(() => __game.time);
  await aimAt(page, 'fisherman'); await page.mouse.move(W / 2, H / 2); await page.keyboard.down('Space');
  await page.waitForFunction(() => __game.state === 'caught', null, { polling: 100, timeout: 15000 });
  await page.keyboard.up('Space');
  const spotted = await page.evaluate((t0) => __game.time - t0, t0);
  check(spotted > 3.2 && spotted < 6.5, 'Space works as the hold; a steady stare is spotted in about 4.5 s', `${spotted.toFixed(1)} s`);
  await context.close();
}

// ------------------------------------------------------------------ phone, native touch
{
  const W = 390, H = 844, { context, page, cdp } = await open({ width: W, height: H }, true);
  await page.screenshot({ path: `${OUT}/phone-opening.png` });
  const inView = await page.evaluate(() => { const g = __game; return [g.fisher.headWorld, g.driver.bones.head.getWorldPosition(g.camera.position.clone())].every((p) => g.project(p).inside); });
  check(inView, 'phone: both men in the opening view');
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const look0 = (await state(page)).aim;
  await touch('touchStart', W / 2, H / 2);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', W / 2 - i * 15, H / 2); await wait(page, 16); }
  await wait(page, 300); let s0 = await state(page); await touch('touchEnd');
  check(s0.raise < 0.05 && s0.aim.yaw > look0.yaw + 0.1, 'a finger drag looks around without the binoculars', `yaw ${look0.yaw.toFixed(2)} -> ${s0.aim.yaw.toFixed(2)}`);
  await page.evaluate(() => Object.assign(__game.aimAngles, __game.aimHome));
  await touch('touchStart', W / 2, H / 2); await page.waitForFunction(() => __game.raise > 0.95, null, { polling: 50, timeout: 3000 }).catch(() => {});
  let s = await state(page);
  check(s.raise > 0.95, 'touch and hold raises the binoculars');
  const before = s.aim;
  for (let i = 1; i <= 8; i++) { await touch('touchMove', W / 2 - i * 8, H / 2 - i * 5); await wait(page, 16); }
  s = await state(page);
  check(s.aim.yaw > before.yaw + 0.005 && s.aim.pitch > before.pitch + 0.003, 'dragging a finger aims', JSON.stringify({ before, after: s.aim }));
  await page.screenshot({ path: `${OUT}/phone-raised.png` });
  await touch('touchEnd'); await page.waitForFunction(() => __game.raise < 0.02, null, { polling: 50, timeout: 3000 }).catch(() => {}); s = await state(page);
  check(s.raise < 0.02, 'letting go lowers them');
  const lens = await page.evaluate(() => {
    const c = document.getElementById('lens'), x = c.getContext('2d'), px = (u, v) => x.getImageData(Math.round(u * c.width), Math.round(v * c.height), 1, 1).data[3];
    return { r: +c.dataset.r, w: innerWidth, centre: px(0.5, 0.5), corner: px(0.5, 0.03) };
  });
  check(lens.r > lens.w * 0.4 && lens.centre === 0 && lens.corner > 240, 'phone: the lenses fill the width (clear centre, dark frame)', JSON.stringify(lens));
  // press and hold on the fisherman (off-centre): the binoculars come up on him, not on the screen centre
  await page.evaluate(() => { const g = __game; g.aimAngles.yaw = g.aimHome.yaw + 0.25; g.aimAngles.pitch = g.aimHome.pitch - 0.1; });
  await wait(page, 400);
  const target = await page.evaluate(() => { const p = __game.project(__game.fisher.headWorld.add({ x: 0, y: -0.15, z: 0 })); return { x: p.x, y: p.y }; });
  await touch('touchStart', target.x, target.y);
  await page.waitForFunction(() => __game.raise > 0.95 && !__game.aimGoal, null, { polling: 50, timeout: 4000 }).catch(() => {});
  const onHim = await page.evaluate(() => __game.watchers.focusOn('fisherman'));
  await page.screenshot({ path: `${OUT}/phone-hold-on-fisherman.png` });
  await touch('touchEnd'); await page.waitForFunction(() => __game.raise < 0.02, null, { polling: 50, timeout: 3000 }).catch(() => {});
  check(onHim > 0.5, 'holding a finger on the fisherman zooms in on him', `pressed at ${target.x.toFixed(0)},${target.y.toFixed(0)}; focus ${onHim.toFixed(2)}`);
  await page.evaluate(() => Object.assign(__game.aimAngles, __game.aimHome));
  const btns = await page.evaluate(() => [...document.querySelectorAll('#hud button, #hud a')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect()).every((r) => r.height >= 44 && r.right <= innerWidth && r.left >= 0));
  check(btns, 'phone: HUD buttons fit and are at least 44 px tall');
  await aimAt(page, 'fisherman'); await page.evaluate(() => { __game.watchers.fisherman.value = 0.9; });
  await touch('touchStart', W / 2, H / 2);
  await page.waitForFunction(() => __game.state === 'caught', null, { polling: 100, timeout: 10000 }); await touch('touchEnd');
  await page.waitForSelector('#end:not([hidden])', { timeout: 9000 }); await page.screenshot({ path: `${OUT}/phone-end.png` });
  await page.tap('#btn-again'); await wait(page, 300);
  check((await state(page)).state === 'play', 'phone: Try again works');
  await context.close();
}

check(!errors.length, 'no page errors', errors.slice(0, 3).join('\n'));
await browser.close();
console.log(`\n${passed}/${passed + failed} checks passed  (${BASE})`);
process.exit(failed ? 1 : 0);
