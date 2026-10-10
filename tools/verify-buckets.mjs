// Browser checks for the shared bucket and physical keyboard bindings.
// Layouts are emulated using key/code pairs; this does not change the host OS layout.
// Usage: node tools/verify-buckets.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';

const base=(process.argv[2] || 'http://localhost:8086/').replace(/\/?$/,'/');
const out=process.argv[3] || 'check-out/buckets';
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:432,height:768}});
const cdp=await page.context().newCDPSession(page);
const results=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
const check=(name,ok,detail='')=>{ results.push(ok); console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`); };
const wait=ms=>page.waitForTimeout(ms);
const key=(type,code,value)=>cdp.send('Input.dispatchKeyEvent',{type,code,key:value,windowsVirtualKeyCode:code.charCodeAt(3)});
try {
  await page.goto(base+'fisherman.html?autostart=skip');
  await page.waitForFunction(()=>window.__ready && __game.mode==='play',null,{timeout:90000});
  for (const [name,letters] of [['Latin',['w','a','s','d']],['Cyrillic',['ц','ф','ы','в']],['Arabic',['ص','ش','س','ي']]]) {
    const distances=[];
    for (const [i,code] of ['KeyW','KeyA','KeyS','KeyD'].entries()) {
      await page.evaluate(()=>{ __game.input.reset(); __game.player.setPose({x:-4,z:4,yaw:0,pitch:-0.27}); });
      await key('rawKeyDown',code,letters[i]); await wait(400);
      await key('keyUp',code,letters[i]);
      const delta=await page.evaluate(()=>({x:__game.player.pos.x+4,z:__game.player.pos.z-4}));
      distances.push([ -delta.z,-delta.x,delta.z,delta.x ][i]);
    }
    check(`${name} key values move in all four WASD directions`,distances.every(d=>d>0.2),distances.map(d=>d.toFixed(2)).join(', '));
  }
  await key('rawKeyDown','KeyW','ц'); await wait(150); await key('keyUp','KeyW','w'); await wait(650);
  check('Releasing after a layout switch stops movement',await page.evaluate(()=>__game.input.keys.size===0 && __game.player.vel.length()<0.01));
  await key('rawKeyDown','KeyD','в'); await page.keyboard.press('Escape'); await key('keyUp','KeyD','d');
  await page.click('#btn-resume'); await wait(150);
  check('Pause clears held physical keys',await page.evaluate(()=>!__game.paused && __game.input.keys.size===0 && __game.input.move.x===0));

  for (const mode of ['fisherman','driver']) {
    if(mode==='driver') {
      await page.goto(base+'driver.html');
      await page.waitForFunction(()=>window.__ready && __game.mode==='play' && !__game.opening,null,{timeout:90000});
    } else await page.evaluate(()=>__game.reset({intro:false}));
    const bucket=await page.evaluate(()=>{
      const g=__game,b=g.bucket,p=g.truck.root.worldToLocal(b.home.clone());
      return {local:p.toArray(),fish:b.fish.length,water:b.surface.visible&&b.filled.value===1,handle:b.handle.children.length,spilled:b.spilled};
    });
    check(`${mode}: filled bucket, two fish and attached handle match the shared staging`,Math.abs(bucket.local[0]-0.45)<0.001 && Math.abs(bucket.local[2]-2.5)<0.001 && bucket.fish===2 && bucket.water && bucket.handle>4 && !bucket.spilled);

    // Aim with each mode's own view controller for an actual playable view of the pail.
    await page.evaluate(mode=>{
      const g=__game,b=g.bucket;
      if(mode==='fisherman') g.player.setPose({x:b.home.x-0.6,z:b.home.z+0.85,yaw:-0.615,pitch:-0.85});
      else {
        const target=g.truck.body.worldToLocal(b.home.clone().setY(0.3)).sub(g.view.eye);
        const yaw=Math.atan2(-target.x,-target.z)-Math.PI/2;
        const wrapped=Math.atan2(Math.sin(yaw),Math.cos(yaw));
        g.view.look(wrapped-g.view.yaw,Math.atan2(target.y,Math.hypot(target.x,target.z))-g.view.pitch);
      }
    },mode);
    await wait(250); await page.screenshot({path:`${out}/${mode}-bucket.png`});

    await page.evaluate(mode=>{
      const g=__game;
      if(mode==='driver') g.debugHook();
      else {
        g.player.setPose({x:0.45,z:4.4,yaw:0,pitch:-0.3});
        g.fishing.attachNow(g.interactions.byId.truck);
      }
    },mode);
    if(mode==='fisherman') await page.keyboard.down('Space');
    await page.waitForFunction(()=>__game.bucketSpill.active,null,{timeout:12000});
    if(mode==='fisherman') await page.keyboard.up('Space');
    await wait(750);
    check(`${mode}: moving truck spills the bucket exactly once`,await page.evaluate(()=>__game.bucket.spilled && __game.bucketSpill.contacts===1 && __game.bucket.filled.value<0.2));
    check(`${mode}: spill preserves the human camera and controls`,await page.evaluate(mode=>{
      const g=__game;
      return mode==='driver' ? g.camera.parent===g.truck.body && g.camera.position.distanceTo(g.view.eye)<0.05 : g.camera.position.y>1.5 && g.input.enabled && Math.abs(g.player.pos.z-4.4)<0.01;
    },mode));
    await page.click('#btn-pause'); await wait(100);
    const frozen=await page.evaluate(()=>({time:__game.bucketSpill.t,water:__game.bucket.time.value}));
    await wait(350);
    check(`${mode}: pause freezes bucket and spill`,await page.evaluate(f=>__game.bucketSpill.t===f.time && __game.bucket.time.value===f.water,frozen));
    await page.click('#btn-resume');
    await page.evaluate(()=>__game.reset()); await wait(200);
    check(`${mode}: restart refills and restores the existing bucket`,await page.evaluate(()=>{
      const g=__game,b=g.bucket;
      return !g.bucketSpill.active && g.bucketSpill.contacts===0 && !b.spilled && b.filled.value===1 && b.surface.visible && b.root.position.distanceTo(b.home)<0.001 && b.fish.every(f=>f.root.parent===b.school) && b.school.children.length===2;
    }));
  }
  check('No browser errors',errors.length===0,errors.join(' | '));
} finally {
  await browser.close();
}
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exitCode=results.every(Boolean) && errors.length===0 ? 0 : 1;
