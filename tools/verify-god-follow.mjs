// Regression: immediate post-growth movement, body tracking, and two world voices.
// Gameplay uses browser input; Web Audio checks render the actual routing graph.
// Mobile coverage is Chromium touch emulation, not a physical Android device.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/',out=process.argv[3]||'check-out/god-follow';
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const results=[],errors=[];
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const wait=(p,fn,arg)=>p.waitForFunction(fn,arg,{timeout:35000});
async function open(width,height){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width!==1280,isMobile:width!==1280});
  await context.addInitScript(()=>{let seed=78931;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(base+'god.html');await wait(p,()=>window.__ready);await p.click('#btn-enter');await p.click('#btn-skip');
  return {context,p,cdp:await context.newCDPSession(p)};
}
async function probeGrowth(p){
  await p.evaluate(()=>{
    const g=__game,a=g.giant,update=a.update.bind(a);window.growthProbe={};
    a.update=(dt,time)=>{const before=a.position.clone();update(dt,time);if(a.state==='giant'){
      growthProbe.finished??=g.time;
      if(a.position.clone().sub(before).setY(0).length()>.001)growthProbe.moving??=g.time;
    }};
  });
}
async function growthResult(p,name){
  await wait(p,()=>window.growthProbe.moving!==undefined);
  const r=await p.evaluate(()=>({delay:growthProbe.moving-growthProbe.finished,behavior:__game.giant.forager.behavior}));
  check(name,r.delay===0,r);
}
async function spatial(p,name){
  const r=await p.evaluate(()=>{
    const g=__game,s=g.audio.speech.speakers,v=g.giant.position.clone();
    const gap=(who,point)=>v.set(s[who].panner.positionX.value,s[who].panner.positionY.value,s[who].panner.positionZ.value).distanceTo(point);
    return {fisherman:gap('fisherman',g.fisher.headWorld),driver:gap('driver',g.eyeWorld()),distinct:s.driver.panner!==s.fisherman.panner};
  });
  check(name,r.distinct&&r.fisherman<.06&&r.driver<.06,r);
}
async function facing(p,name){
  const r=await p.evaluate(()=>{const g=__game,f=g.fisher,d=g.eyeWorld().sub(f.pos).setY(0).normalize();return {dot:f.forward.dot(d),drift:f.pos.distanceTo(f.home),tracking:typeof f.yawTarget==='function'};});
  check(name,r.dot>.995&&r.drift===0&&r.tracking,r);
}
async function point(p,x,z){return p.evaluate(({x,z})=>{const g=__game,v=g.giant.position.clone().set(x,0,z).sub(g.input.offset);v.y=g.lake.height(v.x,v.z);return g.project(v);},{x,z});}
async function truckPoint(p){return p.evaluate(()=>{const g=__game;return g.project(g.truck.root.position.clone().add(g.giant.position.clone().set(0,1.7,0)));});}
async function park(p,x,z){const a=await truckPoint(p);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.waitForTimeout(650);const b=await point(p,x,z);await p.mouse.move(b.x,b.y,{steps:16});await p.mouse.up();await p.waitForTimeout(1400);}
async function drain(p){await p.click('#btn-plug');for(let i=0;i<5;i++)await p.keyboard.press('ArrowUp');await wait(p,()=>__game.lake.state==='drained');}
try{
  const {context,p}=await open(1280,800);
  // Keep the actual source running and verify that the same recording switches
  // emitter at its own audio-clock cues, including very short interjections.
  await p.evaluate(()=>{
    const g=__game,frame=g.frame.bind(g);window.voiceProbe=[];
    g.frame=dt=>{frame(dt);const cue=g.conv.cue,t=g.conv.elapsed;
      if(cue&&t>cue.t0+.09&&t<cue.t1-.09){const s=g.audio.speech.speakers;
        voiceProbe.push({who:cue.speaker,t,driver:s.driver.gain.gain.value,fisherman:s.fisherman.gain.gain.value});}
    };
  });
  await wait(p,()=>__game.conv.elapsed>8.25);
  const voices=await p.evaluate(()=>voiceProbe);
  check('short original replies use the correct emitter on the audio clock',
    ['driver','fisherman'].every(w=>voices.some(v=>v.who===w))&&voices.every(v=>v[v.who]>.99&&v[v.who==='driver'?'fisherman':'driver']<.01),{samples:voices.length});
  check('one continuous original recording keeps its full duration',await p.evaluate(()=>__game.audio.dialogueSource===__game.conv.clip.src&&__game.conv.clip.src.buffer.duration>61&&__game.conv.clip.line.duration>61));
  await spatial(p,'each stationary voice is at its own character');
  await p.click('#btn-reset');await p.waitForTimeout(450);
  check('Reset starts the driver again and cancels old reply automation',await p.evaluate(()=>__game.conv.elapsed<1&&__game.audio.speech.speakers.driver.gain.gain.value>.99&&__game.audio.speech.speakers.fisherman.gain.gain.value<.01));
  await p.click('#btn-sound');await p.waitForTimeout(200);check('mute still controls both voices',await p.evaluate(()=>__game.audio.master.gain.value<.01));await p.click('#btn-sound');

  await probeGrowth(p);await p.click('#btn-ant');await growthResult(p,'default growth immediately flows into the first walking step');
  await wait(p,()=>__game.giant.forager.pushedDistance>.3);await facing(p,'fisherman tracks a truck pushed by the giant ant');await spatial(p,'voices follow the driver during the ant push');
  await p.click('#btn-reset');await park(p,2,3.8);
  check('actual mouse input relocates the pickup',await p.evaluate(()=>Math.hypot(__game.truck.root.position.x-2,__game.truck.root.position.z-3.8)<.1));
  await facing(p,'fisherman turns his body to a newly parked truck without walking');await spatial(p,'relocated driver voice follows the cab, fisherman stays on the bank');
  await p.screenshot({path:out+'/fisherman-facing-truck.png'});
  await p.click('#btn-truck');await p.waitForTimeout(1100);await spatial(p,'driver voice rises with the held truck');await p.keyboard.press('Escape');

  await p.click('#btn-reset');await drain(p);await park(p,10,8);
  await facing(p,'fisherman also tracks the truck on the drained lake bed');await spatial(p,'driver voice descends to the lake bed with the cab');
  await p.evaluate(()=>window.growthProbe={});await p.click('#btn-ant');await growthResult(p,'growth beside the relocated truck has no stale-target delay');
  await p.click('#btn-reset');await p.click('#btn-ant');await wait(p,()=>__game.giant.state==='growing');await p.click('#btn-reset');await p.waitForTimeout(2100);
  check('Reset during growth prevents a delayed walk',await p.evaluate(()=>__game.giant.state==='small'&&__game.giant.forager.behavior==='idle'&&__game.giant.position.x===2.57));
  await p.evaluate(()=>window.growthProbe={});await p.click('#btn-ant');await growthResult(p,'growth after an interrupted attempt still walks immediately');
  await p.click('#btn-reset');await facing(p,'Reset restores tracking toward the original truck');await p.waitForTimeout(450);await spatial(p,'Reset restores both emitter locations');

  // Render isolated test audio through the production routing class: opposite
  // sources must produce opposite stereo bias, and reset must cancel future cues.
  const rendered=await p.evaluate(async()=>{
    const {SpatialDialogue}=await import('./src/god/spatial-dialogue.js');
    async function render(reset){
      const c=new OfflineAudioContext(2,48000*3,48000),input=c.createGain(),router=new SpatialDialogue(c,input,c.destination,c.createPanner());
      router.position('driver',{x:-4,y:0,z:-3});router.position('fisherman',{x:4,y:0,z:-3});
      const tone=c.createOscillator();tone.frequency.value=440;tone.connect(input);tone.start();
      router.schedule({duration:3,cues:[{t0:.1,t1:.8,speaker:'driver'},{t0:1,t1:1.8,speaker:'fisherman'},{t0:2.1,t1:2.8,speaker:'driver'}]},0);
      const stopped=reset?c.suspend(.5):null,promise=c.startRendering();
      if(stopped){await stopped;router.reset();await c.resume();}
      const b=await promise,rms=(ch,t)=>{const data=b.getChannelData(ch),start=Math.round(t*48000),count=9600;let sum=0;for(let i=start;i<start+count;i++)sum+=data[i]*data[i];return Math.sqrt(sum/count);};
      return [.3,1.3,2.3].map(t=>({left:rms(0,t),right:rms(1,t)}));
    }
    return {normal:await render(false),reset:await render(true)};
  });
  check('rendered sound comes from the left driver, right fisherman, then left driver',rendered.normal.every((r,i)=>i===1?r.right>r.left*1.5:r.left>r.right*1.5),rendered.normal);
  check('Reset cancels future speaker changes in rendered audio',rendered.reset.every(r=>r.left>r.right*1.5),rendered.reset);
  await context.close();

  for(const [width,height] of [[390,844],[844,390]]){
    const {context,p,cdp}=await open(width,height);await probeGrowth(p);
    await p.tap('#btn-ant');await growthResult(p,`${width}: touch-grown ant walks immediately`);await p.tap('#btn-reset');
    const a=await truckPoint(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y,id:1}]});
    await p.waitForTimeout(650);const b=await point(p,2,3.8);
    for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12,id:1}]});await p.waitForTimeout(16);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await p.waitForTimeout(1300);
    check(`${width}: touch placement and cancellation settle the truck`,await p.evaluate(()=>!__game.vehicle.held&&__game.vehicle.lift===0&&Math.hypot(__game.truck.root.position.x-2,__game.truck.root.position.z-3.8)<.1));
    await facing(p,`${width}: body turns to the touched truck position`);await spatial(p,`${width}: both voice positions follow in touch layout`);
    await p.screenshot({path:`${out}/${width}-tracking.png`});await context.close();
  }
  check('no browser errors',errors.length===0,errors);
}catch(e){check('test completes',false,e.stack);}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors,physicalAndroid:false},null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
