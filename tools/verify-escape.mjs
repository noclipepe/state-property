// FISH ESCAPE checks in a real browser (WebGL, real keyboard / touch / mouse events):
//   PLAY, the opening scene (the familiar shot, the argument, skip), the move to the bucket, one
//   hop per input, the one-move buffer, taps vs swipes, blockers and fences, crabs hitting during
//   a hop, wide vehicle lanes, the fish rolling onto its other side, the hook (warning, locked cell,
//   dodge, retry, catch, reset by progress), scoring without back-and-forth farming, generator
//   fairness over many seeds, holding forward not getting far, a long bot run (bounded rows/crabs,
//   frame time), repeated restarts, portrait and landscape.
//   node tools/verify-escape.mjs [baseUrl] [outDir]      (baseUrl default http://localhost:8095/)
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:8095/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'check-out/escape-verify';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let passed = 0, failed = 0; const errors = [];
const check = (ok, name, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); ok ? passed++ : failed++; };
const poll = { polling: 50 };

async function open(viewport, { touch = false, seed = 11, play = true } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.stack)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}escape.html?seed=${seed}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  if (play) await page.evaluate(() => __game.begin());
  return { context, page, cdp: touch ? await context.newCDPSession(page) : null };
}
const S = (page) => page.evaluate(() => { const g = __game; return { state: g.state, cell: { ...g.fish.cell }, busy: g.fish.busy, score: g.score, furthest: g.furthest, stall: g.stall, hook: g.hook.state, time: g.time }; });
const idle = (page) => page.waitForFunction(() => !__game.fish.busy && __game.state === 'play', null, { ...poll, timeout: 3000 });
const settle = async (page) => { await idle(page); await page.waitForTimeout(40); };
// a calm spot: teleport onto a safe row with no buckets, far from crabs (tests that need quiet)
const quiet = (page, from = 0) => page.evaluate((from) => {
  // the course is dense now: clear a few rows (test only) so the fish has quiet grass around it
  const g = __game; g.restart(); g.teleport(Math.max(1, from), 0);
  const r = g.fish.cell.r;
  // (a vehicle lane is cleared whole: its rows share one lane)
  const lanes = new Set(), clear = (row) => Object.assign(row, { type: 'grass', lane: null, flow: null, fence: false, blocked: new Set(), props: [] });
  for (let k = r - 1; k <= r + 3; k++) { const row = g.course.row(k); if (row.lane) lanes.add(row.lane); clear(row); }
  for (const [, row] of g.course.rows) if (row.lane && lanes.has(row.lane)) clear(row);
  g.course.dirty = true; g.teleport(r, 0); return r;
}, from);

// ------------------------------------------------------------------ generator fairness (no rendering needed)
{
  const { context, page } = await open({ width: 800, height: 600 });
  const report = await page.evaluate(() => {
    const g = __game, C = g.course;
    const hop = 0.14, half = 0.26, margin = 0.25; let worst = { lane: 9, chain: 9, reach: 99 }, problems = [], kinds = {}, species = new Set(), express = 0;
    const vehicles = {}, fences = { rows: 0, wide: 0 }, decor = {};
    for (let seed = 1; seed <= 25; seed++) {
      C.reset(seed); C.update(0);
      let reach = new Set([-4, -3, -2, -1, 0, 1, 2, 3, 4]), runs = [[-4, -3, -2, -1, 0, 1, 2, 3, 4]], prev = null, prevType = 'grass';
      const freeRuns = (row) => { const out = [[]]; for (let c = -4; c <= 4; c++) { if (row.blocked.has(c)) out.push([]); else out.at(-1).push(c); } return out.filter((x) => x.length); };
      for (let r = 0; r < 600; r++) {
        if (r % 20 === 0) C.update(r);
        const row = C.row(r); kinds[row.type] = (kinds[row.type] || 0) + 1;
        for (const it of row.decor) decor[it.kind] = (decor[it.kind] || 0) + 1;
        if (row.fence) {
          fences.rows++; const gate = [...Array(9)].map((_, i) => i - 4).filter((c) => !row.blocked.has(c));
          if (gate.length > 2 || gate.some((c) => Math.abs(c) > 2)) problems.push(`seed ${seed} row ${r}: gate ${gate}`);
        }
        // a vehicle lane: rows r0 … r0 + rows - 1 share it; check it once, on its first row
        if (row.lane && row.part > 0) {
          if (C.row(r - 1)?.lane !== row.lane) problems.push(`seed ${seed} row ${r}: lane rows not together`);
          prevType = row.type; continue;
        }
        if (row.type === 'grass') {
          const free = [...Array(9)].map((_, i) => i - 4).filter((c) => !row.blocked.has(c));
          const next = new Set(); let run = [], touch = false;
          const flush = () => { if (touch) run.forEach((c) => next.add(c)); run = []; touch = false; };
          for (let c = -4; c <= 4; c++) { if (row.blocked.has(c)) { flush(); continue; } run.push(c); if (reach.has(c)) touch = true; } flush();
          if (next.size < Math.min(3, free.length) || !next.size) problems.push(`seed ${seed} row ${r}: ${next.size} reachable`);
          if (runs.some((run) => run.every((c) => row.blocked.has(c)))) problems.push(`seed ${seed} row ${r}: dead end below`);
          worst.reach = Math.min(worst.reach, next.size); reach = next; prev = null;
          runs = freeRuns(row).filter((run) => run.some((c) => next.has(c)));
        } else if (row.type === 'stream') {
          if (prevType !== 'grass' && prevType !== 'stream') problems.push(`seed ${seed} row ${r}: stream after ${prevType}`);
          if (Math.abs(C.flow(r)) > 3.5) problems.push(`seed ${seed} row ${r}: current ${C.flow(r)}`);
          reach = new Set([-4, -3, -2, -1, 0, 1, 2, 3, 4]); runs = [[...reach]]; prev = null;
        } else {
          const L = row.lane, wait = (L.minGap - 2 * half) / L.speed;
          if (L.kind === 'sand') L.movers.forEach((m) => species.add(m.species));
          if (L.kind === 'road') {
            const v = vehicles[L.vehicle] ||= { rows: new Set(), paints: new Set() };
            v.rows.add(L.rows); L.movers.forEach((m) => v.paints.add(m.paint));
          }
          if (L.express) express++;
          if (prevType === 'stream') problems.push(`seed ${seed} row ${r}: lane right after a stream`);
          worst.lane = Math.min(worst.lane, wait);
          if (wait < (L.rows + 1) * hop + margin) problems.push(`seed ${seed} row ${r}: gap lasts ${wait.toFixed(2)} s for ${L.rows} rows`);
          if (prev) {
            const need = (L.maxGroup + 2 * half) / L.speed + 2 * hop + margin, have = (prev.minGap - 2 * half) / prev.speed;
            worst.chain = Math.min(worst.chain, have - need);
            if (have < need) problems.push(`seed ${seed} row ${r}: wait ${have.toFixed(2)} < ${need.toFixed(2)}`);
          }
          const cap = L.express ? 9.6 : L.kind === 'road' ? 5.1 : 5.0;
          if (L.speed > cap) problems.push(`seed ${seed} row ${r}: ${L.kind} speed ${L.speed.toFixed(2)}`);
          prev = L; reach = new Set([-4, -3, -2, -1, 0, 1, 2, 3, 4]); runs = [[...reach]];
        }
        prevType = row.type;
      }
    }
    g.restart();
    const v = Object.fromEntries(Object.entries(vehicles).map(([k, x]) => [k, { rows: [...x.rows], paints: x.paints.size }]));
    return { kinds, species: [...species].sort(), express, worst, problems: problems.slice(0, 5), count: problems.length, vehicles: v, fences, decor };
  });
  check(report.count === 0, 'generator: grass rows stay connected with no dead ends, every lane leaves a fair gap, consecutive lanes can be crossed in turn, streams sit between grass (25 seeds × 600 rows)', JSON.stringify({ worst: report.worst, problems: report.problems }));
  check(['grass', 'sand', 'road', 'stream'].every((k) => report.kinds[k] > 200) && report.species.length === 6 && report.express > 20, 'the course mixes grass, crab sand, roads (with express lanes) and streams; all six crab species appear', JSON.stringify({ kinds: report.kinds, species: report.species, express: report.express }));
  const V = report.vehicles;
  check(V.car?.rows.join() === '2' && V.pickup?.rows.join() === '2' && V.truck?.rows.join() === '3' && Object.values(V).every((x) => x.paints === 5), 'three kinds of vehicle at real width (car and pickup span 2 rows, box truck 3), five colours each', JSON.stringify(V));
  check(report.fences.rows > 300 && ['ants', 'bobber', 'hook', 'sign'].every((k) => report.decor[k] > 50), 'fences with gates (one or two cells near the middle), ants, floats, lost hooks and signs along the way', JSON.stringify({ fences: report.fences, ants: report.decor.ants, bobbers: report.decor.bobber, hooks: report.decor.hook, signs: report.decor.sign }));
  await context.close();
}

// ------------------------------------------------------------------ just holding forward (or dodging only blockers) does not get far
{
  const { context, page } = await open({ width: 640, height: 400 });
  const res = await page.evaluate(() => {
    const g = __game, run = (seed, lazy) => {
      g.params.set('seed', String(seed)); g.restart();
      for (let t = 0; g.state === 'play' && t < 120; t += 1 / 120) {
        if (!g.fish.busy) {
          const r = g.fish.cell.r, c = Math.round(g.fish.pos.x);
          if (!lazy || g.course.open(r + 1, c)) g.move('f');
          else { let best = null; for (let cc = -4; cc <= 4; cc++) if (g.course.open(r + 1, cc) && (best === null || Math.abs(cc - c) < Math.abs(best - c))) best = cc; if (best !== null) g.move(best > c ? 'r' : 'l'); }
        }
        g.step(1 / 120);
      }
      return g.furthest;
    };
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    const seeds = Array.from({ length: 24 }, (_, i) => i + 1), forward = seeds.map((s) => run(s, false)), lazy = seeds.map((s) => run(s, true));
    g.params.delete('seed'); g.params.set('seed', '11'); g.restart();
    return { forward: med(forward), forwardMax: Math.max(...forward), lazy: med(lazy), lazyMax: Math.max(...lazy) };
  });
  check(res.forward <= 8 && res.lazy <= 15, 'holding forward stops at the first fence; going round blockers without timing the traffic dies early (24 seeds)', JSON.stringify(res));
  await context.close();
}

// ------------------------------------------------------------------ desktop: controls, buckets, crabs, hook, score, restarts
{
  const W = 1280, H = 720, { context, page } = await open({ width: W, height: H }, { play: false });
  const ready = await page.evaluate(() => ({ state: __game.state, play: !document.getElementById('btn-play').hidden, fish: __game.fish.pivot.visible }));
  check(ready.state === 'ready' && ready.play && !ready.fish, 'loaded: a PLAY button (it also turns the sound on); the fish is still in the bucket', JSON.stringify(ready));
  await page.click('#btn-play');
  // the familiar shot: both men on screen, the original argument with captions, letterbox bars
  await page.waitForFunction(() => __game.dialogue.playing, null, { ...poll, timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => document.getElementById('line').classList.contains('on'), null, { ...poll, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const opening = await page.evaluate(() => {
    const g = __game, on = (w) => { const p = w.clone().project(g.camera); return Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95 && p.z < 1; };
    return { state: g.state, a: g.dialogue.playing?.a, caption: document.getElementById('line').textContent, speaker: g.dialogue.speech().speaker, bars: document.getElementById('bars').classList.contains('on'),
      score: getComputedStyle(document.querySelector('.esc-top')).visibility, driver: on(g.eyeWorld()), fisherman: on(g.fisher.headWorld) };
  });
  check(opening.state === 'scene' && opening.a === 0 && /Who told you you could fish here\?/.test(opening.caption) && opening.speaker === 'driver' && opening.bars && opening.score === 'hidden' && opening.driver && opening.fisherman,
    'PLAY opens on the familiar shot: the driver at his window, the fisherman in front, "Who told you you could fish here?" captioned, letterbox, no score', JSON.stringify(opening));
  await page.screenshot({ path: `${OUT}/desktop-scene.png` });
  // the fish leaps in the bucket during the shot; after the first line the camera moves on and the
  // exchange carries on in the background
  const leap = await page.evaluate(() => new Promise((done) => { let top = 0; const id = setInterval(() => { const g = __game; top = Math.max(top, g.fish.pos.y * 0.6); if (g.state !== 'scene') { clearInterval(id); done({ top: +top.toFixed(2), visible: g.fish.pivot.visible, state: g.state, line: g.dialogue.playing && g.dialogue.cues[g.dialogue.playing.b].text, t: +g.dialogue.elapsed.toFixed(2) }); } }, 20); }));
  check(leap.top > 0.75 && leap.visible && leap.state === 'intro' && leap.t < 2.8 && leap.line === 'Yeah.', 'during "Who told you…" the fish leaps up out of the bucket; right after that line the camera moves on and the exchange keeps playing', JSON.stringify(leap));
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/desktop-after-scene.png` });
  await page.keyboard.press('ArrowUp');
  await settle(page);
  let s = await S(page);
  check(s.state === 'play' && s.cell.r === 1 && s.cell.c === 0, 'a key during the move to the bucket skips it and hops at once', JSON.stringify(s.cell));
  await page.screenshot({ path: `${OUT}/desktop-play.png` });

  // one press, one hop; held keys do not repeat
  await quiet(page, 3);
  let r0 = (await S(page)).cell.r;
  await page.keyboard.press('ArrowLeft'); await settle(page);
  await page.keyboard.press('KeyD'); await settle(page);
  await page.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', repeat: true, bubbles: true })));
  await page.waitForTimeout(250);
  s = await S(page);
  check(s.cell.r === r0 && s.cell.c === 0, 'arrow/WASD keys hop one cell each; auto-repeat is ignored', JSON.stringify(s.cell));
  // buffer: two quick presses = two hops; five quick presses never run away
  r0 = s.cell.r;
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(40); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(500); s = await S(page);
  check(s.cell.r === r0 + 2, 'a second press during a hop is buffered (two hops)', `${r0} -> ${s.cell.r}`);
  await quiet(page, 3); r0 = (await S(page)).cell.r;
  await page.evaluate(() => { for (let i = 0; i < 5; i++) __game.move('f'); }); // five inputs within one hop
  await page.waitForTimeout(600); s = await S(page);
  check(s.cell.r - r0 <= 2, 'a burst of presses queues at most one extra hop', `${r0} -> ${s.cell.r}`);

  // score: only new furthest rows count
  await quiet(page, 3); const base = await S(page);
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowUp']) { await page.keyboard.press(k); await settle(page); }
  s = await S(page);
  check(s.score === base.score + 1 && s.cell.r === base.cell.r + 1, 'hopping back and forth over old rows does not farm points', `score ${base.score} -> ${s.score}`);

  // every few hops the fish rolls right over and lands on its other side
  await quiet(page, 3);
  const before = await page.evaluate(() => ({ roll: __game.fish.roll, flips: __game.fish.flips }));
  for (let i = 0; i < 8; i++) { await page.keyboard.press(i % 2 ? 'ArrowDown' : 'ArrowUp'); await settle(page); }
  const after = await page.evaluate(() => ({ roll: __game.fish.roll, flips: __game.fish.flips }));
  check(after.flips >= 1 && after.flips <= 3, 'every few hops the fish rolls over onto its other side', JSON.stringify({ before, after }));

  // buckets and fences block
  const bucket = await page.evaluate(() => {
    const g = __game; g.restart();
    for (let r = 2; r < 40; r++) { const row = g.course.row(r), below = g.course.row(r - 1); if (row?.type === 'grass' && row.blocked.size && below?.type === 'grass') for (const c of row.blocked) if (g.course.open(r - 1, c)) { g.teleport(r - 1, c); return { r, c }; } }
    return null;
  });
  if (bucket) {
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(80);
    const wobbling = await page.evaluate(() => __game.course.wobble.size > 0);
    await settle(page); s = await S(page);
    check(s.cell.r === bucket.r - 1 && s.cell.c === bucket.c && wobbling, 'a blocker (bucket, boulder, bush or fence) blocks its cell: the fish bounces back, it wobbles', JSON.stringify({ bucket, fish: s.cell }));
    await page.screenshot({ path: `${OUT}/desktop-bucket.png` });
  } else check(false, 'found a bucket to test against');

  // edges: the course is nine cells wide
  await quiet(page, 3); await page.evaluate(() => __game.teleport(__game.fish.cell.r, 4));
  await page.keyboard.press('ArrowRight'); await settle(page);
  check((await S(page)).cell.c === 4, 'the fish cannot leave the course sideways');

  // crabs: a crab hits a fish that is mid-hop (hopping is not a jump over them)
  const crabTest = await page.evaluate(() => {
    const g = __game; g.restart();
    let lane = null;
    for (let r = 2; r < 60 && !lane; r++) { const row = g.course.row(r), below = g.course.row(r - 1); if (row?.type === 'sand' && below?.type === 'grass' && !below.blocked.has(0)) lane = r; }
    g.teleport(lane - 1, 0);
    const row = g.course.row(lane);
    // a fish lifted half a hop into the lane is still hit where a crab is
    const crab = row.lane.movers[0], x = g.course.crabX(crab, row.lane, g.time);
    return { lane, airborneHit: !!g.course.hit(x, lane - 0.4, g.time), clearHit: !!g.course.hit(x + crab.half + 1.5, lane, g.time) };
  });
  check(crabTest.airborneHit && !crabTest.clearHit, 'collision follows the fish mid-hop and matches crab bodies (no hits in a clear gap)', JSON.stringify(crabTest));
  // live: hop into the lane right in front of a crab
  await page.evaluate(() => {
    const g = __game, lane = g.fish.cell.r + 1, row = g.course.row(lane);
    // wait until a crab is just about to cross column 0, then hop in
    window.__waitHop = setInterval(() => {
      if (g.state !== 'play') return clearInterval(window.__waitHop);
      g.stall = 0; // waiting for the right crab here is the test's doing, not stalling
      for (const crab of row.lane.movers) { const x = g.course.crabX(crab, row.lane, g.time + 0.1); if (Math.abs(x) < crab.half + 0.1) { clearInterval(window.__waitHop); g.move('f'); return; } }
    }, 5);
  });
  await page.waitForFunction(() => __game.state !== 'play', null, { ...poll, timeout: 25000 });
  await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/desktop-pinched.png` });
  await page.waitForFunction(() => __game.state === 'results', null, { ...poll, timeout: 5000 });
  const res = await page.evaluate(() => ({ title: document.getElementById('end-title').textContent, score: document.getElementById('end-score').textContent, best: document.getElementById('end-best').textContent, visible: !document.getElementById('end').hidden }));
  check(res.visible && res.title === 'Pinched!' && res.best.length > 0, 'a crab ends the run with a tumble, then distance, best and record on the results', JSON.stringify(res));
  await page.screenshot({ path: `${OUT}/desktop-results.png` });

  // hook: stall → cast at the fish's cell → dodge → retry → progress cancels it → stall → caught
  await page.keyboard.press('Space'); await page.waitForFunction(() => __game.state === 'play', null, poll);
  await quiet(page, 3);
  await page.waitForFunction(() => __game.hook.state === 'descend', null, { ...poll, timeout: 12000 });
  const cast = await page.evaluate(() => ({ target: { ...__game.hook.cell }, fish: { ...__game.fish.cell }, stall: __game.stall, warning: document.getElementById('hook-warning').classList.contains('on') }));
  check(cast.stall >= 5.9 && cast.target.r === cast.fish.r && cast.target.c === cast.fish.c && cast.warning, 'after ~6 s without progress the hook drops on the fish\'s cell, with a warning', JSON.stringify(cast));
  await page.screenshot({ path: `${OUT}/desktop-hook.png` });
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => __game.hook.state !== 'descend', null, { ...poll, timeout: 4000 });
  s = await S(page);
  check(s.state === 'play' && ['retract', 'idle'].includes(s.hook), 'stepping off the marked cell dodges it (the target did not follow)', JSON.stringify({ hook: s.hook, fish: s.cell, target: cast.target }));
  await page.waitForFunction(() => __game.hook.state === 'descend', null, { ...poll, timeout: 6000 });
  const retry = await page.evaluate(() => __game.stall);
  check(retry > 7.0, 'still no progress: another cast comes after a short pause', `stall ${retry.toFixed(1)} s`);
  await page.keyboard.press('ArrowUp'); await settle(page);
  s = await S(page);
  check(s.stall < 0.5 && s.hook !== 'descend', 'reaching a new row clears the warning and the timer', JSON.stringify({ stall: s.stall, hook: s.hook }));
  await page.waitForFunction(() => __game.hook.state === 'descend', null, { ...poll, timeout: 12000 });
  await page.waitForFunction(() => __game.state === 'results', null, { ...poll, timeout: 8000 });
  const hooked = await page.evaluate(() => document.getElementById('end-title').textContent);
  check(hooked === 'Back in the bucket', 'staying put gets you hooked, lifted out and dropped back in the bucket', hooked);
  await page.screenshot({ path: `${OUT}/desktop-back-in-bucket.png` });

  // streams carry the fish; off the edge it is swept away
  await page.click('#btn-again'); await page.waitForFunction(() => __game.state === 'play', null, poll);
  const stream = await page.evaluate(() => {
    const g = __game; let r = null;
    for (let k = 0; k < 400 && r === null; k++) { g.course.update(k + 1); const row = g.course.row(k), below = g.course.row(k - 1), above = g.course.row(k + 1); if (row?.type === 'stream' && below?.type === 'grass' && above?.type === 'grass' && g.course.open(k - 1, 0)) r = k; }
    g.teleport(r - 1, 0); g.move('f');
    return { r, flow: g.course.flow(r) };
  });
  await page.waitForTimeout(700);
  const drift = await page.evaluate(() => ({ x: __game.fish.pos.x, r: __game.fish.cell.r }));
  check(drift.r === stream.r && Math.abs(drift.x) > 0.2 && Math.sign(drift.x) === Math.sign(stream.flow), 'in a stream the current carries the fish sideways', JSON.stringify({ ...stream, ...drift }));
  await page.screenshot({ path: `${OUT}/desktop-stream.png` });
  // (the grass beyond is cleared of blockers, so the hop out can't be a bump wherever it drifted to)
  await page.evaluate((r) => { const row = __game.course.row(r + 1); row.blocked.clear(); row.props = []; row.fence = false; __game.course.dirty = true; }, stream.r);
  await page.keyboard.press('ArrowUp'); await settle(page);
  const out = await page.evaluate(() => ({ c: __game.fish.cell.c, r: __game.fish.cell.r, state: __game.state }));
  check(out.state === 'play' && Number.isInteger(out.c) && out.r === stream.r + 1, 'hopping out of a stream lands on a whole cell', JSON.stringify(out));
  await page.evaluate((r) => { __game.teleport(r, 0); __game.stall = -99; }, stream.r);
  await page.waitForFunction(() => __game.state === 'results', null, { ...poll, timeout: 12000 });
  check((await page.textContent('#end-title')) === 'Swept away!', 'drifting off the edge of the course: swept away');
  // pickups: run over (the flat cartoon kind)
  await page.click('#btn-again'); await page.waitForFunction(() => __game.state === 'play', null, poll);
  const road = await page.evaluate(() => {
    const g = __game; let r = null;
    for (let k = 0; k < 400 && r === null; k++) { g.course.update(k); const row = g.course.row(k); if (row?.type === 'road' && !row.lane.express) r = k; }
    const row = g.course.row(r), car = row.lane.movers[0];
    g.teleport(r, Math.round(Math.max(-4, Math.min(4, g.course.moverX(car, row.lane, g.time + 0.4))))); g.stall = -99;
    return r;
  });
  await page.waitForFunction(() => __game.state !== 'play', null, { ...poll, timeout: 25000 });
  await page.waitForTimeout(200); await page.screenshot({ path: `${OUT}/desktop-flattened.png` });
  await page.waitForFunction(() => __game.state === 'results', null, { ...poll, timeout: 5000 });
  check((await page.textContent('#end-title')) === 'Flattened!', 'a vehicle ends the run: flattened (cartoon squash, no gore)', `road row ${road}`);
  const wide = await page.evaluate(() => {
    const g = __game; let L = null;
    for (let k = 0; k < 600 && !L; k++) { g.course.update(k); const lane = g.course.row(k)?.lane; if (lane?.vehicle === 'truck') L = lane; }
    const m = L.movers[0], x = g.course.moverX(m, L, g.time);
    return { rows: L.rows, hits: [0, 1, 2].map((i) => !!g.course.hit(x, L.r0 + i, g.time)), beside: [L.r0 + 3.2, L.r0 - 1.2].some((z) => g.course.hit(x, z, g.time)?.mover === m) };
  });
  check(wide.rows === 3 && wide.hits.every(Boolean) && !wide.beside, 'a box truck fills all three rows of its lane (and not the rows beside it)', JSON.stringify(wide));
  const deathLine = await page.evaluate(() => __game.dialogue.playing && __game.dialogue.cues[__game.dialogue.playing.a].text);
  check(deathLine === 'Hit the road, dude.', 'each ending has its own line from the original (pickup: "Hit the road, dude.")', String(deathLine));
  // express lanes announce the truck with blinking lamps and a bell before it arrives
  await page.click('#btn-again'); await page.waitForFunction(() => __game.state === 'play', null, poll);
  const ex = await page.evaluate(() => {
    const g = __game; let r = null;
    // an express road with grass in front of it, so the fish can wait there safely
    for (let k = 0; k < 900 && r === null; k++) { g.course.update(k); if (g.course.row(k)?.lane?.express && g.course.row(k - 1)?.type === 'grass' && g.course.open(k - 1, 0)) r = k; }
    g.teleport(r - 1, 0); return r;
  });
  await page.evaluate(() => { __game.audio.__bells = 0; const b = __game.audio.bell.bind(__game.audio); __game.audio.bell = () => { __game.audio.__bells++; b(); }; });
  await page.waitForFunction((r) => { __game.stall = 0; const L = __game.course.row(r).lane; return __game.course.expressIn(L, __game.time) < 1.0 && __game.course.expressIn(L, __game.time) > 0.2; }, ex, { polling: 20, timeout: 20000 });
  const lamps = await page.evaluate(() => ({ count: __game.course.lamps.count, bells: __game.audio.__bells }));
  await page.screenshot({ path: `${OUT}/desktop-express.png` });
  check(lamps.count >= 2 && lamps.bells >= 1, 'express lanes: warning lamps at both ends and a bell before the truck arrives', JSON.stringify({ row: ex, ...lamps }));

  // restarts reset everything, quickly, many times
  let ok = true;
  for (let i = 0; i < 5; i++) {
    await page.click('#btn-again');
    const st = await page.evaluate(() => { const g = __game; return { state: g.state, cell: g.fish.cell, score: g.score, stall: g.stall, hook: g.hook.state, buffered: g.buffered, rows: g.course.rows.size, end: document.getElementById('end').hidden, hud: !document.getElementById('hud').hidden, visible: g.fish.pivot.visible }; });
    ok = ok && st.state === 'play' && st.cell.r === 0 && st.cell.c === 0 && st.score === 0 && st.stall < 0.2 && st.hook === 'idle' && !st.buffered && st.end && st.hud && st.visible && st.rows < 60;
    await page.keyboard.press('ArrowUp'); await settle(page);
    await page.evaluate(() => { __game.teleport(__game.fish.cell.r, __game.fish.cell.c); __game.end = { cause: 'crab', t: 0, dir: 1, x0: __game.fish.pos.x }; __game.fish.anim = { kind: 'tumble', t: 0 }; __game.state = 'pinched'; });
    await page.waitForFunction(() => __game.state === 'results', null, { ...poll, timeout: 5000 });
  }
  check(ok, 'PLAY AGAIN resets the fish, course, camera, score, input and hook (5 times)');

  // a cautious bot that plans its crossings: in real time (bounded rows and crabs, steady frame
  // time), then many courses at fast-forward (they really are crossable)
  await page.click('#btn-again');
  await page.evaluate(() => {
    const g = __game, half = 0.26, hop = 0.15;
    const danger = (r, c, t0, t1) => { const row = g.course.row(r); if (!row?.lane) return false; for (let k = 0; k <= 8; k++) { const t = t0 + (t1 - t0) * k / 8; for (const crab of row.lane.movers) if (Math.abs(g.course.crabX(crab, row.lane, t) - c) < crab.half + half + 0.2) return true; } return false; };
    // plan a crossing like a player: step into row r at time t only if the fish can get through that lane and, waiting in its last row if need be, through the next one too
    const through = (r, c, t, depth = 0) => { const L = g.course.row(r)?.lane; if (!L) return false; const exit = L.r0 + L.rows, arrive = t + (exit - 1 - r) * hop; for (let tb = arrive; tb < t + 3.5; tb += 0.07) { if (danger(r, c, t, tb + hop + 0.12)) return true; if (depth >= 1 || !through(exit, c, tb + hop * 0.5, depth + 1)) return false; } return true; };
    window.__frames = []; let last = performance.now();
    const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__frames.length < 100000) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    window.__botMove = () => {
      if (g.state !== 'play' || g.fish.busy) return;
      const r = g.fish.cell.r, c = Math.round(g.fish.pos.x), t = g.time;
      const ok = (rr, cc) => g.course.open(rr, cc) && !(g.hook.active && g.hook.cell.r === rr && g.hook.cell.c === cc) && !(rr > r ? through(rr, cc, t) : danger(rr, cc, t, t + hop + 0.45)) && !danger(r, c, t, t + hop * 0.7) && !(g.course.flow(rr) * cc > 0 && Math.abs(cc) >= 3); // don't enter a stream that carries you straight off the edge
      // the hook is coming down on this cell: step aside
      if (g.hook.active && g.hook.cell.r === r && g.hook.cell.c === c) { for (const [d, dr, dc] of [['l', 0, -1], ['r', 0, 1], ['b', -1, 0]]) if (ok(r + dr, c + dc)) return g.move(d); }
      // in a stream, steer back toward the middle while waiting to get out
      if (g.course.flow(r) && !ok(r + 1, c)) { const back = g.course.flow(r) > 0 ? -1 : 1; if (Math.abs(g.fish.pos.x) > 1.5 && g.course.open(r, c + back)) return g.move(back < 0 ? 'l' : 'r'); }
      if (ok(r + 1, c)) return g.move('f');
      if (!g.course.open(r + 1, c)) { // walk toward the nearest open cell in the next row
        const along = (cc) => { for (let x = Math.min(c, cc); x <= Math.max(c, cc); x++) if (!g.course.open(r, x)) return false; return true; };
        let best = null; for (let cc = -4; cc <= 4; cc++) if (g.course.open(r + 1, cc) && along(cc) && (best === null || Math.abs(cc - c) < Math.abs(best - c))) best = cc;
        if (best !== null) { const d = best > c ? 'r' : 'l', dc = best > c ? 1 : -1; if (ok(r, c + dc)) return g.move(d); }
      }
      // the way ahead is only bad at the edge (a stream there): drift toward the middle
      if (Math.abs(c) >= 3 && g.course.flow(r + 1) * c > 0 && !danger(r, c, t, t + 0.4)) { const dc = c > 0 ? -1 : 1; if (ok(r, c + dc)) return g.move(dc < 0 ? 'l' : 'r'); }
      if (danger(r, c, t, t + 0.4)) { for (const [d, dr, dc] of [['f', 1, 0], ['b', -1, 0], ['l', 0, -1], ['r', 0, 1]]) if (ok(r + dr, c + dc)) return g.move(d); }
    };
    window.__bot = setInterval(() => { if (g.state === 'results') clearInterval(window.__bot); else window.__botMove(); }, 8);
  });
  const t0 = Date.now();
  await page.waitForFunction(() => __game.furthest >= 120 || __game.state === 'results', null, { polling: 250, timeout: 240000 }).catch(() => {});
  const run = await page.evaluate(() => {
    const g = __game, f = window.__frames.slice(60).sort((a, b) => a - b);
    return { state: g.state, furthest: g.furthest, rows: g.course.rows.size, crabs: g.course.crabBody.count, leaves: g.course.leaves.count, strips: g.course.strips.length, p50: f[Math.floor(f.length / 2)], p95: f[Math.floor(f.length * 0.95)], heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, cause: g.end?.cause };
  });
  await page.screenshot({ path: `${OUT}/desktop-long-run.png` });
  check(run.furthest >= 40 && run.rows <= 62 && run.strips <= 64 && run.crabs < 300 && run.p95 < 40, 'real-time run: rows, ground strips and crabs stay bounded, frame time steady', JSON.stringify({ ...run, seconds: Math.round((Date.now() - t0) / 1000) }));
  await page.evaluate(() => clearInterval(window.__bot));
  const sim = await page.evaluate(() => {
    const g = __game, out = [];
    for (let seed = 1; seed <= 10; seed++) {
      g.params.set('seed', String(seed)); g.restart();
      for (let t = 0; g.state === 'play' && g.furthest < 150 && t < 300; t += 1 / 120) { window.__botMove(); g.step(1 / 120); }
      out.push(g.furthest);
    }
    return out;
  });
  const median = [...sim].sort((a, b) => a - b)[5];
  check(median >= 100 && Math.min(...sim) >= 40, 'a cautious bot gets far on many courses: fences, crossings, wide roads and streams really are crossable', JSON.stringify({ median, runs: sim }));
  await context.close();
}

// ------------------------------------------------------------------ phone: taps vs swipes, portrait framing, landscape
{
  const W = 390, H = 844, { context, page, cdp } = await open({ width: W, height: H }, { touch: true, seed: 5 });
  // left alone, the scene runs its course: the shot, the move to the bucket, the fish jumps out
  await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/phone-scene.png` });
  await page.waitForFunction(() => __game.state === 'intro', null, { ...poll, timeout: 9000 }).catch(() => {});
  const mid = await page.evaluate(() => __game.state);
  await page.waitForFunction(() => __game.state === 'play', null, { ...poll, timeout: 6000 }).catch(() => {});
  const flow = await page.evaluate(() => ({ state: __game.state, fish: __game.fish.pivot.visible, cell: __game.fish.cell, bars: document.getElementById('bars').classList.contains('on') }));
  check(mid === 'intro' && flow.state === 'play' && flow.fish && flow.cell.r === 0 && !flow.bars, 'without a tap the scene ends by itself: to the bucket, the fish jumps out, play begins', JSON.stringify({ mid, ...flow }));
  const touch = async (pts) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] }); for (const [x, y] of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }); await page.waitForTimeout(12); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await quiet(page, 3);
  const r0 = (await S(page)).cell.r;
  await touch([[200, 500], [203, 502]]); await settle(page);
  let s = await S(page);
  check(s.cell.r === r0 + 1 && s.cell.c === 0, 'tap: one hop forward (small finger wobble is still a tap)', JSON.stringify(s.cell));
  await touch([[200, 500], [170, 502], [120, 505]]); await settle(page);
  s = await S(page); check(s.cell.c === -1 && s.cell.r === r0 + 1, 'swipe left: one hop left (not also a tap)', JSON.stringify(s.cell));
  await touch([[200, 500], [240, 498], [290, 497]]); await settle(page);
  s = await S(page); check(s.cell.c === 0, 'swipe right: one hop right', JSON.stringify(s.cell));
  await touch([[200, 500], [202, 540], [203, 590]]); await settle(page);
  s = await S(page); check(s.cell.r === r0, 'swipe down: one hop back', JSON.stringify(s.cell));
  await touch([[200, 500], [201, 460], [202, 410]]); await settle(page);
  s = await S(page); check(s.cell.r === r0 + 1, 'swipe up: one hop forward', JSON.stringify(s.cell));
  await touch([[200, 500], [212, 505], [218, 506]]); await page.waitForTimeout(300); // too long for a tap, too short for a swipe
  check((await S(page)).cell.r === r0 + 1, 'an ambiguous short drag does nothing');
  const scroll = await page.evaluate(() => ({ y: scrollY, h: document.documentElement.scrollHeight <= innerHeight + 1 }));
  check(scroll.y === 0 && scroll.h, 'the page does not scroll under the game');
  const frame = await page.evaluate(() => { const g = __game, C = 0.6, r = g.fish.cell.r, at = (c, rr) => g.project(new g.fish.pivot.position.constructor(c * C, 0, -rr * C)); const a = at(-1, r), b = at(1, r); return { pts: [[-3, r], [3, r], [0, r + 5]].map(([c, rr]) => at(c, rr).inside), cell: Math.round(b.x - a.x) / 2 }; });
  check(frame.pts.every(Boolean) && frame.cell >= 52, 'portrait: close up (cells about 55 px), three cells either side and five rows ahead on screen', JSON.stringify(frame));
  // at the edge the view follows the fish sideways: the edge column and the rows ahead of it stay in view
  await page.evaluate(() => { const g = __game; g.teleport(g.fish.cell.r, 4); g.stall = -99; }); await page.waitForTimeout(1500);
  const edge = await page.evaluate(() => { const g = __game, C = 0.6, r = g.fish.cell.r; return [[4, r], [4, r + 4], [1, r]].map(([c, rr]) => g.project(new g.fish.pivot.position.constructor(c * C, 0, -rr * C)).inside); });
  check(edge.every(Boolean), 'portrait: at the edge of the course the view follows the fish', JSON.stringify(edge));
  await quiet(page, 3);
  await page.screenshot({ path: `${OUT}/phone-portrait.png` });
  const hud = await page.evaluate(() => [...document.querySelectorAll('#hud button, #hud a')].map((b) => b.getBoundingClientRect()).every((r) => r.height >= 44 && r.left >= 0 && r.right <= innerWidth));
  check(hud, 'phone: HUD buttons fit and are at least 44 px tall');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(400);
  const land = await page.evaluate(() => { const g = __game, C = 0.6, r = g.fish.cell.r; return [[-4, r], [4, r], [0, r + 5]].map(([c, rr]) => g.project(new g.fish.pivot.position.constructor(c * C, 0, -rr * C)).inside); });
  check(land.every(Boolean), 'landscape phone: the row and five rows ahead are on screen', JSON.stringify(land));
  await page.screenshot({ path: `${OUT}/phone-landscape.png` });
  await context.close();
}

check(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${passed}/${passed + failed} checks passed  (${BASE})`);
process.exit(failed ? 1 : 0);
