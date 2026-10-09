// Verifies controls during dialogue and the truck-pulling behaviour in the real build.
// Usage: node tools/verify-controls.mjs [outDir]   (server must be running on :8080)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] || 'check-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 432, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, a) => page.evaluate(fn, a);
const wait = (ms) => page.waitForTimeout(ms);
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
const snap = () => ev(() => {
  const g = window.__game, s = g.truck.sim;
  return {
    px: g.player.pos.x, pz: g.player.pos.z, yaw: g.player.yaw, speaking: g.dialogue.current?.id ?? null,
    fishing: g.fishing.state, target: g.fishing.target?.id ?? null, tension: g.fishing.tension,
    tx: s.pos.x, tz: s.pos.y, tyaw: s.yaw, stuck: s.stuck, speed: s.speed, lift: s.susp.lift, roll: s.susp.roll, pitch: s.susp.pitch,
    seatOk: g.grandpa.group.parent === g.truck.body && g.grandpa.group.position.distanceTo(new g.grandpa.group.position.constructor().fromArray(g.grandpa.header.seat)) < 1e-6,
    script: g.animator.script?.name ?? null,
  };
});
const boot = async (q) => { await page.goto('http://localhost:8080/fisherman.html' + q); await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }); await wait(500); };

// ------------------------------------------------------------ A. controls during the intro
await boot('');
await page.click('#btn-go');
await wait(300);
const a0 = await snap();
check('intro is speaking right after GO', !!a0.speaking, a0.speaking);
await page.keyboard.down('s'); await wait(700); await page.keyboard.up('s');
await page.mouse.move(216, 300); await page.mouse.down(); await page.mouse.move(150, 300, { steps: 8 }); await page.mouse.up();
const a1 = await snap();
check('walk during intro', Math.hypot(a1.px - a0.px, a1.pz - a0.pz) > 0.4, `moved ${Math.hypot(a1.px - a0.px, a1.pz - a0.pz).toFixed(2)} m while "${a1.speaking}"`);
check('look during intro', Math.abs(a1.yaw - a0.yaw) > 0.2, `yaw ${a0.yaw.toFixed(2)} -> ${a1.yaw.toFixed(2)}`);
const pe = await ev(() => getComputedStyle(document.getElementById('subtitle')).pointerEvents);
check('subtitles ignore pointer input', pe === 'none', pe);
// cast + reel while he talks
await ev(() => { const g = window.__game; g.player.setPose({ x: -0.3, z: 1.74, yaw: -0.17, pitch: -0.27 }); });
await wait(100);
const castDuring = await ev(() => { const g = window.__game; g.fishing.cast(g.interactions.byId.sleeve); return g.dialogue.current?.id ?? null; });
await wait(900);
const a2 = await snap();
check('cast while speaking', a2.fishing === 'hooked' && !!castDuring, `cast during "${castDuring}", now ${a2.fishing}`);
await page.keyboard.down(' '); await wait(500);
const a3 = await snap();
await page.keyboard.up(' ');
check('reel while speaking', a3.tension > 0.3 && !!a3.speaking, `tension ${a3.tension.toFixed(2)} during "${a3.speaking}"`);
await page.screenshot({ path: `${out}/v_intro_play.png` });
// pose untouched when a line starts/ends
const p0 = await snap();
await wait(2500);
const p1 = await snap();
check('no camera/position reset across lines', Math.abs(p1.px - p0.px) < 0.01 && Math.abs(p1.yaw - p0.yaw) < 0.05, `${p0.speaking} -> ${p1.speaking}`);

// ------------------------------------------------------------ B. truck pull from beside the cab
async function pull(pose, ms, shots = '', backUpAfter = 0) {
  await ev(() => window.__game.reset());
  await wait(200);
  await ev((p) => { const g = window.__game; g.player.setPose(p); g.fishing.cast(g.interactions.byId.truck); }, pose);
  await page.waitForFunction(() => window.__game.fishing.state === 'hooked', null, { timeout: 4000 });
  const samples = [];
  const t0 = Date.now();
  await page.keyboard.down(' ');
  let i = 0;
  while (Date.now() - t0 < ms) {
    await wait(200);
    const s = await snap(); s.t = (Date.now() - t0) / 1000; samples.push(s);
    if (shots && i % 3 === 2) await page.screenshot({ path: `${out}/${shots}_${i}.png` });
    if (backUpAfter && s.t > backUpAfter && !samples.backing) { samples.backing = true; await page.keyboard.down('s'); }
    i++;
  }
  await page.keyboard.up(' ');
  await page.keyboard.up('s');
  return samples;
}
const side = await pull({ x: -0.9, z: 2.6, yaw: 0.25, pitch: -0.22 }, 4200, 'v_side', 1.6);
const brk = side.find((s) => !s.stuck);
check('resistance phase, then breakaway within ~1.5 s', brk && brk.t > 0.3 && brk.t < 1.6, brk ? `broke loose at ${brk.t.toFixed(2)} s` : 'never moved');
const end = side[side.length - 1];
const travel = Math.hypot(end.tx, end.tz);
check('obvious travel within 2 s', side.some((s) => s.t < 2.1 && Math.hypot(s.tx, s.tz) > 0.8), side.filter((s) => s.t < 2.1).map((s) => Math.hypot(s.tx, s.tz).toFixed(2)).join(' '));
check('several meters while reeling (backing up)', travel > 3.0, `${travel.toFixed(2)} m in ${end.t.toFixed(1)} s, yaw ${end.tyaw.toFixed(2)} rad`);
check('off-centre pull yaws the truck', Math.abs(end.tyaw) > 0.2, `yaw ${end.tyaw.toFixed(2)}`);
check('suspension rocks / side lifts', side.some((s) => Math.abs(s.roll) > 0.02) && side.some((s) => s.lift > 0.01), `max roll ${Math.max(...side.map((s) => Math.abs(s.roll))).toFixed(3)} max lift ${Math.max(...side.map((s) => s.lift)).toFixed(3)}`);
check('speed capped', side.every((s) => s.speed <= 2.41), `max ${Math.max(...side.map((s) => s.speed)).toFixed(2)} m/s`);
check('driver stays seated', side.every((s) => s.seatOk));

// ------------------------------------------------------------ C. release: short slide + wobble, then settle
await page.keyboard.press('x');
const rel = [];
for (let k = 0; k < 12; k++) { await wait(150); rel.push(await snap()); }
const slid = Math.hypot(rel[rel.length - 1].tx - end.tx, rel[rel.length - 1].tz - end.tz);
check('release: short slide then stops', rel[rel.length - 1].stuck && slid < 2.5, `slid ${slid.toFixed(2)} m, stuck=${rel[rel.length - 1].stuck}`);
const pitches = rel.map((s) => s.pitch.toFixed(3)).join(' ');
check('release wobble damps out', Math.abs(rel[rel.length - 1].pitch) < 0.02, pitches);

// ------------------------------------------------------------ D. direction depends on where you stand
const front = await pull({ x: -4.3, z: 1.2, yaw: -1.2, pitch: -0.15 }, 2600, '');
const rear = await pull({ x: 1.8, z: 3.2, yaw: 0.6, pitch: -0.2 }, 2600, '');
const fEnd = front[front.length - 1], rEnd = rear[rear.length - 1];
console.log('   front pull ->', fEnd.tx.toFixed(2), fEnd.tz.toFixed(2), 'yaw', fEnd.tyaw.toFixed(2));
console.log('   rear-side pull ->', rEnd.tx.toFixed(2), rEnd.tz.toFixed(2), 'yaw', rEnd.tyaw.toFixed(2));
check('standing in front drags it forward (-x)', fEnd.tx < -1.0, `dx ${fEnd.tx.toFixed(2)}`);
check('standing back/right drags it differently', rEnd.tx > fEnd.tx + 1.0 && Math.sign(rEnd.tyaw) !== Math.sign(fEnd.tyaw) || Math.abs(rEnd.tyaw - fEnd.tyaw) > 0.3, `yaw ${fEnd.tyaw.toFixed(2)} vs ${rEnd.tyaw.toFixed(2)}`);

// ------------------------------------------------------------ E. repeated pulls + reset
let repeatOk = true;
for (let k = 0; k < 4; k++) {
  const s = await pull({ x: -0.9 - k * 0.5, z: 2.6 + k * 0.3, yaw: 0.25, pitch: -0.22 }, 1800, '');
  await page.keyboard.press('x'); await wait(600);
  const e = await snap();
  if (!e.seatOk || !Number.isFinite(e.tx) || e.fishing === 'hooked' || Math.abs(e.tx) > 8 || Math.abs(e.tz) > 7) repeatOk = false;
}
check('repeated pulls keep the scene intact', repeatOk);
await page.keyboard.press('r'); await wait(300);
const r = await snap();
check('reset restores truck, hook and pose', Math.hypot(r.tx, r.tz) < 1e-3 && r.fishing === 'idle' && Math.abs(r.px + 0.30) < 0.01 && r.lift === 0, JSON.stringify({ tx: r.tx, f: r.fishing }));

console.log(`\n${results.filter((x) => x.ok).length}/${results.length} checks passed; page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
