// A recorded production run through the same keyboard controller used by a player.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/';
const out='check-out/ant-recording';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:432,height:900},recordVideo:{dir:out,size:{width:432,height:900}}});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base+'ant.html');await page.waitForFunction(()=>window.__ready,null,{timeout:90000});
  await page.waitForTimeout(1500);await page.screenshot({path:out+'/01-argument.png'});
  await page.waitForTimeout(2800);await page.screenshot({path:out+'/02-breadcrumb.png'});
  let held=false,last=-3,stuck=0;const shots=new Set(),start=Date.now();
  while(Date.now()-start<65000){
    const s=await page.evaluate(()=>({mode:__game.mode,x:__game.player.x,boot:__game.hazards.bootDanger,rod:__game.hazards.rod.danger,pull:__game.hazards.pull.danger,crawled:__game.crawledUnder,checkpoint:__game.checkpoint,time:__game.time}));
    if(s.mode!=='play')break;
    const walking=!s.boot&&!s.rod&&!s.pull;
    if(walking!==held){await page.keyboard[walking?'down':'up']('KeyW');held=walking;}
    for(const [key,on] of [['03-boot-warning',s.boot],['04-rod-warning',s.rod],['05-truck-pull',s.pull],['06-leaf',s.x>.55],['07-underbody',s.crawled]])if(on&&!shots.has(key)){shots.add(key);await page.screenshot({path:out+'/'+key+'.png'});}
    if(walking&&Math.abs(s.x-last)<.001)stuck++;else stuck=0;
    if(stuck===8){await page.keyboard.down('KeyD');await page.waitForTimeout(550);await page.keyboard.up('KeyD');stuck=0;}
    last=s.x;await page.waitForTimeout(100);
  }
  await page.keyboard.up('KeyW');await page.waitForTimeout(2200);await page.screenshot({path:out+'/07-delivered.png'});
  const state=await page.evaluate(()=>({mode:__game.mode,time:__game.time,clips:Object.keys(__game.conv.played),pitch:__game.conv.clip?.src.playbackRate.value??1}));console.log(JSON.stringify({state,errors}));
  if(state.mode!=='complete'||errors.length)process.exitCode=1;
}finally{await context.close();await page.video().saveAs(out+'/delivery-run.webm');await browser.close();}
