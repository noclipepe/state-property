import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/',out=process.argv[3]||'check-out/god-atmosphere';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']}),results=[],errors=[];
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const wait=(p,fn)=>p.waitForFunction(fn,null,{timeout:20000});
async function screenshot(p,name){await p.evaluate(()=>{__game.paused=true;});await p.screenshot({path:`${out}/${name}.png`});await p.evaluate(()=>{__game.paused=false;});}
async function reset(p){await p.click('#btn-reset');await p.waitForTimeout(150);}
try{
 const p=await browser.newPage({viewport:{width:1280,height:800}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.goto(base+'god.html');await wait(p,()=>window.__ready);
 const levels=await p.evaluate(()=>Object.fromEntries(Object.entries(__game.audio.divineBuffers).map(([name,b])=>{const d=b.getChannelData(0);let energy=0,peak=0;for(const s of d){energy+=s*s;peak=Math.max(peak,Math.abs(s));}return [name,{rms:Math.sqrt(energy/d.length),peak,duration:b.duration,channels:b.numberOfChannels}];})));
 check('three stereo choir/chime buffers contain audible signal with headroom',Object.values(levels).every(b=>b.rms>.015&&b.peak>.4&&b.peak<.6&&b.channels===2),levels);
 await p.click('#btn-enter');await wait(p,()=>__game.introTime>.6);
 check('choir starts once as clouds form before ascent',await p.evaluate(()=>__game.audio.cueHistory.filter(c=>c.kind==='arrival').length===1&&__game.camera.position.y===2.2&&__game.audio.divineVoices.size===1));
 await p.click('#btn-reset');await p.waitForTimeout(200);check('reset during arrival stops choir including its reverb tail',await p.evaluate(()=>__game.audio.divineVoices.size===0&&__game.audio.effects.size===0));
 await p.click('#btn-truck');await p.waitForTimeout(600);await screenshot(p,'anatomical-hand');
 check('holding the truck produces one lift cue, not a per-frame loop',await p.evaluate(()=>__game.audio.cueHistory.filter(c=>c.kind==='lift').length===1));
 check('five smooth fingers and palm keep finite skin geometry while gripping',await p.evaluate(()=>__game.hand.fingers.length===5&&[__game.hand.skin,...__game.hand.fingers.map(f=>f.surface)].every(s=>[...s.mesh.geometry.attributes.position.array,...s.mesh.geometry.attributes.normal.array].every(Number.isFinite))));
 await p.keyboard.press('Escape');await p.waitForTimeout(200);check('putting pickup down has its own soft divine cue',await p.evaluate(()=>__game.audio.cueHistory.some(c=>c.kind==='land')));
 await reset(p);await p.click('#btn-plug');check('grasping plug has a cue without triggering drainage',await p.evaluate(()=>__game.audio.cueHistory.some(c=>c.kind==='grasp')&&__game.lake.state==='gripped'));
 const a=await p.evaluate(()=>__game.project(__game.lake.plug.position));await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x,a.y-100,{steps:10});await p.mouse.up();await wait(p,()=>__game.lake.state==='draining');
 check('actual extraction triggers divine sound with the drain',await p.evaluate(()=>__game.audio.cueHistory.some(c=>c.kind==='drain')));
 await reset(p);await p.click('#btn-ant');await wait(p,()=>__game.giant.elapsed>.75);
 const growthAudio=await p.evaluate(()=>({cues:__game.audio.cueHistory.filter(c=>c.kind==='grow'),active:[...__game.audio.divineVoices].map(v=>v.godCue),now:__game.audio.ctx.currentTime,elapsed:__game.giant.elapsed,state:__game.giant.state}));
 check('growth choir is synchronized with growth',growthAudio.cues.length===1&&growthAudio.active.includes('grow'),growthAudio);
 await screenshot(p,'ant-blessing');
 check('growing ant has a local halo, rays, sparkles and warm light',await p.evaluate(()=>{const b=__game.giant.blessing;return __game.giant.state==='growing'&&b.root.visible&&b.strength.value>.9&&b.light.intensity>6&&b.sparkles.material.opacity>.7&&b.root.position.distanceTo(__game.giant.position)<.01;}));
 await reset(p);check('reset during growth immediately clears glow and sound',await p.evaluate(()=>!__game.giant.blessing.root.visible&&__game.giant.blessing.light.intensity===0&&__game.audio.divineVoices.size===0));
 await p.click('#btn-ant');await wait(p,()=>__game.giant.state==='giant'&&!__game.giant.blessing.active);check('growth light fades away while giant state remains',await p.evaluate(()=>__game.giant.scale===45&&!__game.giant.blessing.root.visible&&__game.giant.blessing.light.intensity===0));
 const count=await p.evaluate(()=>__game.audio.cueHistory.filter(c=>c.kind==='grow').length);await p.keyboard.press('3');await p.waitForTimeout(120);check('repeated growth activation does not multiply lights or sounds',await p.evaluate(n=>__game.audio.cueHistory.filter(c=>c.kind==='grow').length===n&&!__game.giant.blessing.active,count));
 await p.click('#btn-weather');check('storm clouds receive a divine cue at activation',await p.evaluate(()=>__game.audio.cueHistory.some(c=>c.kind==='storm')));await wait(p,()=>__game.weather.burstAt!==null);
 check('fish-rain burst gets one cue, not one sound per fish',await p.evaluate(()=>__game.audio.cueHistory.filter(c=>c.kind==='fish-rain').length===1));
 await p.click('#btn-sound');await p.waitForTimeout(300);check('SOUND OFF mutes dialogue and the new effects together',await p.evaluate(()=>__game.audio.muted&&__game.audio.master.gain.value<.001));
 await reset(p);await p.click('#btn-sound');await p.click('#btn-ant');await p.click('#btn-weather');await p.click('#btn-truck');check('overlapping powers keep at most three choir tails',await p.evaluate(()=>__game.audio.divineVoices.size>0&&__game.audio.divineVoices.size<=3));
 await reset(p);await p.waitForTimeout(2000);check('reset cancels all overlapping tails and growth particles',await p.evaluate(()=>__game.audio.effects.size===0&&__game.audio.divineVoices.size===0&&!__game.giant.blessing.active));
 await p.click('#btn-ant');await p.click('#btn-menu');await wait(p,()=>window.__hubReady);await p.click('[data-game=god] .btn-play');await wait(p,()=>window.__ready);check('re-entry has no duplicate growth lights or choir playback',await p.evaluate(()=>__game.scene.children.filter(o=>o.name==='antDivineGrowth').length===1&&!__game.giant.blessing.active&&__game.audio.divineVoices.size===0));
 await p.close();
 const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base+'god.html');await wait(mobile,()=>window.__ready);await mobile.tap('#btn-enter');await mobile.tap('#btn-skip');await mobile.tap('#btn-ant');await wait(mobile,()=>__game.giant.elapsed>.85);await screenshot(mobile,'phone-blessing');
 check('touch activation shows the growth blessing in portrait',await mobile.evaluate(()=>__game.giant.blessing.root.visible&&__game.giant.blessing.strength.value>.8&&__game.project(__game.giant.position).visible));
 await mobile.tap('#btn-reset');await mobile.tap('#btn-truck');await mobile.waitForTimeout(650);await screenshot(mobile,'phone-hand');
 check('new hand keeps first-person perspective and usable pickup on phone',await mobile.evaluate(()=>__game.vehicle.held&&__game.vehicle.lift>2&&!__game.project(__game.hand.armEnd).visible));await mobile.close();
 check('no runtime or shader errors',errors.length===0,errors);
}catch(e){check('test completes',false,e.stack);}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors,physicalAndroid:false},null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
