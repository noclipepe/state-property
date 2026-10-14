import { chromium } from 'playwright';
import fs from 'node:fs';
const out=process.env.OUT||'check-out/god',base=process.env.BASE||'http://127.0.0.1:8095/';fs.mkdirSync(out,{recursive:true});const errors=[];
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
try {
 const page=await browser.newPage({viewport:{width:Number(process.env.W||1280),height:Number(process.env.H||800)},hasTouch:process.env.TOUCH==='1',isMobile:process.env.TOUCH==='1'});
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,1500));});
 await page.goto(base+'god.html');await page.waitForFunction(()=>window.__ready,null,{timeout:90000});
 await page.click('#btn-enter');
 for(const [name,t] of [['ordinary',.15],['clouds',1.3],['ascent',2.8],['play',4.5]]){
  await page.waitForFunction(t=>__game.introTime>=t||__game.mode==='play',t);await page.evaluate(()=>{__game.paused=true;});await page.screenshot({path:`${out}/${process.env.W||1280}-${name}.png`});
  if(name==='ordinary'&&!await page.evaluate(()=>{const g=__game,points=[g.eyeWorld(),g.fisher.headWorld];return points.every(point=>g.project(point).visible);}))throw Error('The close opening must frame both characters at the pickup');
  await page.evaluate(()=>{__game.paused=false;});
 }
 console.log(await page.evaluate(()=>({camera:__game.camera.position.toArray(),truck:__game.project(__game.truck.root.position),plug:__game.project(__game.lake.plug.position),ant:__game.project(__game.giant.position),dimensions:__game.truck.dims})));
 await page.click('#btn-plug');
 const plug=await page.evaluate(()=>__game.project(__game.lake.plug.position));await page.mouse.move(plug.x,plug.y);await page.mouse.down();await page.mouse.move(plug.x,plug.y-100,{steps:12});await page.mouse.up();
 await page.waitForFunction(()=>__game.lake.state==='drained');await page.click('#btn-ant');await page.waitForFunction(()=>__game.giant.state==='giant');await page.waitForTimeout(1800);await page.screenshot({path:`${out}/${process.env.W||1280}-drained-ant.png`});
 console.log(await page.evaluate(()=>({antState:__game.giant.state,antScale:__game.giant.scale,antPosition:__game.giant.position.toArray()})));
 await page.click('#btn-weather');await page.waitForFunction(()=>__game.weather.elapsed>=4.2);await page.screenshot({path:`${out}/${process.env.W||1280}-storm.png`});
 await page.click('#btn-truck');await page.waitForTimeout(700);
 if(!await page.evaluate(()=>__game.vehicle.held&&__game.vehicle.lift>2&&__game.lake.state==='drained'&&__game.giant.scale===45&&__game.weather.spawned>12))throw Error('Power smoke check failed');
 await page.screenshot({path:`${out}/${process.env.W||1280}-all-powers.png`});
 if(process.argv.includes('--card')){
  await page.setViewportSize({width:640,height:400});await page.addStyleTag({content:'#hud{visibility:hidden}'});await page.waitForTimeout(100);await page.evaluate(()=>{__game.camera.zoom=1.25;__game.camera.updateProjectionMatrix();});await page.waitForTimeout(100);
  await page.screenshot({path:'assets/brand/card-god.jpg',type:'jpeg',quality:90});
 }
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: intro and all four powers rendered without browser errors');
}finally {await browser.close();}
