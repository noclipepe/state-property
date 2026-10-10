// Gameplay captures using the actual showcase interactions and unchanged 9:16 camera.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=(process.argv[2]||'http://localhost:8090/').replace(/\/?$/,'/');
const out='check-out/gru';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:540,height:960}});
page.on('pageerror',e=>console.error(e.message));
await page.goto(base+'fisherman.html?skin=gru&showcase');
await page.waitForFunction(()=>window.__ready&&__game.gru.showcase.time>0.7);
const staging=await page.evaluate(async()=>{
  const T=await import('/vendor/three/three.module.js'),g=__game,head=new T.Box3().setFromObject(g.grandpa.meshes.head,true);
  return {vehicle:g.vehicleMeasurements,head:{min:head.min.toArray(),max:head.max.toArray()},camera:g.camera.position.toArray(),fov:g.camera.fov};
});
fs.writeFileSync(`${out}/fullsize-staging.json`,JSON.stringify(staging,null,2));
await page.screenshot({path:`${out}/showcase-normal.png`});
await page.waitForFunction(()=>__game.gru.state==='held'&&__game.gru.shots===0);
await page.screenshot({path:`${out}/held-ray.png`});
await page.waitForFunction(()=>__game.gru.reactionT>4.0);
await page.screenshot({path:`${out}/showcase-miniature.png`});
await page.evaluate(()=>__game.gru.stopShowcase());
// Walk to an overview with the same eye height, rather than changing the camera lens.
await page.evaluate(()=>{__game.reset({intro:false});__game.player.setPose({x:-5.2,z:7.5,yaw:-0.605,pitch:-0.08});});
await page.waitForTimeout(300);
await page.screenshot({path:`${out}/vehicle-overview.png`});
await page.evaluate(()=>__game.player.setPose({x:-0.68,z:1.55,yaw:-0.42,pitch:-0.34}));
await page.waitForTimeout(450);
await page.screenshot({path:`${out}/cabin-interior.png`});
console.log('Captured normal vehicle, held ray, miniature and walkable overview.');
await browser.close();
