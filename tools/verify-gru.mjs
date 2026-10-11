// Local browser integration checks against the production build, including real input.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE=(process.argv[2]||'http://localhost:8090/').replace(/\/?$/,'/');
const OUT='check-out/gru';fs.mkdirSync(OUT,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const checks=[],errors=[];
function check(name,ok,detail='') {checks.push({name,ok:!!ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${detail}`);}
async function open(options={}) {
  const ctx=await browser.newContext({viewport:{width:540,height:960},...options});const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  return {ctx,page};
}
async function ready(page,path='fisherman.html?skin=gru') {
  await page.goto(BASE+path);await page.waitForFunction(()=>window.__ready,null,{timeout:90000});
}
async function project(page,point) {return page.evaluate(async a=>{
  const T=await import('/vendor/three/three.module.js'),g=__game;
  const p=g.truck.worldPoint(new T.Vector3(...a)).project(g.camera),r=g.canvas.getBoundingClientRect();
  return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2};
},point);}
async function clickVehicle(page) {const p=await project(page,[-0.12,1.13,0.95]);await page.mouse.click(p.x,p.y);}
async function snapshot(page) {return page.evaluate(async()=>{
  const T=await import('/vendor/three/three.module.js'),g=__game,r=g.gru;
  return {scale:g.truck.root.scale.toArray(),state:r.state,hand:r.held.visible,rod:g.rod.group.visible,rayParent:r.ray.parent.name,
    wheels:g.truck.wheels.map(w=>w.pivot.getWorldPosition(new T.Vector3()).y-g.truck.dims.wheelR*g.truck.root.scale.x),
    occupant:g.grandpa.group.getWorldScale(new T.Vector3()).toArray(),gun:r.ray.getWorldScale(new T.Vector3()).toArray(),
    eye:g.camera.position.y,fov:g.camera.fov,shots:r.shots,hits:r.hits,dialogue:g.dialogue.current?.id,queue:g.dialogue.queue.map(q=>q.id),
    beam:r.beam.visible,collision:{x:g.truck.collisionHalf.x*g.truck.root.scale.x,z:g.truck.collisionHalf.z*g.truck.root.scale.x}};
});}

try {
  const {ctx,page}=await open();
  await ready(page,'');
  check('Menu retains three working POV entries',await page.locator('.card .btn-play').count()===3);
  await page.click('#choose-skin');await page.click('[data-skin="gru"]');
  check('Skin picker is scoped to Fisherman POV',await page.locator('[data-game="fisherman"] #skin-current').textContent()==='SKIN: GRU'&&await page.locator('#skin-options').isHidden());
  check('Driver and Fish links have no Gru option',await page.evaluate(()=>['driver','fish'].every(id=>!document.querySelector(`[data-game="${id}"] .btn-play`).href.includes('skin'))));
  await page.reload();await page.waitForFunction(()=>window.__hubReady);
  check('Skin choice persists across visits',await page.locator('[data-game="fisherman"] .btn-play').getAttribute('href')==='fisherman.html?skin=gru');
  await page.screenshot({path:`${OUT}/menu-desktop.png`});
  await page.click('[data-game="fisherman"] .btn-play');await page.waitForFunction(()=>window.__ready);
  check('Menu launches Gru',await page.evaluate(()=>__game.skin==='gru'&&!!__game.gru));
  const dimensions=await page.evaluate(()=>__game.vehicleMeasurements);
  const pickup=JSON.parse(fs.readFileSync(new URL('./fixtures/pickup-dimensions.json',import.meta.url),'utf8'));
  check('All exterior dimensions obey pickup limits',dimensions.length<=pickup.length*1.1&&dimensions.width<=pickup.width*1.1&&dimensions.height<=pickup.height*1.15,JSON.stringify(dimensions));
  fs.writeFileSync(`${OUT}/dimensions.json`,JSON.stringify({pickup,gru:dimensions,ratios:{length:dimensions.length/pickup.length,width:dimensions.width/pickup.width,height:dimensions.height/pickup.height}},null,2));
  await page.click('#btn-go');await page.waitForTimeout(500);
  await page.evaluate(()=>{
    const g=__game,a=g.audio,play=a.playBuffer.bind(a);window.voiceLog=[];window.liveVoices=new Set();window.maxVoices=0;
    a.playBuffer=(buffer,bus,gain)=>{const src=play(buffer,bus,gain);if(bus===a.voice||bus===g.gru.voicePanner){const item={id:Object.keys(g.dialogue.buffers).find(k=>g.dialogue.buffers[k]===buffer),rate:1,time:a.ctx.currentTime,spatial:bus===g.gru.voicePanner};voiceLog.push(item);liveVoices.add(src);maxVoices=Math.max(maxVoices,liveVoices.size);src.addEventListener('ended',()=>{item.rate=src.playbackRate.value;liveVoices.delete(src);});}return src;};
  });
  const initial=await snapshot(page);
  check('Full size uses original eye height and FOV',Math.abs(initial.eye-1.64)<0.015&&initial.fov===64);
  check('Four wheels touch ground before shrinking',initial.wheels.every(y=>Math.abs(y)<0.002));
  check('Mounted weapon can be reached and the hand holds only the rod',await page.evaluate(()=>__game.gru.canTake()&&__game.rod.group.visible&&!__game.gru.held.visible));
  await page.screenshot({path:`${OUT}/gru-normal.png`});
  await page.keyboard.press('KeyE');await page.waitForTimeout(350);
  check('Pickup transfers the actual mesh off its visible mount',await page.evaluate(()=>__game.gru.state==='picking'&&__game.gru.ray.parent===__game.gru.held&&__game.truck.gru.mount.parent===__game.truck.body));
  check('Rod and held ray never occupy the same hand',await page.evaluate(()=>!__game.rod.group.visible&&__game.gru.held.visible&&!__game.fishing.lure.visible&&!__game.line.line.visible));
  await page.keyboard.press('KeyR');await page.waitForTimeout(180);
  check('Restart during pickup restores mount, hand and introduction',await page.evaluate(()=>__game.gru.state==='mounted'&&__game.gru.ray.parent===__game.gru.mount&&__game.rod.group.visible&&!__game.gru.held.visible&&__game.dialogue.current?.id==='g_who'));
  await page.click('#ray-take-label');await page.waitForFunction(()=>__game.gru.state==='held');
  await page.evaluate(()=>{__game.player.pitch=0.75;__game.player.yaw=1.8;});await page.waitForTimeout(100);
  await page.click('#btn-ray');await page.waitForTimeout(900);
  check('Firing into the sky misses and keeps full size',await page.evaluate(()=>__game.gru.shots===1&&__game.gru.hits===0&&__game.truck.root.scale.x===1));
  await page.evaluate(()=>__game.player.setPose({x:-0.30,z:1.74,yaw:-0.17,pitch:-0.27}));await page.waitForTimeout(150);
  // Start a complete existing complaint to make continuity checks independent of test speed.
  await page.evaluate(()=>{__game.skipIntro();__game.dialogue.stop();});await page.waitForTimeout(80);
  await page.evaluate(()=>__game.dialogue.say('g_private',{force:true}));
  await page.evaluate(()=>{window.shotSource=__game.dialogue.current?.src;window.shotStart=__game.dialogue.current?.start;window.shotLine=__game.dialogue.current?.id;window.samples=[];window.sampling=true;
    function sample(){if(!sampling)return;const g=__game;samples.push({at:performance.now(),scale:g.truck.root.scale.x,wheel:g.truck.wheels[0].pivot.matrixWorld.elements[13]-g.truck.dims.wheelR*g.truck.root.scale.x});requestAnimationFrame(sample);}sample();
  });
  await clickVehicle(page);
  check('A visible vehicle surface registers a hit',await page.evaluate(()=>__game.gru.lastShot.hit&&__game.gru.hits===1));
  await page.waitForTimeout(160);
  check('Shot raises pitch on the same live source without restarting',await page.evaluate(()=>__game.dialogue.current?.src===shotSource&&__game.dialogue.current?.start===shotStart&&shotSource.playbackRate.value>1&&shotSource.playbackRate.value<__game.gru.config.finalVoicePitch));
  await page.waitForFunction(()=>__game.gru.shrinkT===__game.gru.config.shrinkDuration);
  await page.evaluate(()=>window.sampling=false);
  const tiny=await snapshot(page);
  check('Vehicle and occupant shrink uniformly to 0.12',tiny.scale.every(v=>Math.abs(v-0.12)<1e-6)&&tiny.occupant.every(v=>Math.abs(v-0.12)<1e-6));
  check('Gun, fisherman eye height and FOV retain normal scale',tiny.gun.every(v=>Math.abs(v-1)<1e-6)&&Math.abs(tiny.eye-1.64)<0.015&&tiny.fov===64);
  check('Tiny Gru uses a higher pitch and a spatial source near the ground',await page.evaluate(()=>{const r=__game.gru;return Math.abs(r.voicePitch-1.85)<1e-6&&r.voicePanner.panningModel==='HRTF'&&r.voicePanner.positionY.value<0.24&&r.voicePanner.positionY.value>0.1&&__game.audio.ctx.listener.positionY.value>1.6;}));
  check('Wheel ground contact is preserved throughout the transformation',await page.evaluate(()=>samples.every(s=>Math.abs(s.wheel)<0.003)));
  const timing=await page.evaluate(()=>{const moving=samples.filter(s=>s.scale<1&&s.scale>0.120001);return {count:moving.length,duration:moving.at(-1)?.at-moving[0]?.at,monotone:samples.every((s,i)=>!i||s.scale<=samples[i-1].scale)};});
  check('Shrink is smooth, monotonic and approximately 0.8 seconds',timing.count>12&&timing.monotone&&timing.duration>=650&&timing.duration<1050,JSON.stringify(timing));
  check('Collision footprint scales with the vehicle',Math.abs(tiny.collision.x-initial.collision.x*0.12)<1e-6&&Math.abs(tiny.collision.z-initial.collision.z*0.12)<1e-6);
  check('Line collision shapes use the scaled body transform',await page.evaluate(async()=>{
    const T=await import('/vendor/three/three.module.js'),{truckLineCollider}=await import('/src/scene/truck.js'),g=__game;
    const c=truckLineCollider(g.truck);c.begin();const p=g.truck.worldPoint(new T.Vector3(-1.7,0.8,0.4)),start=p.clone();c.apply(p);
    const outside=new T.Vector3(0,0.5,0.65),copy=outside.clone();c.apply(outside);
    const cabin=g.truck.worldPoint(new T.Vector3(0,0.8,0.4)),cabinStart=cabin.clone();c.apply(cabin);
    return p.distanceTo(start)>0.02&&outside.distanceTo(copy)<1e-6&&cabin.distanceTo(cabinStart)<1e-6;
  }));
  await page.evaluate(()=>{__game.player.pitch=-0.87;__game.player.yaw=-0.15;});await page.waitForTimeout(100);
  await page.keyboard.down('KeyW');await page.waitForTimeout(550);await page.keyboard.up('KeyW');
  check('Player can walk into the released full-size footprint',await page.evaluate(()=>__game.player.pos.z<1.3&&__game.player.pos.z>0.4));
  await page.evaluate(()=>{const g=__game,d=g.truck.root.position.clone().sub(g.camera.position);g.player.yaw=Math.atan2(-d.x,-d.z);g.player.pitch=Math.atan2(d.y+0.11,Math.hypot(d.x,d.z));});
  await page.waitForTimeout(250);await page.screenshot({path:`${OUT}/gru-miniature.png`});
  await page.click('#btn-ray');await page.waitForTimeout(700);
  check('Repeated hits cannot shrink again or queue duplicate complaints',await page.evaluate(()=>__game.gru.hits===1&&Math.abs(__game.gru.scale-0.12)<1e-6&&__game.dialogue.queue.filter(q=>q.id==='g_call').length<=1));
  await page.click('#btn-pause');const paused=await snapshot(page);await page.waitForTimeout(350);
  check('Pause suspends audio and ray controls',await page.evaluate(()=>__game.audio.ctx.state==='suspended'&&!__game.gru.fire()&&!__game.input.enabled));
  await page.click('#btn-resume');
  await page.waitForFunction(()=>__game.gru.reactionComplete&&!__game.introActive&&__game.gru.reactionT>=8&&!__game.dialogue.speaking&&!__game.dialogue.queue.length&&!__game.dialogue._gapTimer,null,{timeout:60000});
  check('Miniature persists through remaining dialogue and scripts',await page.evaluate(()=>__game.truck.root.scale.x===0.12));
  check('The miniature argument lasts at least 26 seconds and uses all four extra source clips',await page.evaluate(()=>{
    const g=__game,ids=voiceLog.map(v=>v.id);
    return g.gru.reactionComplete&&g.dialogue.now()>=g.gru.reactionSpeechUntil&&['g_name','g_never_heard','g_report_call','g_report_lock'].every(id=>ids.includes(id));
  }));
  check('Gru stays anchored to the seat after shrinking and continued gestures',await page.evaluate(()=>__game.grandpa.group.position.distanceTo({x:-0.10,y:0.98,z:0.4})<1e-6&&__game.animator.lean.side===0));
  check('Tiny Gru stays squeaky, fisherman replies stay natural, voices do not overlap',await page.evaluate(()=>maxVoices<=1&&voiceLog.some(v=>v.spatial&&v.rate>1.8)&&voiceLog.filter(v=>!v.spatial).every(v=>v.rate===1)),JSON.stringify(await page.evaluate(()=>({maxVoices,voiceLog}))));
  check('Replay controls appear after the reaction with first-person input live',await page.evaluate(()=>!__game.gru.replay.classList.contains('hidden')&&__game.input.enabled));
  await page.click('.gru-replay button');await page.waitForTimeout(200);
  const reset=await snapshot(page);
  check('Replay restores scale, mount, props, collision, input and dialogue',reset.scale.every(v=>v===1)&&reset.state==='mounted'&&reset.rod&&!reset.hand&&reset.rayParent==='rayMount'&&reset.hits===0&&reset.shots===0&&reset.dialogue==='g_who'&&reset.queue.length===0&&!reset.beam);
  check('Replay restores full-size voice pitch and source height',await page.evaluate(()=>__game.gru.voicePitch===1&&__game.dialogue.current.src.playbackRate.value===1&&__game.gru.voicePanner.positionY.value>1.45));
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>__game.gru.state==='held');await clickVehicle(page);await page.waitForTimeout(250);await page.keyboard.press('KeyR');await page.waitForTimeout(850);
  check('Restart during shrinking cancels its pending state',await page.evaluate(()=>__game.gru.scale===1&&__game.gru.shrinkT===null&&__game.gru.state==='mounted'&&__game.gru.sounds.size===0));
  await page.keyboard.press('KeyT');await page.waitForFunction(()=>__game.gru.scale<0.121,null,{timeout:20000});
  check('Showcase uses the same take, fire and hit effects',await page.evaluate(()=>__game.gru.shots===1&&__game.gru.hits===1&&__game.gru.state==='held'));
  await page.waitForTimeout(3500);await page.screenshot({path:`${OUT}/showcase-miniature.png`});
  await page.click('#btn-gru-control');check('Take Control restores manual look without resetting the miniature',await page.evaluate(()=>!__game.gru.showcase&&__game.gru.scale<0.121&&__game.input.enabled));
  await page.keyboard.press('KeyR');await page.keyboard.press('KeyT');await page.waitForFunction(()=>__game.gru.scale<0.121,null,{timeout:20000});
  check('Showcase can be replayed from a fresh state',await page.evaluate(()=>__game.gru.shots===1&&__game.gru.hits===1));
  await ctx.close();

  const mobile=await open({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const p=mobile.page;
  await ready(p);await p.tap('#btn-go');await p.waitForTimeout(400);
  const layout=await p.evaluate(()=>{const b=document.getElementById('btn-ray').getBoundingClientRect(),l=document.getElementById('ray-take-label').getBoundingClientRect();return {w:b.width,h:b.height,visible:b.bottom<=innerHeight&&b.right<=innerWidth,label:l.left>=0&&l.right<=innerWidth&&l.top>50};});
  check('Phone TAKE and label fit the viewport with usable targets',layout.w>=44&&layout.h>=44&&layout.visible&&layout.label,JSON.stringify(layout));
  await p.screenshot({path:`${OUT}/mobile-normal.png`});
  await p.tap('#btn-ray');await p.waitForFunction(()=>__game.gru.state==='held');
  check('Phone TAKE stows the rod and exposes FIRE',await p.locator('#btn-ray').textContent()==='FIRE'&&await p.evaluate(()=>!__game.rod.group.visible));
  // Real touch pointer movement, then a tap on the model (the same path used by a player).
  const b=await p.locator('#view').boundingBox();
  await p.dispatchEvent('#view','pointerdown',{pointerId:7,pointerType:'touch',clientX:b.x+b.width/2,clientY:b.y+b.height/2});
  await p.dispatchEvent('#view','pointermove',{pointerId:7,pointerType:'touch',clientX:b.x+b.width/2+15,clientY:b.y+b.height/2+28});
  await p.dispatchEvent('#view','pointerup',{pointerId:7,pointerType:'touch',clientX:b.x+b.width/2+15,clientY:b.y+b.height/2+28});
  check('A phone look drag never fires',await p.evaluate(()=>__game.gru.shots===0&&__game.player.pitch<-0.27));
  const target=await project(p,[-0.12,1.13,0.95]);await p.touchscreen.tap(target.x,target.y);
  await p.waitForFunction(()=>__game.gru.scale<0.121);
  check('Phone tap aims and hits the rendered vehicle',await p.evaluate(()=>__game.gru.hits===1));
  await p.evaluate(()=>{__game.player.pitch=-0.85;__game.player.yaw=-0.17;});await p.waitForTimeout(250);
  await p.screenshot({path:`${OUT}/mobile-miniature.png`});
  await p.setViewportSize({width:844,height:390});await p.waitForTimeout(250);
  check('Phone rotation preserves scale, hands and dialogue',await p.evaluate(()=>__game.gru.state==='held'&&__game.gru.scale<0.121&&__game.mode==='play'));
  await p.tap('#btn-reset');await p.waitForTimeout(250);check('Phone restart restores the mounted weapon',await p.evaluate(()=>__game.gru.state==='mounted'&&__game.gru.scale===1));
  await mobile.ctx.close();
  const blocked=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await blocked.page.addInitScript(()=>{
    let touched=false;addEventListener('pointerdown',e=>{if(e.isTrusted)touched=true;},true);
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {constructor(...a){super(...a);this.suspend();}resume(){return touched?super.resume():Promise.resolve();}};
  });
  await ready(blocked.page,'fisherman.html?skin=gru&showcase');await blocked.page.waitForTimeout(600);
  check('Autoplay-blocked showcase waits for conversation and offers sound control',await blocked.page.evaluate(()=>__game.gru.showcase.time===0&&__game.gru.state==='mounted'&&!document.getElementById('btn-gru-sound').classList.contains('hidden')));
  await blocked.page.tap('#btn-gru-sound');await blocked.page.waitForTimeout(350);
  check('First touch starts the original audio and the showcase together',await blocked.page.evaluate(()=>__game.audio.running&&__game.gru.showcase.time>0&&__game.dialogue.current?.id==='g_who'));
  await blocked.ctx.close();
  check('No browser or WebGL errors',errors.length===0,JSON.stringify(errors));
} finally {
  fs.writeFileSync(`${OUT}/verification.json`,JSON.stringify({checks,errors},null,2));await browser.close();
}
console.log(`${checks.filter(c=>c.ok).length}/${checks.length} checks passed`);
if(checks.some(c=>!c.ok)||errors.length)process.exitCode=1;
