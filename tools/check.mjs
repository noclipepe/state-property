// Automated smoke test: drives the real game through its interactions and saves screenshots.
// Usage: node tools/check.mjs [outDir] [scenario]   (server must be running on :8080)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'check-out';
const only = process.argv[3] || 'all';
fs.mkdirSync(outDir, { recursive: true });
const W = Number(process.env.W || 432), H = Number(process.env.H || 768);

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: process.env.TOUCH === '1', isMobile: process.env.TOUCH === '1' });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const state = () => ev(() => {
  const g = window.__game;
  return {
    fishing: g.fishing.state, target: g.fishing.target?.id ?? null, tension: +g.fishing.tension.toFixed(2), L: +g.fishing.L.toFixed(2),
    truck: { x: +g.truck.sim.pos.x.toFixed(2), z: +g.truck.sim.pos.y.toFixed(2), yaw: +g.truck.sim.yaw.toFixed(3), stuck: g.truck.sim.stuck },
    mirror: +g.truck.mirrorAngle.toFixed(2), cap: g.interactions.byId.cap.state, speaking: g.dialogue.current?.id ?? null,
    script: g.animator.script?.name ?? null,
  };
});
const log = async (label) => console.log(label.padEnd(26), JSON.stringify(await state()));

async function boot(query = 'autostart=skip') {
  await page.goto('http://localhost:8080/fisherman.html?' + query);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await wait(600);
}
async function castAt(id) {
  await ev((id) => window.__game.fishing.cast(window.__game.interactions.byId[id]), id);
  await page.waitForFunction(() => window.__game.fishing.state === 'hooked', null, { timeout: 5000 }).catch(() => {});
}
async function reel(ms) { await page.keyboard.down(' '); await wait(ms); await page.keyboard.up(' '); }
async function face(yaw, pitch, x, z) { await ev(([yaw, pitch, x, z]) => { const p = window.__game.player; p.setPose({ x: x ?? p.pos.x, z: z ?? p.pos.z, yaw, pitch }); }, [yaw, pitch, x, z]); }

const t0 = Date.now();
if (only === 'all' || only === 'start') {
  await boot('');
  await shot('00_title');
  await page.click('#btn-go');
  await wait(2500); await shot('01_intro_a');
  await wait(3000); await shot('02_intro_b');
  await log('intro');
  await wait(3500); await log('after intro');
  await shot('03_play_start');
}
if (only === 'all' || only === 'mirror') {
  await boot();
  await face(0.55, -0.22);
  await wait(300); await shot('10_mirror_view');
  await castAt('mirror'); await log('mirror hooked'); await shot('11_mirror_hooked');
  await reel(1800); await log('mirror reeled'); await shot('12_mirror_reeled');
  await wait(1500); await shot('13_mirror_react'); await log('mirror react');
  await page.keyboard.press('x'); await wait(3500); await log('mirror released/fixed'); await shot('14_mirror_fixed');
}
if (only === 'all' || only === 'cap') {
  await boot();
  await face(0.2, -0.2);
  await wait(300); await shot('20_cap_view');
  await castAt('cap'); await log('cap hooked');
  await reel(1200); await log('cap pulling'); await shot('21_cap_pull');
  await reel(1800); await log('cap out'); await shot('22_cap_out');
  await wait(1600); await shot('23_cap_react'); await log('cap react');
  await page.keyboard.press('x'); await wait(1500); await log('cap dropped'); await shot('24_cap_dropped');
}
if (only === 'all' || only === 'sleeve') {
  await boot();
  await castAt('sleeve'); await log('sleeve hooked'); await shot('30_sleeve_hooked');
  await reel(900); await log('sleeve pulling'); await shot('31_sleeve_pull');
  await page.keyboard.down(' ');
  await wait(1200); await shot('32_sleeve_grab');
  await wait(1200); await page.keyboard.up(' ');
  await log('sleeve unhooked'); await shot('33_sleeve_free');
  await wait(1500); await log('sleeve after');
}
if (only === 'all' || only === 'truck') {
  await boot();
  await ev(() => window.__game.startShowcase());
  await wait(500); await shot('40_showcase'); await log('showcase');
  await reel(1500); await log('truck strain'); await shot('41_strain');
  await reel(2500); await log('truck moving?'); await shot('42_moving');
  await page.keyboard.down(' '); await page.keyboard.down('s');
  await wait(2500); await shot('43_moving_more'); await log('truck dragged');
  await page.keyboard.up('s'); await page.keyboard.up(' ');
  await page.keyboard.press('x'); await wait(2000); await log('truck released'); await shot('44_released');
  await page.keyboard.press('r'); await wait(400); await log('after reset'); await shot('45_reset');
}
if (only === 'all' || only === 'repeat') {
  await boot();
  let ok = 0, total = 0;
  for (let round = 0; round < 3; round++) {
    for (const id of ['mirror', 'cap', 'sleeve', 'truck']) {
      total++;
      await castAt(id);
      const s1 = await state();
      await reel(500);
      await page.keyboard.press('x');
      await wait(900);
      const s2 = await state();
      if (s1.fishing === 'hooked' && s1.target === id && (s2.fishing === 'idle' || s2.fishing === 'retrieving')) ok++;
      else console.log('repeat fail', id, JSON.stringify(s1), JSON.stringify(s2));
    }
    await page.keyboard.press('r'); await wait(300);
  }
  console.log(`repeat: ${ok}/${total} hook+release cycles ok`);
}
if (only === 'all' || only === 'record') {
  await boot();
  await ev(() => window.__game.setRecordMode(true));
  await wait(400); await shot('60_record_mode');
  await ev(() => window.__game.startShowcase());
  await wait(300); await reel(2500); await shot('61_record_showcase'); await log('record showcase');
  await page.keyboard.press('Escape'); await wait(200);
  console.log('record mode after Esc:', await ev(() => window.__game.recordMode));
}
if (only === 'touch') {
  await boot();
  await shot('50_touch_layout');
  const yaw0 = await ev(() => window.__game.player.yaw);
  // drag on the canvas: must look around, never cast
  const box = await page.locator('#view').boundingBox();
  const fire = (type, x, y) => page.locator('#view').dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: box.x + x, clientY: box.y + y, bubbles: true });
  await fire('pointerdown', 200, 300);
  for (let i = 1; i <= 8; i++) await fire('pointermove', 200 + i * 12, 300 + i * 2);
  await fire('pointerup', 296, 316);
  await wait(200);
  const yaw1 = await ev(() => window.__game.player.yaw);
  console.log('drag changed yaw:', (yaw1 - yaw0).toFixed(3), 'fishing state after drag:', (await state()).fishing);
  await face(-0.17, -0.27, -0.30, 1.74);
  await wait(300);
  // tap the sleeve label position
  const lab = await ev(() => { const el = [...document.querySelectorAll('.tlabel')].find((e) => e.textContent.includes('Sleeve')); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom + 6 }; });
  await page.touchscreen.tap(lab.x, lab.y);
  await wait(1200);
  await log('after tap on sleeve');
  await shot('51_touch_hooked');
  const reel = page.locator('#btn-reel');
  await reel.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', isPrimary: false, bubbles: true });
  await wait(700); await log('holding REEL'); await shot('52_touch_reel');
  await reel.dispatchEvent('pointerup', { pointerId: 9, pointerType: 'touch', bubbles: true });
  await wait(1800); await log('after reel release');
  await page.locator('#btn-reset').tap(); await wait(300); await log('after reset tap');
}
console.log('time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log('console errors/warnings:', errors.filter((e) => !/X4122|deprecated|PCFSoftShadowMap|GPU stall/.test(e)).slice(0, 30).join('\n') || 'none');
await browser.close();
