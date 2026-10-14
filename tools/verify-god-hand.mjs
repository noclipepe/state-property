// Actual mouse/CDP touch gestures, not a physical Android test.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8095/',out=process.argv[3]||'check-out/god-hand';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']}),results=[],errors=[];
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
async function touch(cdp,type,p){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{...p,id:1,radiusX:7,radiusY:7,force:1}]:[]});}
async function start(width,height){const context=await browser.newContext({viewport:{width,height},hasTouch:width!==1280,isMobile:width!==1280}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.goto(base+'god.html');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});return {context,p,cdp:await context.newCDPSession(p)};}
async function point(p){return p.evaluate(()=>__game.project(__game.lake.plug.position));}
async function clean(p){await p.click('#btn-reset');await p.waitForTimeout(100);}
async function frame(p,name){await p.screenshot({path:`${out}/${name}.png`});}
try{
 const {context,p}=await start(1280,800);await p.click('#btn-enter');await p.waitForFunction(()=>__game.introTime>1.27);
 check('28 cloud banks gather before the camera rises',await p.evaluate(()=>__game.weather.clouds.length+__game.weather.arrivalClouds.length===28&&__game.weather.arrivalMaterial.opacity>.85&&__game.camera.position.y===2.2));await frame(p,'desktop-clouds');await p.waitForFunction(()=>__game.mode==='play');
 check('extra clouds clear the play area after arrival',await p.evaluate(()=>__game.weather.arrivalClouds.every(c=>!c.visible)));
 await p.click('#btn-plug');await p.waitForTimeout(500);check('button takes the ring with a hand without draining',await p.evaluate(()=>__game.lake.state==='gripped'&&__game.lake.level===.02&&__game.hand.ready('plug')));
 let a=await point(p);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x,a.y-30,{steps:12});await p.waitForTimeout(150);await frame(p,'desktop-plug-half');
 check('partial pull visibly lifts plug and fingers together, keeping water sealed',await p.evaluate(()=>__game.lake.pull>.25&&__game.lake.pull<.6&&__game.lake.level===.02&&__game.hand.target.distanceTo(__game.lake.plug.localToWorld(__game.hand.target.clone().set(0,.92,0)))<.01));
 await p.mouse.up();await p.waitForTimeout(400);check('unfinished pull reseats plug and retracts hand',await p.evaluate(()=>__game.lake.state==='full'&&__game.lake.pull<.01&&__game.hand.owner===null&&!__game.hand.root.visible));
 a=await point(p);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x,a.y-100,{steps:8});await p.mouse.up();await p.waitForFunction(()=>__game.lake.state==='draining');
 // Read the extraction before taking a screenshot, which can take long enough
 // for the live animation to set the plug back down on a busy GPU.
 check('quick full swipe extracts with the hand before draining starts',await p.evaluate(()=>__game.hand.owner==='plug'&&__game.lake.plug.position.y>2.4));await frame(p,'desktop-plug-extracted');
 await p.waitForFunction(()=>__game.lake.state==='drained');check('hand sets plug on bank and retracts after extraction',await p.evaluate(()=>!__game.hand.root.visible&&__game.hand.owner===null&&__game.lake.plug.position.x>15));
 await p.click('#btn-truck');await p.waitForTimeout(700);await frame(p,'desktop-truck');
 const pose=await p.evaluate(()=>{const g=__game,h=g.hand,c=g.camera.position;return {owner:h.owner,lift:g.vehicle.lift,armVisible:g.project(h.armEnd).visible,palmDistance:c.distanceTo(h.palm.position),tipDistance:c.distanceTo(h.indexTip),driver:g.driver.group.parent===g.truck.body};});
 check('first-person arm exits frame; giant palm is nearer than fingertips holding pickup',pose.owner==='truck'&&pose.lift>2&&!pose.armVisible&&pose.palmDistance<pose.tipDistance&&pose.driver,pose);
 await p.keyboard.press('Escape');await p.waitForTimeout(900);check('release retracts hand and settles truck',await p.evaluate(()=>!__game.hand.root.visible&&__game.vehicle.lift===0&&!__game.vehicle.held));
 await clean(p);await p.click('#btn-plug');await p.keyboard.press('ArrowUp');await p.waitForTimeout(350);await p.keyboard.press('r');check('reset clears active hand, partial pull and gesture',await p.evaluate(()=>__game.lake.state==='full'&&__game.lake.pull===0&&__game.hand.owner===null&&!__game.hand.root.visible&&__game.input.pointer===null));
 await p.keyboard.press('1');for(let i=0;i<5;i++)await p.keyboard.press('ArrowUp');await p.waitForFunction(()=>__game.lake.state==='draining');check('keyboard also performs an actual hand pull',await p.evaluate(()=>__game.hand.owner==='plug'&&__game.lake.pull>=.96));await context.close();
 for(const [width,height] of [[320,568],[390,844],[844,390]]){
   const {context,p,cdp}=await start(width,height);await p.click('#btn-enter');await p.click('#btn-skip');
   const label=await p.locator('#target-plug').boundingBox(),a={x:label.x+label.width/2,y:label.y+label.height/2};
   await touch(cdp,'touchStart',a);await p.waitForTimeout(300);await touch(cdp,'touchMove',{x:a.x,y:a.y-18});await p.waitForTimeout(120);await touch(cdp,'touchCancel');await p.waitForTimeout(400);
   check(`${width}×${height}: cancelled label swipe keeps lake full and releases hand`,await p.evaluate(()=>__game.lake.state==='full'&&__game.lake.level===.02&&!__game.hand.root.visible&&__game.input.pointer===null));
   await touch(cdp,'touchStart',a);await p.waitForTimeout(250);for(let i=1;i<=12;i++){await touch(cdp,'touchMove',{x:a.x,y:a.y-100*i/12});await p.waitForTimeout(16);}await touch(cdp,'touchEnd');await p.waitForFunction(()=>__game.lake.state==='draining');await frame(p,`${width}-plug`);
   check(`${width}×${height}: label supports one-finger hand extraction`,await p.evaluate(()=>__game.hand.owner==='plug'&&__game.hand.ready('plug')&&__game.lake.pull>=.96));
   await p.waitForFunction(()=>__game.lake.state==='drained');await p.tap('#btn-truck');await p.waitForTimeout(700);await frame(p,`${width}-truck`);
   check(`${width}×${height}: first-person truck grip stays usable`,await p.evaluate(()=>__game.vehicle.held&&__game.vehicle.lift>2&&__game.hand.owner==='truck'&&!__game.project(__game.hand.armEnd).visible));
   await p.tap('#btn-reset');check(`${width}×${height}: reset removes shared hand`,await p.evaluate(()=>!__game.hand.root.visible&&__game.hand.owner===null&&__game.lake.state==='full'));
   await context.close();
 }
 check('no runtime or shader errors',errors.length===0,errors);
}catch(e){check('test completes',false,e.stack);}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors,physicalAndroid:false},null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
