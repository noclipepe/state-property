import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/';
const out='check-out/ant-final';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
try {
  const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  p.on('pageerror',e=>console.error(e));
  await p.goto(base+'ant.html');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});
  await p.evaluate(()=>{__game.restart();__game.audio.setMuted(true);__game.paused=true;__game.ui.showPause(false);});
  const advance=async (name,until)=>{
    const data=await p.evaluate(({until})=>{
      const g=__game;g.paused=false;let count=0;
      while(count++<2400){
        const wait=g.hazards.bootDanger||g.hazards.rod.danger||g.hazards.pull.danger;
        g.input.stick={x:0,y:wait?0:-1};g.update(1/60);
        if(until==='opening'&&g.time>1)break;
        if(until==='trail'&&g.time>4.8)break;
        if(until==='boot'&&g.hazards.boots[0].t>1)break;
        if(until==='impact'&&g.hazards.boots[0].phase==='done'&&g.hazards.dustTime>.12)break;
        if(until==='rod'&&g.hazards.rod.t>1.85)break;
        if(until==='leaf'&&g.player.x>.55)break;
        if(until==='pull'&&g.hazards.pull.t>1.65)break;
        if(until==='under'&&g.player.x>.85&&g.hazards.pull.phase==='done')break;
        if(until==='end'&&g.mode==='complete'&&g.delivery>3.5)break;
      }
      g.ui.update();g.renderer.render(g.scene,g.camera);g.paused=true;
      return {count,time:g.time,mode:g.mode,p:g.player.toArray(),fisher:g.fisher.pos.toArray(),pull:g.hazards.pull.phase,crawled:g.crawledUnder,calls:g.renderer.info.render.calls};
    },{until});
    await p.screenshot({path:`${out}/${name}.png`});console.log(name,JSON.stringify(data));
  };
  for(const name of ['opening','trail','boot','impact','rod','pull','leaf','under','end'])await advance(name,name);
} finally {await browser.close();}
