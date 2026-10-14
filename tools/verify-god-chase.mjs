// Mouse and Chromium CDP touch regression for pursuing a hand-carried pickup.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/',out=process.argv[3]||'check-out/god-chase';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const results=[],errors=[];
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const wait=(p,fn)=>p.waitForFunction(fn,null,{timeout:35000});
try{
  for(const [width,height] of [[1280,800],[390,844],[844,390]]){
    const mobile=width!==1280,context=await browser.newContext({viewport:{width,height},hasTouch:mobile,isMobile:mobile});
    await context.addInitScript(()=>{let seed=78931;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};});
    const p=await context.newPage(),cdp=await context.newCDPSession(p);p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    const click=async id=>mobile?p.tap(id):p.click(id);
    let cursor;
    const down=async point=>{cursor=point;if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});else{await p.mouse.move(point.x,point.y);await p.mouse.down();}};
    const move=async(point,steps=12,delay=16)=>{const from=cursor;for(let i=1;i<=steps;i++){const x=from.x+(point.x-from.x)*i/steps,y=from.y+(point.y-from.y)*i/steps;if(mobile)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:1}]});else await p.mouse.move(x,y);await p.waitForTimeout(delay);}cursor=point;};
    const up=async(cancel=false)=>mobile?cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]}):p.mouse.up();
    const truckPoint=()=>p.evaluate(()=>{const g=__game;return g.project(g.truck.root.position.clone().add(g.giant.position.clone().set(0,1.7,0)));});
    const destination=(x,z)=>p.evaluate(({x,z})=>{const g=__game,v=g.giant.position.clone().set(x,0,z).sub(g.input.offset);v.y=g.lake.height(v.x,v.z);return g.project(v);},{x,z});
    await p.goto(base+'god.html');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});await click('#btn-enter');await click('#btn-skip');
    const plug=await p.evaluate(()=>__game.project(__game.lake.plug.position));await down(plug);await move({x:plug.x,y:plug.y-110});await up();await wait(p,()=>__game.lake.state==='drained');
    await p.evaluate(()=>{
      const g=__game,a=g.giant,update=a.update.bind(a);window.chaseProbe={frames:[]};
      a.update=(dt,time)=>{const before=a.position.clone();update(dt,time);if(a.state==='giant'){
        const step=a.position.clone().sub(before).setY(0).length();chaseProbe.grown??=g.time;if(step>.001)chaseProbe.walked??=g.time;
        if(g.vehicle.held)chaseProbe.frames.push({step,behavior:a.forager.behavior,gap:g.vehicle.distance(a.position)-a.radius});
      }};
    });
    // Grow and pick up the truck before growth completes, then keep holding it.
    await click('#btn-ant');await down(await truckPoint());await p.waitForTimeout(500);await move(await destination(9,8));
    await wait(p,()=>window.chaseProbe.walked!==undefined);
    const start=await p.evaluate(()=>({delay:chaseProbe.walked-chaseProbe.grown,held:__game.vehicle.held,behavior:__game.giant.forager.behavior}));
    check(`${width}: growth immediately pursues the held pickup`,start.delay===0&&start.held&&start.behavior==='truck',start);
    await p.evaluate(()=>{chaseProbe.frames=[];chaseProbe.start=__game.giant.position.toArray();});
    await move(await destination(12,8),50,25);
    const chase=await p.evaluate(()=>{const g=__game,s=chaseProbe,frames=s.frames;return {travel:Math.hypot(g.giant.position.x-s.start[0],g.giant.position.z-s.start[2]),moving:frames.filter(f=>f.step>.001).length/frames.length,minGap:Math.min(...frames.map(f=>f.gap)),held:g.vehicle.held,push:g.giant.forager.pushedDistance,truck:g.truck.root.position.toArray()};});
    check(`${width}: continuous dragging keeps the ant walking instead of restarting its wait`,chase.travel>1.2&&chase.moving>.8&&chase.held,chase);
    check(`${width}: pursuit respects clearance and never pushes an airborne truck`,chase.minGap>.1&&chase.push===0,chase);
    await p.screenshot({path:`${out}/${width}-chase.png`});await up(mobile);
    await wait(p,()=>__game.giant.forager.pushedDistance>.15);
    check(`${width}: release/cancel hands pursuit over to grounded pushing`,await p.evaluate(()=>!__game.vehicle.held&&__game.vehicle.lift===0&&__game.giant.forager.pushedDistance>.15));
    // Catch a second relocation after the ant is already touching the bumper.
    const newSpot=await p.evaluate(()=>{const g=__game,options=[];for(const x of [2,6,10,13])for(const z of [1.5,3.8,8,10]){
      const v=g.giant.position.clone().set(x,0,z),screen=g.project(v.clone().setY(g.lake.height(x,z)));
      if(g.vehicle.valid(v)&&screen.visible&&document.elementFromPoint(screen.x,screen.y)?.id==='view')options.push({x,z,d:v.clone().sub(g.giant.position).setY(0).length()});
    }return options.sort((a,b)=>b.d-a.d)[0];});
    await down(await truckPoint());await p.waitForTimeout(500);await move(await destination(newSpot.x,newSpot.z));
    await p.evaluate(()=>{chaseProbe.frames=[];chaseProbe.start=__game.giant.position.toArray();});await p.waitForTimeout(900);
    const again=await p.evaluate(()=>({travel:Math.hypot(__game.giant.position.x-chaseProbe.start[0],__game.giant.position.z-chaseProbe.start[2]),behavior:__game.giant.forager.behavior,held:__game.vehicle.held,truck:__game.truck.root.position.toArray()}));
    check(`${width}: grabbing again redirects the ant to the new pickup position`,again.travel>.6&&again.held&&again.behavior!=='push',again);
    await up();await click('#btn-reset');await p.waitForTimeout(1700);
    check(`${width}: Reset cancels pursuit and restores one small ant`,await p.evaluate(()=>__game.giant.state==='small'&&__game.giant.forager.behavior==='idle'&&__game.giant.forager.pushedDistance===0&&__game.giant.position.x===2.57&&!__game.vehicle.held));
    await context.close();
  }
  check('no browser errors',errors.length===0,errors);
}catch(e){check('test completes',false,e.stack);}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors,physicalAndroid:false},null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
