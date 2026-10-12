import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://localhost:8086/';
fs.mkdirSync('check-out/ant-mode',{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
try {
  const page=await browser.newPage({viewport:{width:432,height:900},deviceScaleFactor:1});
  page.on('pageerror',e=>console.log('ERROR',e.message));page.on('console',m=>{if(m.type()==='error')console.log('ERROR',m.text());});
  await page.goto(base+'ant.html');await page.waitForFunction(()=>window.__ready,null,{timeout:90000});
  await page.waitForTimeout(900);await page.screenshot({path:'check-out/ant-mode/opening.png'});
  console.log(await page.evaluate(()=>({mode:__game.mode,feet:__game.hazards.boots.map(b=>({origin:b.origin.toArray(),target:b.target.toArray(),sole:b.sole.toArray()})),camera:__game.camera.position.toArray(),yaw:__game.yaw,pitch:__game.pitch,calls:__game.renderer.info.render.calls})));
  await page.click('#btn-recenter');await page.waitForTimeout(450);await page.screenshot({path:'check-out/ant-mode/trail.png'});
  await page.keyboard.down('KeyW');await page.waitForTimeout(7200);await page.keyboard.up('KeyW');await page.screenshot({path:'check-out/ant-mode/boots.png'});
  console.log(await page.evaluate(()=>({mode:__game.mode,p:__game.player.toArray(),time:__game.time,boots:__game.hazards.boots.map(b=>({phase:b.phase,t:b.t})),frameTime:__game.frameTime})));
  if(process.argv.includes('--card')){
    await page.setViewportSize({width:720,height:450});await page.goto(base+'ant.html?shot&q=high');await page.waitForFunction(()=>window.__ready,null,{timeout:90000});
    await page.evaluate(()=>{__game.recenter();__game.pitch=-.24;__game.yaw=0;document.getElementById('hud').hidden=true;});await page.waitForTimeout(500);await page.screenshot({path:'assets/brand/card-ant.jpg',type:'jpeg',quality:90});
  }
} finally {await browser.close();}
