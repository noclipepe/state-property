// Verifies: rear-door hooking pulls/turns the whole truck at the clicked spot, the drag line
// ("I can call down...") triggers once on real movement (queued, never overlapping), and Restart
// replays the original intro exactly once with no leftover audio. Server must run on :8080.
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
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };

await page.goto('http://localhost:8080/fisherman.html');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
// voice log: every clip start/stop/end on the voice bus, to detect overlaps and repeats
await ev(() => {
  const g = window.__game, au = g.audio, d = g.dialogue;
  window.__voice = [];
  const orig = au.playBuffer.bind(au);
  au.playBuffer = (buf, bus, gain) => {
    const src = orig(buf, bus, gain);
    if (bus === au.voice) {
      const id = Object.keys(d.buffers).find((k) => d.buffers[k] === buf);
      const rec = { id, t0: performance.now() / 1000, t1: null };
      window.__voice.push(rec);
      const prevEnded = src.onended;
      src.addEventListener('ended', () => { rec.t1 = rec.t1 ?? performance.now() / 1000; });
      const stop = src.stop.bind(src);
      src.stop = (w) => { rec.t1 = rec.t1 ?? performance.now() / 1000; stop(w); };
    }
    return src;
  };
});
const voice = () => ev(() => window.__voice.map((r) => ({ ...r })));
const overlaps = (log) => { const s = [...log].sort((a, b) => a.t0 - b.t0); for (let i = 1; i < s.length; i++) if (s[i - 1].t1 === null || s[i].t0 < s[i - 1].t1 - 0.02) return `${s[i - 1].id} & ${s[i].id}`; return null; };
const truckState = () => ev(() => { const s = window.__game.truck.sim; return { x: s.pos.x, z: s.pos.y, yaw: s.yaw, stuck: s.stuck }; });

// ------------------------------------------------------------ 1. intro, movement during it
await page.click('#btn-go');
await wait(400);
const p0 = await ev(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z, yaw: window.__game.player.yaw }));
await page.keyboard.down('a'); await wait(500); await page.keyboard.up('a');
await page.mouse.move(250, 300); await page.mouse.down(); await page.mouse.move(200, 310, { steps: 6 }); await page.mouse.up();
const p1 = await ev(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z, yaw: window.__game.player.yaw, speaking: window.__game.dialogue.current?.id }));
check('move + look during intro', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3 && Math.abs(p1.yaw - p0.yaw) > 0.1, `speaking ${p1.speaking}`);
await wait(7500);
let log = await voice();
check('intro plays in order, once', log.map((r) => r.id).join(',') === 'g_who,p_state,g_private', log.map((r) => r.id).join(','));

// ------------------------------------------------------------ 2. restart during speech, repeatedly
for (let k = 0; k < 3; k++) {
  await wait(k === 0 ? 0 : 900 + k * 500); // restart at different moments, mid-line included
  await page.keyboard.press('r');
}
await wait(150);
const afterR = await ev(() => ({ cur: window.__game.dialogue.current?.id, queue: window.__game.dialogue.queue.length, intro: window.__game.introActive, sub: document.getElementById('subtitle').textContent }));
check('restart starts the intro from the first line', afterR.cur === 'g_who' && afterR.intro, JSON.stringify(afterR));
await ev(() => { window.__voice.length = 0; });
// play controls are live right after restart
const q0 = await ev(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
await page.keyboard.down('s'); await wait(500); await page.keyboard.up('s');
const q1 = await ev(() => ({ x: window.__game.player.pos.x, z: window.__game.player.pos.z }));
check('can walk right after restart', Math.hypot(q1.x - q0.x, q1.z - q0.z) > 0.3);
await wait(8000);
log = await voice();
const ids = log.map((r) => r.id);
check('after restart: remaining intro lines once, no stale lines', ids.join(',') === 'p_state,g_private' || ids.join(',') === 'g_who,p_state,g_private', ids.join(','));
check('no overlapping voice clips across restarts', !overlaps(log), overlaps(log) || 'none');

// restart while a line is playing: old audio must stop at once
await page.keyboard.press('r'); await wait(1200); // mid g_who
await ev(() => { window.__voice.length = 0; window.__voiceAll = window.__voice; });
const before = await ev(() => window.__game.dialogue.current?.id);
await page.keyboard.press('r');
await wait(60);
const stopped = await ev(() => { const d = window.__game.dialogue; return { cur: d.current?.id, srcs: window.__voice.length }; });
await wait(2600);
log = await voice();
check('restart mid-line cleanly restarts the intro', before && stopped.cur === 'g_who' && !overlaps(log), `was "${before}", now "${stopped.cur}", log ${log.map((r) => r.id)}`);
await wait(6000);

// ------------------------------------------------------------ 3. rear door hook at the clicked spot
async function hookRearAt(px, py) {
  await ev(() => { window.__game.reset({ intro: false }); window.__game.player.setPose({ x: 1.2, z: 3.4, yaw: 0.05, pitch: -0.32 }); });
  await wait(300);
  // project two points on the rear door to screen and click one
  const scr = await ev(([lx, ly]) => {
    const g = window.__game, v = g.truck.worldPoint(new g.camera.position.constructor(lx, ly, g.truck.dims.halfW), new g.camera.position.constructor());
    v.project(g.camera); return { x: (v.x * 0.5 + 0.5) * g.size.w, y: (-v.y * 0.5 + 0.5) * g.size.h };
  }, [px, py]);
  await page.mouse.click(scr.x, scr.y);
  await page.waitForFunction(() => window.__game.fishing.state === 'hooked', null, { timeout: 4000 }).catch(() => {});
  return ev(() => { const g = window.__game, t = g.fishing.target; return { id: t?.id, local: t ? t.local.toArray() : null }; });
}
const hA = await hookRearAt(0.30, 0.95);
const hB = await hookRearAt(0.80, 1.20);
check('rear door area is hookable', hA.id === 'rearDoor' && hB.id === 'rearDoor', `${hA.id}, ${hB.id}`);
const dA = hA.local && Math.hypot(hA.local[0] - 0.30, hA.local[1] - 0.95), dB = hB.local && Math.hypot(hB.local[0] - 0.80, hB.local[1] - 1.20);
check('hook attaches at the clicked position', dA < 0.08 && dB < 0.08, `A ${hA.local?.map((n) => n.toFixed(2))} B ${hB.local?.map((n) => n.toFixed(2))}`);
await page.screenshot({ path: `${out}/rear_hooked.png` });
// reel while backing away at an angle -> whole truck slides and turns; hook stays on the door
const t0 = await truckState();
await ev(() => { window.__voice.length = 0; });
await page.keyboard.down(' ');
await wait(900);
await page.keyboard.down('s'); await page.keyboard.down('d');
const samples = [];
for (let i = 0; i < 12; i++) {
  await wait(250);
  samples.push(await ev(() => {
    const g = window.__game, t = g.fishing.target, s = g.truck.sim;
    const ap = t.attachPoint(new g.camera.position.constructor());
    const lineEnd = g.line.end;
    const local = ap.clone().applyMatrix4(g.truck.body.matrixWorld.clone().invert());
    return { x: s.pos.x, z: s.pos.y, yaw: s.yaw, endGap: ap.distanceTo(lineEnd), local: local.toArray(), cur: g.dialogue.current?.id ?? null, door: g.truck.bodyMesh.parent === g.truck.body };
  }));
  if (i === 5) await page.screenshot({ path: `${out}/rear_drag.png` });
}
await page.keyboard.up('s'); await page.keyboard.up('d'); await page.keyboard.up(' ');
const last = samples[samples.length - 1];
check('rear-door pull moves the whole truck', Math.hypot(last.x - t0.x, last.z - t0.z) > 1.0, `${Math.hypot(last.x - t0.x, last.z - t0.z).toFixed(2)} m`);
check('rear-door pull turns the truck', Math.abs(last.yaw - t0.yaw) > 0.15, `yaw ${last.yaw.toFixed(2)}`);
check('attachment stays fixed on the door, line follows', samples.every((s) => s.endGap < 0.03 && Math.abs(s.local[0] - hB.local[0]) < 1e-3 && Math.abs(s.local[1] - hB.local[1]) < 1e-3), `max gap ${Math.max(...samples.map((s) => s.endGap)).toFixed(3)} m`);

// ------------------------------------------------------------ 4. drag line: "I can call down..." once, not "state property"
log = await voice();
const dragIds = log.map((r) => r.id);
check('drag reaction is the verified "I can call down..." clip', dragIds[0] === 'g_call', dragIds.join(',') || 'nothing played');
check('no "state property" lines while dragging', !dragIds.some((id) => id === 'g_private' || id === 'g_private_short'), dragIds.join(','));
const firstCall = samples.find((s) => s.cur === 'g_call');
check('triggered by real movement, not on attach', !!firstCall && Math.hypot(firstCall.x - t0.x, firstCall.z - t0.z) > 0.3, firstCall ? `truck had moved ${Math.hypot(firstCall.x - t0.x, firstCall.z - t0.z).toFixed(2)} m` : '');
// drag again in the same playthrough -> no second g_call
await page.keyboard.press('x'); await wait(800);
await ev(() => { window.__voice.length = 0; const g = window.__game; g.player.setPose({ x: g.truck.sim.pos.x - 1.0, z: g.truck.sim.pos.y + 4.0, yaw: 0.3, pitch: -0.25 }); g.fishing.cast(g.interactions.byId.rearDoor); });
await page.waitForFunction(() => window.__game.fishing.state === 'hooked', null, { timeout: 4000 }).catch(() => {});
await page.keyboard.down(' '); await page.keyboard.down('s'); await wait(4000); await page.keyboard.up('s'); await page.keyboard.up(' ');
log = await voice();
check('only once per playthrough', !log.some((r) => r.id === 'g_call'), log.map((r) => r.id).join(',') || 'none');

// queued: if a line is playing when the truck starts moving, the reaction plays right after it
await ev(() => window.__game.reset({ intro: false }));
await ev(() => { window.__voice.length = 0; const g = window.__game; g.player.setPose({ x: 1.2, z: 3.4, yaw: 0.05, pitch: -0.32 }); g.fishing.cast(g.interactions.byId.rearDoor); });
await page.waitForFunction(() => window.__game.fishing.state === 'hooked', null, { timeout: 4000 }).catch(() => {});
await ev(() => window.__game.dialogue.say('g_lock', { force: true }));
await page.keyboard.down(' '); await page.keyboard.down('s');
await wait(4500);
await page.keyboard.up('s'); await page.keyboard.up(' ');
log = await voice();
const iLock = log.findIndex((r) => r.id === 'g_lock'), iCall = log.findIndex((r) => r.id === 'g_call');
check('reaction queued behind a playing line, no overlap', iLock === 0 && iCall === 1 && !overlaps(log), `${log.map((r) => `${r.id}@${(r.t0 - log[0].t0).toFixed(2)}-${r.t1 ? (r.t1 - log[0].t0).toFixed(2) : '?'}`).join(' ')}`);

// ------------------------------------------------------------ 5. other targets still there
const ids2 = await ev(() => window.__game.interactions.targets.map((t) => t.id).join(','));
check('existing targets preserved', ids2 === 'mirror,cap,sleeve,truck,rearDoor', ids2);
await page.keyboard.press('r'); await wait(400);
const fin = await ev(() => { const g = window.__game; return { seat: g.grandpa.group.parent === g.truck.body, tx: g.truck.sim.pos.x, f: g.fishing.state, line: g.interactions.truckLineDone, cur: g.dialogue.current?.id }; });
check('restart restores truck/line/flags and replays intro', fin.seat && fin.tx === 0 && fin.f === 'idle' && fin.line === false && fin.cur === 'g_who', JSON.stringify(fin));

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed; page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
