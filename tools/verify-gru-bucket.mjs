// Bucket hits and continuous pitched speech, using the production gameplay controls.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=(process.argv[2]||'http://localhost:8090/').replace(/\/?$/,'/');
const out='check-out/gru';
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const checks=[],errors=[];
let page=await browser.newPage({viewport:{width:540,height:960}});
page.on('pageerror',e=>errors.push(e.message));
const check=(name,ok,detail='')=>{checks.push({name,ok:!!ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`);};
async function aimBucket(){
  await page.evaluate(()=>{
    const g=__game,b=g.bucket,p=b.home.clone();
    g.player.setPose({x:p.x-0.45,z:p.z+1.3,yaw:0,pitch:-0.8});
    p.y+=0.27*g.gru.bucketScale;
    const d=p.sub(g.camera.position);g.player.yaw=Math.atan2(-d.x,-d.z);g.player.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));
  });await page.waitForTimeout(120);
}
async function bucketState(){return page.evaluate(async()=>{
  const g=__game,T=await import('/vendor/three/three.module.js'),b=g.bucket;
  return {scale:b.root.scale.toArray(),water:b.surface.getWorldScale(new T.Vector3()).toArray(),fish:b.fish.map(f=>f.root.getWorldScale(new T.Vector3()).toArray()),
    ground:b.root.position.y+0.02*b.root.scale.x,home:b.home.y,hits:g.gru.bucketHits,vehicle:g.gru.scale,voice:g.gru.voicePitch,spilled:b.spilled,
    fishLocal:b.fish.map(f=>f.root.position.toArray())};
});}
async function take(){await page.keyboard.press('KeyE');await page.waitForFunction(()=>__game.gru.state==='held');}
try{
  await page.goto(base+'fisherman.html?skin=gru');await page.waitForFunction(()=>window.__ready);await page.click('#btn-go');await take();
  const initial=await bucketState();
  await aimBucket();await page.screenshot({path:out+'/bucket-normal.png'});
  await page.click('#btn-ray');await page.waitForFunction(()=>__game.gru.bucketShrinkT===__game.gru.config.shrinkDuration);
  const tiny=await bucketState();
  check('A bucket hit shrinks only the bucket and leaves Gru full-sized',tiny.hits===1&&tiny.vehicle===1&&tiny.voice===1&&!tiny.spilled);
  check('Pail, water and both swimming fish shrink uniformly',tiny.scale.every(v=>Math.abs(v-0.22)<1e-6)&&tiny.water.every(v=>Math.abs(v-0.22)<1e-6)&&tiny.fish.every((s,i)=>s.every((v,j)=>Math.abs(v-initial.fish[i][j]*0.22)<1e-6)),JSON.stringify(tiny));
  check('The bucket keeps its original ground contact',Math.abs(tiny.ground-initial.ground)<1e-6);
  await aimBucket();await page.screenshot({path:out+'/bucket-miniature.png'});await page.click('#btn-ray');await page.waitForTimeout(650);
  check('Repeated bucket hits keep its final scale and one transition',await page.evaluate(()=>__game.gru.lastShot.target==='bucket'&&__game.gru.bucketHits===1&&__game.bucket.root.scale.x===__game.gru.config.finalBucketScale));
  await page.evaluate(()=>{const g=__game;g.player.setPose({x:g.bucket.home.x+0.4,z:g.bucket.home.z,yaw:0,pitch:-0.8});});await page.waitForTimeout(150);
  check('The reduced bucket collision frees its old outer footprint',await page.evaluate(()=>__game.player.pos.distanceTo(__game.bucket.home)<0.5));
  await page.evaluate(()=>__game.player.setPose({x:-0.30,z:1.74,yaw:-0.17,pitch:-0.27}));await page.waitForTimeout(120);
  await page.click('#btn-ray');await page.waitForFunction(()=>__game.gru.scale<0.121);
  check('The vehicle can shrink after the bucket without restoring it',await page.evaluate(()=>__game.gru.hits===1&&__game.gru.bucketHits===1&&__game.gru.bucketScale<0.221));
  await page.keyboard.press('KeyR');await page.waitForTimeout(150);
  check('Restart restores the bucket, fish, water and voice',await page.evaluate(async()=>{const g=__game,T=await import('/vendor/three/three.module.js');return g.gru.bucketShrinkT===null&&g.gru.bucketHits===0&&g.bucket.root.scale.x===1&&g.gru.voicePitch===1&&g.bucket.fish.every(f=>Math.abs(f.root.getWorldScale(new T.Vector3()).x-1.5)<1e-6);}));
  await take();await aimBucket();await page.click('#btn-ray');await page.waitForTimeout(200);await page.keyboard.press('KeyR');await page.waitForTimeout(900);
  check('Restart midway through bucket shrinking cancels the animation',await page.evaluate(()=>__game.bucket.root.scale.x===1&&__game.gru.bucketShrinkT===null&&__game.gru.state==='mounted'));
  await take();await page.click('#btn-ray');await page.waitForFunction(()=>__game.gru.scale<0.121);
  await aimBucket();await page.click('#btn-ray');await page.waitForFunction(()=>__game.gru.bucketScale<0.221);
  check('The bucket can also shrink after the vehicle',await page.evaluate(()=>__game.gru.hits===1&&__game.gru.bucketHits===1&&__game.gru.scale<0.121&&__game.gru.bucketScale<0.221));
  await page.evaluate(()=>{const g=__game;g.dialogue.stop();g.dialogue.say('g_private',{force:true});});
  await page.waitForTimeout(80);
  const clockA=await page.evaluate(()=>({t:__game.dialogue.now(),playhead:__game.dialogue.playbackTime(),rate:__game.dialogue.current.rate}));
  await page.waitForTimeout(160);
  const clockB=await page.evaluate(()=>({t:__game.dialogue.now(),playhead:__game.dialogue.playbackTime(),rate:__game.dialogue.current.rate}));
  check('Subtitle and mouth clocks follow the faster audio playhead',Math.abs((clockB.playhead-clockA.playhead)/(clockB.t-clockA.t)-1.85)<0.03,JSON.stringify({clockA,clockB}));
  await page.evaluate(()=>window.pausedSource=__game.dialogue.current.src);
  await page.click('#btn-pause');const paused=await page.evaluate(()=>__game.dialogue.playbackTime());await page.waitForTimeout(180);
  check('Pause freezes the pitched dialogue playhead',await page.evaluate(p=>Math.abs(__game.dialogue.playbackTime()-p)<0.03,paused));
  await page.click('#btn-resume');
  const resumed=await page.waitForFunction(p=>__game.audio.running&&__game.dialogue.current?.src===pausedSource&&__game.dialogue.playbackTime()>p+0.1,paused,{timeout:5000}).then(()=>true,()=>false);
  check('Resume advances the same pitched line',resumed);
  await page.keyboard.press('KeyR');await page.waitForTimeout(150);
  check('Restart after both targets restores every scale and live voice',await page.evaluate(()=>__game.gru.scale===1&&__game.bucket.root.scale.x===1&&__game.dialogue.current.src.playbackRate.value===1&&__game.gru.voicePanner.positionY.value>1.4));
  await page.close();
  const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});page=await mobile.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'fisherman.html?skin=gru');await page.waitForFunction(()=>window.__ready);await page.tap('#btn-go');
  await page.tap('#btn-ray');await page.waitForFunction(()=>__game.gru.state==='held');await aimBucket();await page.tap('#btn-ray');
  await page.waitForFunction(()=>__game.gru.bucketScale<0.221);await page.screenshot({path:out+'/mobile-bucket-miniature.png'});
  check('Phone FIRE shrinks the bucket while keeping Gru full-sized',await page.evaluate(()=>__game.gru.lastShot.target==='bucket'&&__game.gru.bucketHits===1&&__game.gru.scale===1));
  await page.tap('#btn-reset');await page.waitForTimeout(150);
  check('Phone Restart restores the bucket and mounted ray',await page.evaluate(()=>__game.bucket.root.scale.x===1&&__game.gru.state==='mounted'));
  await mobile.close();
  check('No browser errors',errors.length===0,JSON.stringify(errors));
}finally{fs.writeFileSync(out+'/bucket-verification.json',JSON.stringify({checks,errors},null,2));await browser.close();}
console.log(`${checks.filter(c=>c.ok).length}/${checks.length} checks passed`);
if(checks.some(c=>!c.ok)||errors.length)process.exitCode=1;
