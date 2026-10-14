// Browser integration checks. Phone tests use Chromium touch emulation, not a physical phone.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = (process.argv[2] || 'http://localhost:8085/').replace(/\/?$/, '/');
const out = 'check-out/fish';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=document-user-activation-required'] });
const checks = [], errors = [];
const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// Browser automation can grant activation while evaluating readiness. Emulate a strict
// gesture policy explicitly so the blocked-audio branch is still exercised reliably.
await page.addInitScript(() => {
  let touched = false;
  for (const name of ['pointerdown','keydown']) addEventListener(name, e => { if (e.isTrusted) touched = true; }, true);
  const NativeAudioContext = window.AudioContext;
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) { super(...args); this.suspend(); }
    resume() { return touched ? super.resume() : Promise.resolve(); }
  };
});
await page.goto(BASE + 'fish.html');
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
check('Loading opens the game automatically, with no PLAY or showcase gate', await page.evaluate(() => __game.mode === 'play' && document.getElementById('start').hidden && !document.querySelector('#btn-go, #btn-showcase')));
check('Emulated strict autoplay policy preserves the first line until a gesture', await page.evaluate(() => !__game.audio.running && !__game.conv.clip));
await page.evaluate(() => {
  const g = __game, a = g.audio, play = a.playBuffer.bind(a);
  window.voiceLog = []; window.liveVoices = new Set(); window.maxVoices = 0;
  a.playBuffer = (buf, bus, gain) => {
    const src = play(buf,bus,gain);
    if (bus === a.voice) {
      voiceLog.push(Object.keys(g.clips).find(k => g.clips[k].buffer === buf));
      liveVoices.add(src); maxVoices = Math.max(maxVoices,liveVoices.size);
      src.addEventListener('ended', () => liveVoices.delete(src));
    }
    return src;
  };
});
await page.tap('#view');
await page.waitForTimeout(500);
check('First touch unlocks sound and starts the first original line', await page.evaluate(() => __game.audio.running && __game.conv.clip?.id === 'd_who'));
check('Top-right SVG icons are centered in their touch targets', await page.evaluate(() => [...document.querySelectorAll('.fish-icon')].every(b => { const a=b.getBoundingClientRect(), s=b.querySelector('svg').getBoundingClientRect(); return Math.abs(a.x+a.width/2-s.x-s.width/2)<1 && Math.abs(a.y+a.height/2-s.y-s.height/2)<1 && a.width>=44; })));
check('Two companions stay inside the smaller metal bucket', await page.evaluate(() => __game.bucket.fish.length === 2 && __game.bucket.fish.every(f => Math.hypot(f.root.position.x,f.root.position.z)+0.06<0.32 && f.root.position.y<0.44) && __game.bucket.handle.children[0].geometry.parameters.tube <= 0.006));
check('Starts inside the water, with visible pooled bubbles', await page.evaluate(() => __game.wet === 1 && __game.bucket.bubbles.some(b => b.mesh.visible)));
await page.screenshot({ path: out + '/verified-opening.png' });
await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
check('WASD moves the fish through the water',await page.evaluate(()=>__game.swimOffset.length()>0.03 && __game.swimVelocity.length()>0.03));
await page.waitForTimeout(500);
check('Swimming coasts gently to a stop',await page.evaluate(()=>__game.swimVelocity.length()<0.015));
await page.keyboard.down('KeyW');await page.waitForTimeout(1600);await page.keyboard.up('KeyW');
check('Swimming stays inside the bucket walls',await page.evaluate(()=>__game.swimOffset.length()<=0.126&&__game.camera.position.distanceTo(__game.bucket.home.clone().setY(__game.camera.position.y))<0.24));
await page.tap('#btn-restart');
await page.waitForFunction(() => __game.conv.clip?.id === 'd_state');
const source = await page.evaluate(() => { window.firstVoice = __game.conv.clip.src; window.voiceCount = voiceLog.length; return __game.audio.filter.frequency.value; });
await page.keyboard.down('Space');
await page.waitForTimeout(1350);
check('Surfacing clears the same voice stream', await page.evaluate(() => __game.wet === 0 && __game.audio.filter.frequency.value > 14000 && __game.conv.clip?.src === firstVoice && voiceLog.length === voiceCount), `underwater cutoff ${source.toFixed(0)} Hz`);
await page.keyboard.up('Space');
await page.waitForTimeout(1150);
check('Release sinks smoothly and more strongly filters the uninterrupted voice', await page.evaluate(() => __game.wet > 0.95 && __game.audio.filter.frequency.value < 900 && __game.conv.clip?.src === firstVoice));

await page.tap('#btn-splash');
await page.waitForTimeout(550);
check('SPLASH briefly clears the rim while staying above the bucket', await page.evaluate(() => __game.height > 0.95 && Math.hypot(__game.camera.position.x - __game.bucket.root.position.x, __game.camera.position.z - __game.bucket.root.position.z) < 0.24));
await page.screenshot({ path: out + '/verified-jump.png' });
await page.waitForFunction(()=>!__game.jump);
check('Landing produces a visible crown, droplets and a splash across the view',await page.evaluate(()=>__game.bucket.crown.visible && __game.bucket.drops.some(d=>d.mesh.visible)&&__game.waterView.uniforms.uSplash.value>0.35));
check('Jump returns underwater and leaves ripples', await page.evaluate(() => !__game.jump && __game.wet === 1 && __game.bucket.time.value - __game.bucket.impact.value < 1));

const cdp = await page.context().newCDPSession(page);
const yaw = await page.evaluate(() => __game.yaw);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 190, y: 280 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 270, y: 305 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(350);
check('Touch swipe looks around', Math.abs(await page.evaluate(() => __game.yaw) - yaw) > 0.15);
const r = await page.locator('#btn-swim').boundingBox();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x:r.x+r.width/2,y:r.y+r.height/2 }] });
await page.waitForTimeout(1100);
check('Large touch button rises', await page.evaluate(() => __game.wet < 0.1));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
await page.waitForTimeout(1100);
check('Cancelled touch cannot leave swimming stuck', await page.evaluate(() => !__game.input.rising && __game.wet > 0.95));
const pad=await page.locator('#swim-pad').boundingBox();
const beforePad=await page.evaluate(()=>__game.swimOffset.toArray());
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pad.x+pad.width/2+24,y:pad.y+pad.height/2}]});
await page.waitForTimeout(600);
check('The touch pad swims sideways',await page.evaluate(p=>__game.swimOffset.distanceTo(__game.swimOffset.clone().fromArray(p))>0.035,beforePad));
await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await page.waitForTimeout(450);
check('Cancelled pad touch releases horizontal movement',await page.evaluate(()=>__game.input.movement.x===0&&__game.input.movement.y===0&&__game.swimVelocity.length()<0.02));

await page.tap('#btn-pause');
await page.waitForTimeout(100);
const paused = await page.evaluate(() => ({ time:__game.time, audio:__game.audio.ctx.currentTime, src:!!__game.conv.clip }));
await page.waitForTimeout(500);
check('Pause freezes the scene and the audio clock', await page.evaluate((v) => __game.paused && __game.time === v.time && Math.abs(__game.audio.ctx.currentTime-v.audio)<0.04 && __game.audio.ctx.state === 'suspended', paused));
await page.tap('#btn-subs');
check('Subtitles can be disabled without inventing a fish speaker', await page.evaluate(() => !__game.ui.subs && !document.querySelector('#subtitle.show')));
await page.tap('#btn-subs');
await page.tap('#btn-resume');
await page.waitForTimeout(200);
check('Resume continues the same run', await page.evaluate(t => !__game.paused && __game.time > t && __game.audio.running, paused.time));
await page.setViewportSize({ width: 844, height: 390 });
check('Landscape keeps controls on screen and does not restart', await page.evaluate(t => {
  const rect = document.getElementById('btn-swim').getBoundingClientRect();
  return __game.time >= t && rect.bottom <= innerHeight && rect.height >= 44 && document.scrollingElement.scrollWidth <= innerWidth;
}, paused.time));
await page.screenshot({ path: out + '/landscape.png' });
await page.setViewportSize({width:320,height:568});
check('Small phones keep all three swimming controls reachable',await page.evaluate(()=>{
  const boxes=['swim-pad','btn-swim','btn-splash'].map(id=>document.getElementById(id).getBoundingClientRect());
  return boxes.every(r=>r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>=44&&r.height>=44)&&boxes[0].right<=boxes[1].left&&boxes[1].right<=boxes[2].left;
}));
await page.setViewportSize({ width: 390, height: 844 });

// Restart during speech, then let the complete canonical route and ending run without shortcuts.
await page.tap('#btn-restart');
await page.waitForTimeout(160);
check('Restart clears the previous voice, effects and dialogue state', await page.evaluate(() => liveVoices.size === 1 && __game.conv.clip?.id === 'd_who' && __game.conv.history.length === 1 && __game.audio.oneshots.size === 0));
await page.evaluate(() => { voiceLog = ['d_who']; maxVoices = liveVoices.size; window.samples = []; window.frames = []; let last = performance.now(); const tick = (now) => { if (__game.ending?.shown) return; if(!__game.paused) {frames.push(now-last); samples.push({t:__game.spill.t,y:__game.camera.position.y});} last=now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
await page.waitForFunction(() => __game.hook.phase === 'drag', null, { timeout: 40000 });
await page.screenshot({ path: out + '/truck-drag.png' });
await page.waitForFunction(()=>__game.spill.active);
check('The moving pickup contacts the bucket once',await page.evaluate(()=>__game.spill.contacts===1&&['drag','settle'].includes(__game.hook.phase)));
await page.tap('#btn-pause'); const spillPause=await page.evaluate(()=>__game.spill.t);
await page.waitForTimeout(350);
check('Pause also freezes the bucket spill',await page.evaluate(t=>__game.spill.t===t&&__game.audio.ctx.state==='suspended',spillPause));
await page.tap('#btn-resume');
await page.waitForFunction(()=>__game.spill.t>1.6);
check('Water pours out and the fish reaches dry land',await page.evaluate(()=>__game.wet===0&&__game.spill.puddle.visible&&__game.bucket.spilled&&!__game.bucket.surface.visible&&__game.camera.position.y<0.16));
await page.screenshot({path:out+'/verified-ground.png'});
await page.waitForFunction(() => __game.ending?.shown, null, { timeout: 25000 });
const full = await page.evaluate(() => ({ voices:voiceLog, max:maxVoices, history:__game.conv.history, phase:__game.hook.phase, text:document.querySelector('#end h2').textContent, muted:__game.audio.ctx.state,
  fps:1000/(frames.reduce((a,b)=>a+b,0)/frames.length), p95:frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)], dpr:__game.renderer.getPixelRatio(), ground:samples.filter(s=>s.t>1.5&&s.t<3.8).map(s=>s.y), spillTime:__game.spill.t, flops:__game.spill.lastFlop }));
check('All three original exchanges play once in order; no voice overlap', full.voices.join() === 'd_who,d_state,d_name' && full.max === 1, JSON.stringify(full.voices));
check('The original truck drag reaches the new fish ending', full.phase === 'done' && full.text === 'Out of the bucket.' && full.muted === 'suspended');
check('The fish flops on land for a few seconds before the ending',full.spillTime>=4.2&&full.flops>=3&&Math.max(...full.ground)-Math.min(...full.ground)>0.025);
console.log('Phone emulation performance:', JSON.stringify({fps:full.fps,p95ms:full.p95,dpr:full.dpr}));
await page.screenshot({ path: out + '/ending.png' });
await page.tap('#btn-again');
await page.waitForTimeout(250);
check('End-screen replay starts exactly one fresh dialogue', await page.evaluate(() => __game.active && __game.conv.clip?.id === 'd_who' && liveVoices.size === 1 && !__game.ending));
check('Replay restores the upright bucket, water, fish and controls',await page.evaluate(()=>!__game.spill.active&&!__game.spill.group.visible&&__game.bucket.root.quaternion.w===1&&__game.bucket.surface.visible&&__game.bucket.fish.every(f=>f.root.parent===__game.bucket.school)&&__game.swimOffset.length()===0&&!document.querySelector('.fish-controls').hidden));
await page.tap('#btn-pause');
await page.tap('#btn-menu-showcase');
await page.waitForTimeout(5400);
check('Showcase automatically surfaces on the STATE exchange', await page.evaluate(() => __game.showcase && __game.conv.clip?.id === 'd_state' && __game.wet < 0.1));
await page.tap('#btn-record');
check('Recording UI can be hidden and restored', await page.locator('#stage').evaluate(e => e.classList.contains('clean')));
await page.tap('#btn-show-ui');
await page.waitForTimeout(4400);
check('Showcase dives again', await page.evaluate(() => __game.wet > 0.95));
await page.tap('#btn-pause');
await page.evaluate(() => addEventListener('pagehide', () => sessionStorage.setItem('fishExit', JSON.stringify({ state:__game.audio.ctx.state, clip:!!__game.conv.clip, muted:__game.audio.muted }))));
await page.tap('#btn-games');
await page.waitForFunction(() => window.__hubReady);
const exit = JSON.parse(await page.evaluate(() => sessionStorage.getItem('fishExit')));
check('Returning to the menu stops speech and all sound', exit.state === 'suspended' && !exit.clip && exit.muted, JSON.stringify(exit));
check('Menu has five available modes and a real Fish POV image', await page.evaluate(() => document.querySelectorAll('.card .btn-play').length === 5 && document.querySelector('[data-game=fish] img').naturalWidth > 0));
check('No browser or shader errors', errors.length === 0, errors.slice(0,3).join(' | '));
await browser.close();
console.log(`${checks.filter(Boolean).length}/${checks.length} passed`);
process.exitCode = checks.every(Boolean) ? 0 : 1;
