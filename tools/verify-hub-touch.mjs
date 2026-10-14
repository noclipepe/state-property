// Native Chromium touch input: no scrollLeft assignments, scrollIntoView or mouse drags.
// node tools/verify-hub-touch.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';

const BASE=(process.argv[2]||'http://127.0.0.1:8095/').replace(/\/?$/,'/');
const out=process.argv[3]||'check-out/hub-touch';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const results=[],errors=[],measurements=[];
const ids=['fisherman','driver','fish','ant','god'];
const check=(name,ok,detail={})=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);};
async function mobile(width=390,height=844){
  const context=await browser.newContext({viewport:{width,height},screen:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true,
    userAgent:`Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Mobile Safari/537.36`});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__pageshowPersisted=false;addEventListener('pageshow',e=>{window.__pageshowPersisted=e.persisted;});});
  return {context,page,cdp:await context.newCDPSession(page)};
}
async function load(p,url=BASE){await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__hubReady);await p.evaluate(()=>document.fonts.ready);}
async function drag(t,a,b,{steps=12,interval=16,pause=100}={}){
  await t.cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y,id:1}]});
  for(let i=1;i<=steps;i++){
    await t.cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/steps,y:a.y+(b.y-a.y)*i/steps,id:1}]});
    if(interval)await t.page.waitForTimeout(interval);
  }
  // Stop at the finger position; avoid flinging past an entire card during assertions.
  if(pause)await t.page.waitForTimeout(pause);
  await t.cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await t.page.waitForTimeout(260);
  await t.page.waitForFunction(()=>!document.querySelector('.cards')?.classList.contains('is-settling'));
}
async function revealVertically(t,selector){
  // Tall photo-first cards may need a vertical finger swipe before PLAY is visible.
  for(let i=0;i<8;i++){
    const move=await t.page.evaluate(selector=>{
      const r=document.querySelector(selector).getBoundingClientRect(),rail=document.querySelector('.cards').getBoundingClientRect();
      const delta=r.bottom>innerHeight-12?r.bottom-innerHeight+12:r.top<12?r.top-12:0;
      if(!delta)return null;
      const x=(Math.max(8,rail.left)+Math.min(innerWidth-8,rail.right))/2;
      const y=delta>0?Math.min(innerHeight-16,rail.bottom-12):Math.max(16,rail.top+12);
      return {x,y,end:Math.max(16,Math.min(innerHeight-16,y-delta-Math.sign(delta)*24))};
    },selector);
    if(!move)return;
    await drag(t,move,{x:move.x,y:move.end});
  }
  throw Error(`Could not reveal ${selector} by vertical touch`);
}
async function metrics(p){return p.evaluate(()=>{
  const info=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{tag:e.tagName,cls:e.className,game:e.dataset.game,width:r.width,height:r.height,x:r.x,y:r.y,
    clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,
    overflow:s.overflow,touchAction:s.touchAction,position:s.position,minWidth:s.minWidth,overscroll:s.overscrollBehavior};};
  const rail=document.querySelector('.cards'),rr=rail.getBoundingClientRect();
  return {url:location.href,x:scrollX,y:scrollY,left:rail.scrollLeft,max:rail.scrollWidth-rail.clientWidth,
    parents:[document.documentElement,document.body,document.querySelector('.hub'),rail].map(info),
    cards:[...rail.children].map(info),visible:[...rail.children].filter(c=>{
      const r=c.querySelector('.btn-play').getBoundingClientRect();
      return r.left>=Math.max(0,rr.left)&&r.right<=Math.min(innerWidth,rr.right)&&r.top>=0&&r.bottom<=innerHeight;
    }).map(c=>c.dataset.game)};
});}
async function swipe(t,area='image',direction='left',distance=Infinity,options){
  const a=await t.page.evaluate(({area,direction,distance})=>{
    const rail=document.querySelector('.cards').getBoundingClientRect();
    const selector=area==='image'?'.card-img':area==='play'?'.btn-play':'.card-title';
    const candidates=[...document.querySelectorAll(`.cards ${selector}`)].map(e=>{
      const r=e.getBoundingClientRect(),left=Math.max(rail.left+4,8,r.left),right=Math.min(rail.right-4,innerWidth-8,r.right);
      return {e,left,right,y:Math.max(10,Math.min(innerHeight-10,(r.top+r.bottom)/2)),width:right-left,top:r.top,bottom:r.bottom};
    }).filter(r=>r.width>25&&r.top<innerHeight-10&&r.bottom>10).sort((a,b)=>b.width-a.width);
    const r=candidates[0];if(!r)return null;
    const x=direction==='left'?r.right-5:r.left+5,hit=document.elementFromPoint(x,r.y);
    const limit=direction==='left'?Math.max(8,rail.left+6):Math.min(innerWidth-8,rail.right-6);
    // Include Chromium's touch slop, but stop near the requested card instead of
    // skipping intermediate buttons with full-width gestures on every iteration.
    const travel=Math.min(Math.abs(limit-x),distance+24);
    return {x,y:r.y,hit:hit?.tagName,inside:!!hit?.closest(selector),end:x+(direction==='left'?-travel:travel)};
  },{area,direction,distance});
  if(!a?.inside)throw Error(`No uncovered ${area} swipe target: ${JSON.stringify(a)}`);
  await drag(t,a,{x:a.end,y:a.y},options);
}
function centered(m){
  const rail=m.parents.at(-1),center=rail.x+rail.width/2;
  return m.cards.reduce((a,b)=>Math.abs(a.x+a.width/2-center)<Math.abs(b.x+b.width/2-center)?a:b).game;
}
async function tour(t,area,label){
  const url=t.page.url(),seen=new Set();let count=0;
  for(const id of ids){
    count+=await seek(t,id,area);
    const m=await metrics(t.page);if(m.visible.includes(id))seen.add(id);
  }
  const m=await metrics(t.page);m.visible.forEach(id=>seen.add(id));
  check(`${label}: ${area} swipes reach all five PLAY buttons`,ids.every(id=>seen.has(id))&&m.max>0,{seen:[...seen],swipes:count,left:m.left,max:m.max});
  check(`${label}: swipe does not launch a game`,t.page.url()===url);
  return m;
}
async function seek(t,id,area='text'){
  await revealVertically(t,`[data-game=${id}] .btn-play`);
  for(let i=0;i<32;i++){
    const m=await metrics(t.page);if(m.visible.includes(id))return i;
    const distance=await t.page.locator(`[data-game=${id}]`).evaluate(e=>{
      const rail=e.parentElement,r=rail.getBoundingClientRect();
      const target=rail.scrollLeft+e.getBoundingClientRect().left-r.left-4;
      return Math.max(0,Math.min(rail.scrollWidth-rail.clientWidth,target))-rail.scrollLeft;
    });
    await swipe(t,area,distance<0?'right':'left',Math.abs(distance));
  }
  throw Error(`Could not reach ${id} by touch`);
}
async function tapPlay(t,id){
  await seek(t,id);const r=await t.page.locator(`[data-game=${id}] .btn-play`).boundingBox();
  await t.page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);
  await t.page.waitForURL(new RegExp(`${id}\\.html`));await t.page.waitForFunction(()=>window.__ready,null,{timeout:90000});
}
let cacheServer;
try{
  for(const [w,h] of [[320,568],[360,800],[390,844],[412,915],[568,320],[800,360],[844,390],[915,412]]){
    const t=await mobile(w,h);await load(t.page);const before=await metrics(t.page);
    check(`${w}×${h}: no page overflow or oversized card`,before.parents[0].scrollWidth<=w&&before.cards.every(c=>c.width<=before.parents.at(-1).clientWidth&&c.scrollWidth<=c.clientWidth+1));
    const rail=before.parents.at(-1),visible=before.cards.filter(c=>Math.min(c.x+c.width,rail.x+rail.width)-Math.max(c.x,rail.x)>12);
    check(`${w}×${h}: first card is centered with neighbours on both sides`,centered(before)==='fisherman'&&visible.length>=3);
    await swipe(t,'image','right',40);
    check(`${w}×${h}: short right swipe immediately wraps to GOD`,centered(await metrics(t.page))==='god');
    await swipe(t,'image','left',40);
    check(`${w}×${h}: short left swipe wraps back to Fisherman`,centered(await metrics(t.page))==='fisherman');
    if(w===390){
      const tinyPoint=await t.page.locator('[data-game=fisherman] .card-img').boundingBox();
      const start={x:tinyPoint.x+tinyPoint.width/2,y:tinyPoint.y+tinyPoint.height/2};
      await drag(t,start,{x:start.x+16,y:start.y},{steps:2,interval:20});
      check('a deliberate 16px swipe is enough to attract the next card',centered(await metrics(t.page))==='god');
      await t.page.evaluate(()=>{
        document.addEventListener('touchend',()=>{
          const rail=document.querySelector('.cards'),card=document.querySelector('[data-game=fisherman]');
          const gap=()=>{const r=rail.getBoundingClientRect(),c=card.getBoundingClientRect();return Math.abs(c.left+c.width/2-r.left-rail.clientWidth/2);};
          window.__snapProbe={from:gap()};setTimeout(()=>{window.__snapProbe.remaining=gap();},130);
        },{capture:true,once:true});
      });
      const tinyBack=await t.page.locator('[data-game=god] .card-title').boundingBox();
      const back={x:tinyBack.x+tinyBack.width/2,y:tinyBack.y+tinyBack.height/2};
      await drag(t,back,{x:back.x-16,y:back.y},{steps:2,interval:20});
      const snap=await t.page.evaluate(()=>window.__snapProbe);
      check('stronger attraction covers most of the distance in 130ms and centers cleanly',snap.from>200&&snap.remaining<snap.from*.12&&centered(await metrics(t.page))==='fisherman',snap);
      for(const direction of ['left','right']){
        const seen=[];
        for(let i=0;i<10;i++){await swipe(t,i%2?'text':'image',direction,40);seen.push(centered(await metrics(t.page)));}
        const expected=direction==='left'?['driver','fish','ant','god','fisherman']:['god','ant','fish','driver','fisherman'];
        check(`two full loops ${direction}: every short swipe advances exactly one card`,seen.every((id,i)=>id===expected[i%5]),{seen});
      }
      check('looping keeps only five real cards and one skin picker',await t.page.locator('.card').count()===5&&await t.page.locator('#choose-skin').count()===1);
      await swipe(t,'image','left',230,{steps:4,interval:0,pause:0});
      check('a fast swipe advances several cards', ['fish','ant'].includes(centered(await metrics(t.page))));
      await load(t.page);
      await t.page.emulateMedia({reducedMotion:'reduce'});await swipe(t,'image','right',40);
      check('reduced motion still supports the infinite loop',centered(await metrics(t.page))==='god');
      await t.page.emulateMedia({reducedMotion:'no-preference'});await load(t.page);
    }
    for(const area of ['image','text']){if(area==='text')await load(t.page,BASE+'?text-swipe');await tour(t,area,`${w}×${h}`);}
    await t.page.screenshot({path:`${out}/${w}x${h}.png`});
    const url=t.page.url();await swipe(t,'play','right');check(`${w}×${h}: dragging PLAY does not activate it`,t.page.url()===url);
    measurements.push({viewport:[w,h],before,after:await metrics(t.page)});
    await t.context.close();
  }
  // A short portrait page must pass vertical gestures from either card region to html.
  for(const area of ['image','text']){
    const t=await mobile(320,360);await load(t.page);
    const selector=`[data-game=fisherman] ${area==='image'?'.card-img':'.card-title'}`;await revealVertically(t,selector);
    const before=await metrics(t.page),r=await t.page.locator(selector).first().boundingBox();
    const x=r.x+r.width/2,y=Math.min(330,r.y+r.height/2);await drag(t,{x,y},{x,y:35});
    const m=await metrics(t.page);check(`short page: vertical swipe from ${area} reaches page scroll`,m.y>before.y+10,{scrollY:m.y,pageHeight:m.parents[0].scrollHeight});
    for(let i=0;i<3;i++)await drag(t,{x:160,y:300},{x:160,y:65});
    check(`short page: social links are reachable from ${area}`,await t.page.locator('.social').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1));
    await t.context.close();
  }
  for(const width of [320,412])for(const mode of ['pending','broken']){
    const t=await mobile(width,915);let release;const gate=new Promise(r=>release=r);
    await t.page.route('**/assets/brand/card-*.jpg',async route=>{if(mode==='pending'){await gate;await route.continue();}else await route.abort('failed');});
    await load(t.page);const before=await metrics(t.page);
    check(`${width} ${mode}: test actually has unavailable previews`,await t.page.locator('.card-img img').evaluateAll(imgs=>imgs.every(i=>i.naturalWidth===0)));
    await tour(t,'image',`${width} ${mode} previews`);release();
    if(mode==='pending')await t.page.waitForFunction(()=>[...document.querySelectorAll('.card-img img')].every(i=>i.complete&&i.naturalWidth>0));
    const after=await metrics(t.page);
    check(`${width} ${mode}: preview loading does not change card/rail size`,Math.abs(before.max-after.max)<1&&before.cards.every((c,i)=>Math.abs(c.width-after.cards[i].width)<1&&Math.abs(c.height-after.cards[i].height)<1));
    await t.context.close();
  }
  // Same browser context, genuine HTTP cache hits (Playwright routing disables caching).
  // This local proxy applies the project's production cache lifetimes to the source server.
  cacheServer=http.createServer(async(req,res)=>{
    try{const response=await fetch(new URL(req.url,BASE)),body=Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')||'application/octet-stream',
        'Cache-Control':/^\/(src|assets)\//.test(req.url)?'public, max-age=300':'no-cache'});res.end(body);
    }catch(e){res.writeHead(502);res.end(String(e));}
  });
  await new Promise(r=>cacheServer.listen(0,'127.0.0.1',r));
  {
    const t=await mobile(360,800);let hits=0;await t.cdp.send('Network.enable');t.cdp.on('Network.requestServedFromCache',()=>hits++);
    const url=`http://127.0.0.1:${cacheServer.address().port}/`;
    await load(t.page,url);await tour(t,'image','cold cache');
    await load(t.page,url+'?warm');await tour(t,'text','warm cache');check('warm load uses the real browser asset cache',hits>0,{hits});await t.context.close();
  }
  // Each real game loads and returns through its own menu; no game input handler should survive.
  {
    const t=await mobile();await load(t.page);
    for(const id of ids){
      await tapPlay(t,id);check(`${id}: ordinary PLAY tap launches the selected POV`,await t.page.evaluate(()=>!!window.__game));
      if(id==='fisherman'){await t.page.tap('#btn-go');await t.page.tap('#btn-pause');await t.page.tap('#btn-pause-games');}
      else if(id==='god'){await t.page.tap('#btn-enter');await t.page.tap('#btn-menu');}
      else {await t.page.tap('#btn-pause');await t.page.tap('#btn-games');}
      await t.page.waitForURL(url=>url.href===BASE||url.href===BASE+'index.html');await t.page.waitForFunction(()=>window.__hubReady);
      check(`${id}: return loads only the menu`,await t.page.evaluate(()=>!window.__game&&!document.querySelector('canvas')));
      await tour(t,'image',`return from ${id}`);
    }
    await tapPlay(t,'ant');await t.page.goBack({waitUntil:'domcontentloaded'});await t.page.waitForFunction(()=>window.__hubReady);
    const persisted=await t.page.evaluate(()=>window.__pageshowPersisted);await seek(t,'fisherman');await tour(t,'text','browser Back from Ant');
    check('browser Back clears the pressed PLAY state',await t.page.locator('.going').count()===0,{bfcacheRestored:persisted});
    await t.page.setViewportSize({width:844,height:390});await seek(t,'fisherman');await tour(t,'image','rotate to landscape');
    await t.page.setViewportSize({width:390,height:844});await seek(t,'fisherman');await tour(t,'text','rotate to portrait');await t.context.close();
  }
  {
    const p=await browser.newPage({viewport:{width:1280,height:800}});await load(p);const m=await metrics(p);
    check('desktop retains five fully visible cards',m.visible.length===5&&m.max===0&&m.parents[0].scrollWidth===1280,m);
    await p.screenshot({path:out+'/desktop.png'});await p.close();
  }
  check('no runtime errors',errors.length===0,errors);
}finally{
  cacheServer?.close();cacheServer?.closeAllConnections();await browser.close();
  fs.writeFileSync(out+'/report.json',JSON.stringify({results,measurements,errors},null,2));
}
if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
