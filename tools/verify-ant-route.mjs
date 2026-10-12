import { chromium } from 'playwright';
import fs from 'node:fs';
const base = (process.argv[2] || 'http://127.0.0.1:8095/').replace(/\/?$/, '/');
const out = 'check-out/ant-route'; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [], checks = [];
const check = (name, ok, details = '') => { checks.push({ name, ok, details }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${details}`); };
const listen = page => { page.on('pageerror', e => { errors.push(e.message); console.error(e.message); }); };
try {
  const page = await browser.newPage({ viewport: { width: 432, height: 900 }, deviceScaleFactor: 1 }); listen(page);
  await page.goto(base + 'ant.html?q=low'); await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.click('#btn-recenter');
  check('Loaded original staging, six companions and breadcrumb', await page.evaluate(() => __game.friends.length === 6 && __game.ant.crumb.visible && Math.abs(__game.truck.dims.axleF + 1.7) < 0.001));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW');
  check('Keyboard moves ant', await page.evaluate(() => __game.player.x > -2.95));
  await page.keyboard.press('Escape');
  const paused = await page.evaluate(() => ({ p: __game.player.toArray(), t: __game.time, a: __game.audio.ctx.currentTime }));
  await page.waitForTimeout(450);
  check('Pause freezes player, clock and sound', await page.evaluate(s => __game.time === s.t && __game.player.toArray().every((v, i) => v === s.p[i]) && Math.abs(__game.audio.ctx.currentTime - s.a) < 0.06, paused));
  await page.click('#btn-resume'); await page.keyboard.press('KeyR'); await page.keyboard.press('KeyC');
  check('Restart resets delivery and hazards', await page.evaluate(() => __game.mode === 'play' && __game.checkpoint === 'front' && __game.hazards.pull.u === 0 && __game.hazards.boots[0].phase === 'idle' && __game.hazards.rod.phase === 'idle'));
  await page.evaluate(() => {
    window.voiceLog = []; const a = __game.audio, play = a.playBuffer.bind(a);
    a.playBuffer = (buffer, bus, gain) => { if (bus === a.voice) voiceLog.push(Object.keys(__game.clips).find(k => __game.clips[k].buffer === buffer)); return play(buffer, bus, gain); };
    __game.restart();
  });
  // Drive the regular movement controller, waiting at visible hazards.
  const started = Date.now(); let held = false; let last = -3; let stuck = 0;
  while (Date.now() - started < 100000) {
    const s = await page.evaluate(() => ({ mode: __game.mode, p: __game.player.toArray(), boot: __game.hazards.bootDanger, rod: __game.hazards.rod.danger, pull:__game.hazards.pull.danger, time: __game.time }));
    if (s.mode !== 'play') break;
    const walking = !s.boot && !s.rod && !s.pull;
    if (walking !== held) { await page.keyboard[walking ? 'down' : 'up']('KeyW'); held = walking; }
    if (walking && Math.abs(s.p[0] - last) < 0.001) stuck++; else stuck = 0;
    if (stuck === 8) { await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD'); stuck = 0; }
    last = s.p[0]; await page.waitForTimeout(100);
  }
  await page.keyboard.up('KeyW'); await page.waitForTimeout(1700);
  const result = await page.evaluate(() => ({ mode: __game.mode, pos: __game.player.toArray(), time: __game.time, checkpoint: __game.checkpoint, voices: voiceLog,
    boots: __game.hazards.boots.map(b => b.phase), rod: __game.hazards.rod.phase, pull:__game.hazards.pull.phase, crawled:__game.crawledUnder, elapsed:__game.conv.elapsed, duration:__game.conv.clip.line.duration, rate:__game.conv.clip.src.playbackRate.value }));
  check('Normal controls reach delivery ending', result.mode === 'complete', JSON.stringify(result));
  check('Original dialogue plays once at original speed and continues past delivery',result.voices.join(',')==='ant_argument'&&result.elapsed>25&&result.elapsed<result.duration&&result.duration>61&&result.rate===1,JSON.stringify(result.voices));
  check('Boot, rod, strong truck pull and underbody crawl encountered', result.boots.every(b => b === 'done') && result.rod==='done' && result.checkpoint === 'crossing' &&result.pull==='done'&&result.crawled);
  await page.screenshot({ path: out + '/route-result.png' });
  // Keep listening through the full original recording: no short loop, including the ending.
  await page.waitForFunction(()=>__game.conv.elapsed>64,null,{timeout:65000});
  check('Full 61.864-second recording ends naturally without restarting',await page.evaluate(()=>voiceLog.length===1&&__game.conv.state==='done'&&__game.conv.elapsed>64));
  await page.keyboard.press('KeyR');await page.keyboard.press('KeyC');
  await page.evaluate(() => { const g = __game, b = g.hazards.boots[0]; g.player.copy(b.center); g.hazards.startBoot(0); });
  await page.waitForTimeout(1700);
  check('A warned boot can cause failure', await page.evaluate(() => __game.mode === 'failed'));
  if (await page.evaluate(() => __game.mode === 'failed')) {
    await page.waitForTimeout(850);
    check('Automatic checkpoint retry restores play', await page.evaluate(() => __game.mode === 'play' && !__game.intro && __game.ant.crumb.visible && document.getElementById('failure').hidden));
  }
  await page.keyboard.press('Escape'); await page.click('#btn-games'); await page.waitForFunction(() => window.__hubReady);
  check('Menu includes playable Ant POV', (await page.locator('[data-game=ant] a.btn-play').getAttribute('href')) === 'ant.html');
  await page.close();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }); listen(phone);
  await phone.goto(base + 'ant.html?q=low'); await phone.waitForFunction(() => window.__ready, null, { timeout: 90000 }); await phone.tap('#btn-recenter');
  check('Mobile controls fit inside viewport', await phone.evaluate(() => ['move-pad', 'btn-recenter', 'btn-pause'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })));
  const cdp = await phone.context().newCDPSession(phone), box = await phone.locator('#move-pad').boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + 10, id: 1 }, before = await phone.evaluate(() => __game.player.x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await phone.waitForTimeout(700);
  check('Touch stick moves ant', await phone.evaluate(x => __game.player.x > x && __game.input.movement.y < -0.5, before));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  check('Touch cancellation releases stick', await phone.evaluate(() => __game.input.movement.y === 0));
  await phone.tap('#btn-pause'); await phone.setViewportSize({ width: 844, height: 390 });
  check('Rotation preserves paused state', await phone.evaluate(() => __game.paused && !document.getElementById('pause').hidden));
  await phone.setViewportSize({ width: 390, height: 844 }); await phone.tap('#btn-resume'); await phone.tap('#btn-sound');
  check('Mobile mute works', await phone.evaluate(() => __game.audio.muted));
  await phone.screenshot({ path: out + '/phone.png' }); await phone.close();
  check('No runtime errors', errors.length === 0, JSON.stringify(errors));
} finally { await browser.close(); fs.writeFileSync(out + '/report.json', JSON.stringify({ checks, errors }, null, 2)); }
if (checks.some(c => !c.ok) || errors.length) process.exitCode = 1;
