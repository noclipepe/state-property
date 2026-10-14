// UI-driven regression checks. Touch uses Chromium CDP, not a physical phone.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/',out=process.argv[3]||'check-out/god-ant-interactions';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']}),results=[],errors=[];
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const wait=(p,fn)=>p.waitForFunction(fn,null,{timeout:35000});
async function open(width,height){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width!==1280,isMobile:width!==1280});
  await context.addInitScript(()=>{let seed=78931;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};});
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(base+'god.html');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});await p.click('#btn-enter');await p.click('#btn-skip');await p.waitForTimeout(1700);
  return {context,p,cdp:await context.newCDPSession(p)};
}
async function grip(p,owner){
  return p.evaluate(owner=>{const g=__game,h=g.hand;return h.owner===owner&&h.ready(owner)&&h.fingers.slice(0,2).every((f,i)=>{
    const s=f.surface,attr=s.mesh.geometry.attributes.position,index=.75*s.rings*(s.sides+1)+s.sides*.75,point=h.target.clone().fromBufferAttribute(attr,index);
    // Measure the actual skin vertex at the pad, not just a helper transform.
    if(point.distanceTo(h.contacts[i])>.008)return false;
    if(owner==='truck'){const local=g.truck.body.worldToLocal(point);return Math.abs(Math.abs(local.z)-.985)<.008&&Math.abs(local.y-1.46)<.008;}
    const local=g.lake.plug.worldToLocal(point);return Math.abs(Math.abs(local.z)-.095)<.008&&Math.abs(local.y-.92)<.008&&Math.abs(local.x)<.008;
  });},owner);
}
async function reset(p){await p.click('#btn-reset');await p.waitForTimeout(120);}
async function pristine(p){return p.evaluate(()=>{const g=__game,a=g.giant;return a.state==='small'&&a.scale===2&&a.ant.crumb.visible&&a.ant.body.rotation.z===0&&a.forager.behavior==='idle'&&a.forager.food===null&&a.forager.fishEaten===0&&a.forager.pushedDistance===0&&g.weather.fish.every(f=>f.state==='off'&&!f.root.visible)&&g.hand.owner===null&&!g.vehicle.held&&g.input.pointer===null&&Math.hypot(g.truck.root.position.x+2.93,g.truck.root.position.z-7.35)<.01;});}
async function drain(p){await p.click('#btn-plug');for(let i=0;i<5;i++)await p.keyboard.press('ArrowUp');await wait(p,()=>__game.lake.state==='drained');}
async function park(p,x,z){await p.click('#btn-truck');await p.waitForTimeout(600);const point=await p.evaluate(({x,z})=>__game.project(__game.giant.position.clone().set(x,__game.lake.height(x,z),z)),{x,z});await p.mouse.click(point.x,point.y);await p.waitForTimeout(900);}
async function touch(cdp,type,point){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1,radiusX:7,radiusY:7,force:1}]:[]});}
try{
  const {context,p}=await open(1280,800);
  await p.click('#btn-truck');await p.waitForTimeout(700);check('actual finger pads pinch opposite vehicle sides',await grip(p,'truck'));await p.screenshot({path:out+'/truck-grip.png'});await p.keyboard.press('Escape');await p.waitForTimeout(700);
  await p.click('#btn-plug');await p.waitForTimeout(400);check('actual finger pads grip the solid ring arc',await grip(p,'plug'));await p.screenshot({path:out+'/plug-grip.png'});await reset(p);
  await p.click('#btn-ant');await wait(p,()=>__game.giant.forager.pushedDistance>.2);
  const push=await p.evaluate(()=>{const g=__game,a=g.giant;return{behavior:a.forager.behavior,distance:a.forager.pushedDistance,truck:g.truck.root.position.toArray(),driver:g.driver.group.parent===g.truck.body,wheels:g.truck.wheels.map(w=>w.angle),gap:g.vehicle.distance(a.position)};});
  check('grown ant reaches the real pickup and physically nudges it',push.behavior==='push'&&push.distance>.2&&Math.hypot(push.truck[0]+2.93,push.truck[2]-7.35)>.19&&push.driver&&push.wheels.some(w=>Math.abs(w)>.1),push);await p.screenshot({path:out+'/ant-pushing.png'});
  check('push keeps the fisherman, bucket and trees clear',await p.evaluate(()=>{const g=__game,v=g.vehicle;return v.distance(g.fisher.pos)>.63&&v.distance(g.bucketPosition)>.34&&g.world.trees.list.every(t=>v.distance(g.giant.position.clone().set(t[0],0,t[1]))>=.6);}));
  await p.click('#btn-truck');await p.waitForTimeout(700);const distance=await p.evaluate(()=>__game.giant.forager.pushedDistance);await p.waitForTimeout(500);
  check('grabbing during a push gives the player control and the ant backs off',await p.evaluate(n=>__game.vehicle.held&&__game.vehicle.lift>2&&__game.giant.forager.pushedDistance===n&&__game.giant.forager.behavior!=='push',distance));check('grip follows the ant-repositioned vehicle',await grip(p,'truck'));
  await p.keyboard.press('Escape');await reset(p);check('reset clears hand, ant behaviour and truck displacement',await pristine(p));
  await p.click('#btn-ant');await wait(p,()=>__game.giant.forager.behavior==='push');await reset(p);await p.waitForTimeout(1700);check('reset during pushing prevents a delayed nudge',await pristine(p));
  await p.click('#btn-weather');await wait(p,()=>__game.weather.state==='clear');await p.click('#btn-ant');await wait(p,()=>__game.giant.forager.behavior==='eating');
  await p.waitForTimeout(450);const meal=await p.evaluate(()=>{const g=__game,f=g.giant.forager.food,mouth=g.giant.ant.body.localToWorld(g.giant.position.clone().set(.044,.023,0));return {state:f?.state,gap:f?.root.position.distanceTo(mouth),scale:f?.root.scale.x,visible:f?.root.visible,crumb:g.giant.ant.crumb.visible};});
  check('ant finds rain fish, lifts it to its mandibles and chews',meal.state==='eating'&&meal.visible&&meal.gap<.2&&!meal.crumb,meal);await p.screenshot({path:out+'/ant-eating.png'});
  await wait(p,()=>__game.giant.forager.fishEaten>0);check('meal is consumed once and releases its pooled fish',await p.evaluate(()=>__game.giant.forager.fishEaten>0&&__game.weather.fish.some(f=>f.state==='off'&&!f.root.visible)));
  await wait(p,()=>__game.giant.forager.behavior==='eating');await reset(p);await p.waitForTimeout(1800);check('reset during chewing restores crumb and clears owned fish',await pristine(p));
  // Reverse order and shared, modified terrain: drain, park, grow, push, rain.
  await drain(p);await park(p,10,8);check('pickup can still be parked on drained bed',await p.evaluate(()=>__game.truck.root.position.y<-.2&&Math.hypot(__game.truck.root.position.x-10,__game.truck.root.position.z-8)<.2));
  await p.click('#btn-ant');await wait(p,()=>__game.giant.forager.pushedDistance>.15);check('ant adapts its push to the relocated pickup on the lake bed',await p.evaluate(()=>__game.giant.forager.pushedDistance>.15&&__game.truck.root.position.y<0));await p.screenshot({path:out+'/bed-push.png'});
  const contact=await p.evaluate(()=>{const g=__game,a=g.giant,mouth=a.ant.body.localToWorld(a.position.clone().set(.044,.023,0)),local=g.truck.body.worldToLocal(mouth),target=a.forager.contact;return {gap:Math.hypot(local.x-target.x,local.z-target.z),height:local.y,top:Math.abs(target.x)<1?1.65:1.02,lean:a.ant.body.rotation.z};});
  check('on the bank the ant bows to touch the body instead of pushing above it',contact.gap<.15&&contact.height<=contact.top+.09&&contact.height>contact.top-.6,contact);
  await p.click('#btn-weather');await wait(p,()=>__game.giant.forager.fishEaten>0);check('rain is edible with drained water and a moved pickup',await p.evaluate(()=>__game.lake.state==='drained'&&__game.giant.forager.fishEaten>0));
  await wait(p,()=>__game.weather.state==='clear');await p.click('#btn-weather');await wait(p,()=>__game.weather.spawned>20);check('repeat storm reuses fish at full size and never steals the current meal',await p.evaluate(()=>{const g=__game;return g.weather.fish.length===36&&g.weather.fish.filter(f=>f.state==='fall').every(f=>f.root.scale.x===6.5+(f.slot%3)*.8)&&(!g.giant.forager.food||g.giant.forager.behavior!=='eating'||g.giant.forager.food.state==='eating');}));
  await reset(p);await context.close();
  for(const [width,height] of [[390,844],[844,390]]){
    const {context,p,cdp}=await open(width,height);await p.tap('#btn-truck');await p.waitForTimeout(650);check(`${width}: touch grip has matching contact points`,await grip(p,'truck'));await p.screenshot({path:`${out}/${width}-grip.png`});
    const point=await p.evaluate(()=>__game.project(__game.truck.root.position));await touch(cdp,'touchStart',{x:point.x,y:point.y});await touch(cdp,'touchCancel');await p.waitForTimeout(800);check(`${width}: cancelled touch releases held hand and truck`,await p.evaluate(()=>!__game.vehicle.held&&!__game.hand.root.visible&&__game.input.pointer===null));
    await reset(p);await p.tap('#btn-ant');await wait(p,()=>__game.giant.forager.pushedDistance>.2);check(`${width}: grown ant pushes after touch activation`,await p.evaluate(()=>__game.giant.scale===45&&__game.giant.forager.pushedDistance>.2));
    await p.tap('#btn-weather');await wait(p,()=>__game.giant.forager.fishEaten>0);check(`${width}: ant eats fallen fish after touch storm`,await p.evaluate(()=>__game.giant.forager.fishEaten>0));
    await p.tap('#btn-reset');check(`${width}: reset clears every autonomous action`,await pristine(p));await context.close();
  }
  check('no browser or shader errors',errors.length===0,errors);
}catch(e){check('test completes',false,e.stack);}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors,physicalAndroid:false},null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
