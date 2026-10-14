// Actual browser input drives every power; evaluations below only measure state.
// Chromium CDP touch is emulation, not a physical Android device test.
// node tools/verify-god.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE=(process.argv[2]||'http://127.0.0.1:8095/').replace(/\/?$/,'/'),out=process.argv[3]||'check-out/god-verify';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const results=[],errors=[];
const check=(name,ok,detail)=>{results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
const wait=(p,fn,arg)=>p.waitForFunction(fn,arg,{timeout:20000});
async function open(context){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,400));});await p.goto(BASE+'god.html');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});return p;}
async function enter(p,skip=true){await p.click('#btn-enter');if(skip)await p.click('#btn-skip');await wait(p,()=>__game.mode==='play');}
async function reset(p){await p.click('#btn-reset');await p.waitForTimeout(120);}
async function baseline(p){return p.evaluate(()=>{const g=__game;return{mode:g.mode,water:g.lake.state,level:g.lake.level,truck:g.truck.root.position.toArray(),held:g.vehicle.held,lift:g.vehicle.lift,ant:g.giant.state,scale:g.giant.scale,weather:g.weather.state,fish:g.weather.fish.filter(f=>f.state!=='off').length,wind:g.lake.wind.value,input:g.input.pointer,hand:g.vehicle.hand.visible,effects:g.audio.effects.size};});}
function pristine(s){return s.mode==='play'&&s.water==='full'&&s.level===.02&&Math.abs(s.truck[0]+2.93)<.01&&Math.abs(s.truck[2]-7.35)<.01&&s.truck[1]===0&&!s.held&&!s.hand&&s.lift===0&&s.ant==='small'&&s.scale===2&&s.weather==='clear'&&s.fish===0&&s.wind===0&&s.input===null;}
async function truckPoint(p){return p.evaluate(()=>{const g=__game,point=g.truck.root.position.clone();point.y+=1.7;return g.project(point);});}
async function mouseGrab(p){const a=await truckPoint(p);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.waitForTimeout(650);}
async function pullPlug(p,cdp=null){const a=await p.evaluate(()=>__game.project(__game.lake.plug.position));if(cdp)await swipe(cdp,p,{x:a.x,y:a.y},{x:a.x,y:a.y-100});else{await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x,a.y-100,{steps:12});await p.mouse.up();}}
async function destination(p,x,z){return p.evaluate(({x,z})=>{const g=__game,v=g.truck.root.position.clone().set(x,0,z).sub(g.input.offset||{x:0,y:0,z:0});v.y=g.lake.height(v.x,v.z);return g.project(v);},{x,z});}
async function moveTruck(p,x,z){await mouseGrab(p);const b=await destination(p,x,z);await p.mouse.move(b.x,b.y,{steps:16});await p.mouse.up();await p.waitForTimeout(850);}
async function touch(cdp,type,points=[]){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,id:1,radiusX:7,radiusY:7,force:1}))});}
async function swipe(cdp,p,a,b){await touch(cdp,'touchStart',[a]);for(let i=1;i<=10;i++){await touch(cdp,'touchMove',[{x:a.x+(b.x-a.x)*i/10,y:a.y+(b.y-a.y)*i/10}]);await p.waitForTimeout(16);}await touch(cdp,'touchEnd');}

try{
 const context=await browser.newContext({viewport:{width:1280,height:800}}),p=await open(context);
 await p.click('#btn-enter');await wait(p,()=>__game.introTime>.15);const ordinary=await p.evaluate(()=>({y:__game.camera.position.y,cloud:__game.weather.cloudMaterial.opacity,mode:__game.mode}));await p.screenshot({path:out+'/01-ordinary.png'});
 await wait(p,()=>__game.introTime>=1.28);const clouds=await p.evaluate(()=>({y:__game.camera.position.y,cloud:__game.weather.cloudMaterial.opacity,glow:__game.weather.glow.material.uniforms.strength.value}));await p.screenshot({path:out+'/02-clouds.png'});
 check('clouds and golden light precede ascent',ordinary.y===2.2&&ordinary.cloud<.2&&Math.abs(clouds.y-2.2)<.02&&clouds.cloud>.85&&clouds.glow>1,{ordinary,clouds});
 await wait(p,()=>__game.mode==='play');check('continuous intro ends in an elevated view and enables all powers',await p.evaluate(()=>__game.introTime>=4.3&&__game.camera.position.y>15&&document.querySelectorAll('#powers button:enabled').length===4));
 check('full original argument and original characters are reused',await p.evaluate(()=>__game.clips.ant_argument.line.duration>60&&__game.audio.running&&!performance.getEntriesByType('resource').some(r=>/gru\.(json|bin)/.test(r.name))));
 await p.waitForTimeout(1700);await p.screenshot({path:out+'/03-play.png'});
 await pullPlug(p);await p.waitForTimeout(650);
 check('pulling the actual plug starts a whirlpool and lowers water',await p.evaluate(()=>__game.lake.state==='draining'&&__game.lake.vortex.visible&&__game.lake.level<.02));
 await reset(p);check('reset during draining restores the complete world without intro',pristine(await baseline(p)),await baseline(p));
 await p.click('#btn-plug');await p.waitForTimeout(500);check('PLUG button only grips the ring; water stays full until a pull',await p.evaluate(()=>__game.lake.state==='gripped'&&__game.lake.level===.02&&__game.hand.owner==='plug'&&__game.hand.ready('plug')));await pullPlug(p);await wait(p,()=>__game.lake.state==='drained');check('hand extraction drains to a small puddle with grounded fish',await p.evaluate(()=>__game.lake.level< -1.1&&__game.lake.waterRadius<.3&&__game.lake.fish.every(f=>Math.abs(f.root.position.y-__game.lake.level+.08)<.001)&&document.getElementById('btn-plug').disabled));
 await mouseGrab(p);check('mouse grabs the real pickup with a hand and keeps its driver',await p.evaluate(()=>__game.vehicle.held&&__game.vehicle.lift>2&&__game.vehicle.hand.visible&&__game.driver.group.parent===__game.truck.body));
 await p.screenshot({path:out+'/04-hand.png'});await p.keyboard.press('r');await p.mouse.up();await p.waitForTimeout(150);check('reset while pointer is held clears capture and the raised vehicle',pristine(await baseline(p)),await baseline(p));
 await moveTruck(p,2,3.8);const land=await baseline(p);check('one-pointer drag repositions and settles on land',Math.hypot(land.truck[0]-2,land.truck[2]-3.8)<.25&&land.truck[1]<.01&&!land.held,land);
 await mouseGrab(p);await p.mouse.move(-25,320,{steps:8});await p.mouse.up();await p.waitForTimeout(800);check('release outside the canvas never leaves the truck held',await p.evaluate(()=>!__game.vehicle.held&&!__game.vehicle.hand.visible&&__game.input.pointer===null&&__game.vehicle.lift===0));
 await reset(p);await pullPlug(p);await wait(p,()=>__game.lake.state==='drained');await moveTruck(p,10,8);
 const bed=await baseline(p);check('drain then drag places the truck on the actual lake bed',Math.hypot(bed.truck[0]-10,bed.truck[2]-8)<.3&&bed.truck[1]<-.2,bed);
 check('all four wheels meet the lake-bed support plane',await p.evaluate(()=>{const g=__game,d=g.truck.dims;return [d.axleF,d.axleR].every(x=>[-d.track,d.track].every(z=>{const q=g.truck.tilt.localToWorld(g.truck.root.position.clone().set(x,0,z)),gap=q.y-g.lake.height(q.x,q.z);return gap>-.015&&gap<.09;}));}));
 await p.click('#target-ant');await p.waitForTimeout(450);check('ant grows progressively from the existing model',await p.evaluate(()=>__game.giant.state==='growing'&&__game.giant.scale>2&&__game.giant.scale<45));
 await reset(p);check('reset during ant growth restores one small ant',pristine(await baseline(p)));
 // Complete the recording sequence with persistent world changes.
 await pullPlug(p);await wait(p,()=>__game.lake.state==='drained');await moveTruck(p,10,8);await p.click('#btn-ant');await wait(p,()=>__game.giant.state==='giant');await p.waitForTimeout(2600);
 check('giant ant adapts to the moved truck without its body intersecting it',await p.evaluate(()=>{
   const g=__game,a=g.giant;
   // Bumper contact is now intentional. Check the rendered abdomen, thorax and
   // head against the actual vehicle footprint rather than the old clearance
   // circle (which also enclosed the reaching mandibles and antennae).
   const clear=a.ant.body.children.slice(0,3).every(m=>{const attr=m.geometry.attributes.position;for(let i=0;i<attr.count;i++){const point=m.localToWorld(a.position.clone().fromBufferAttribute(attr,i)),q=g.truck.body.worldToLocal(point);if(Math.abs(q.x)<2.72&&Math.abs(q.z)<.985)return false;}return true;});
   return a.scale===45&&clear&&a.position.distanceTo(g.truck.root.position)<7&&document.getElementById('btn-ant').disabled;
 }),await p.evaluate(()=>({position:__game.giant.position.toArray(),behavior:__game.giant.forager.behavior,truck:__game.truck.root.position.toArray(),gap:__game.vehicle.distance(__game.giant.position)})));
 check('all six giant feet follow the actual ground at the shore',await p.evaluate(()=>{const g=__game;return g.giant.ant.legs.every(({leg})=>{const p=leg.children[1].localToWorld(g.giant.position.clone().set(0,.5,0));return Math.abs(p.y-g.lake.height(p.x,p.z)-.012)<.02;});}));
 await p.screenshot({path:out+'/05-bed-and-ant.png'});
 await p.click('#btn-weather');await wait(p,()=>__game.weather.firstAt!==null);
 check('storm first drops exactly ONE fish and blocks repeat activation',await p.evaluate(()=>__game.weather.spawned===1&&__game.weather.burstAt===null&&__game.weather.intensity>.9&&document.getElementById('btn-weather').disabled));
 await p.waitForTimeout(600);check('the isolated fish has a real pause before the burst',await p.evaluate(()=>__game.weather.spawned===1));
 await wait(p,()=>__game.weather.spawned>12);check('fish burst coexists with the drained lake, truck and giant ant',await p.evaluate(()=>__game.lake.state==='drained'&&__game.giant.state==='giant'&&__game.truck.root.position.y<0&&__game.weather.fish.filter(f=>f.state==='fall').length>5));
 await p.screenshot({path:out+'/06-fish-rain.png'});await wait(p,()=>__game.weather.state==='clear');
 check('storm ends, fish bounce on roof/bed, pool stays bounded',await p.evaluate(()=>__game.weather.spawned>20&&__game.weather.fish.length===36&&__game.weather.fish.some(f=>f.roof)&&__game.weather.fish.some(f=>f.state==='flop'&&!f.roof&&f.root.position.y<0)&&__game.lake.wind.value===0));
 await moveTruck(p,3,1.5);check('truck can be moved again after every other power',await p.evaluate(()=>Math.hypot(__game.truck.root.position.x-3,__game.truck.root.position.z-1.5)<.3&&!__game.vehicle.held),await baseline(p));
 await p.click('#btn-weather');await wait(p,()=>__game.weather.spawned>8);check('second storm reuses the bounded fish pool',await p.evaluate(()=>__game.weather.fish.length===36&&__game.weather.fish.filter(f=>f.state!=='off').length<=36));await reset(p);await p.waitForTimeout(2000);check('reset in the middle of fish rain clears fish, audio effects and weather timers',pristine(await baseline(p))&&(await baseline(p)).effects===0,await baseline(p));
 // Reverse order, including fish on full water before draining it.
 await p.click('#btn-weather');await wait(p,()=>__game.weather.elapsed>1);await reset(p);await p.waitForTimeout(2300);check('reset during gathering prevents delayed thunder/fish spawning',pristine(await baseline(p)));
 await p.click('#btn-weather');await wait(p,()=>__game.weather.state==='clear');check('fish landing in the full lake splash and swim',await p.evaluate(()=>__game.weather.fish.some(f=>f.state==='swim')));
 await p.click('#btn-ant');await wait(p,()=>__game.giant.state==='giant');await pullPlug(p);await wait(p,()=>__game.lake.state==='drained');
 check('weather → ant → drain also works; swimming fish follow the new level',await p.evaluate(()=>__game.weather.fish.filter(f=>f.state==='swim').every(f=>Math.abs(f.root.position.y-__game.lake.level+.06)<.002)&&__game.giant.scale===45));
 await reset(p);await p.click('#btn-truck');await p.keyboard.press('Tab');await p.locator('#view').focus();await p.keyboard.press('ArrowRight');await p.keyboard.press('Enter');await p.waitForTimeout(800);check('keyboard pickup fallback also releases cleanly',await p.evaluate(()=>!__game.vehicle.held&&__game.vehicle.lift===0));
 await p.click('#btn-menu');await p.waitForFunction(()=>window.__hubReady);await p.click('[data-game=driver] .btn-play');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});await p.click('#btn-pause');await p.click('#btn-games');await p.waitForFunction(()=>window.__hubReady);await p.click('[data-game=god] .btn-play');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});await enter(p);
 check('GOD → hub → Driver → hub → GOD starts one clean scene',pristine(await baseline(p))&&await p.locator('canvas').count()===1);
 await moveTruck(p,2,4.5);await p.click('#btn-ant');await wait(p,()=>__game.giant.state==='giant');
 check('ant makes room before growing beside a newly parked pickup',await p.evaluate(()=>__game.giant.scale===45&&__game.vehicle.distance(__game.giant.position)>=__game.giant.radius));
 await p.reload();await p.waitForFunction(()=>window.__ready,null,{timeout:90000});await p.keyboard.press('r');check('Reset key on the entry screen does not trap the start button',await p.evaluate(()=>__game.mode==='ready'));await p.click('#btn-enter');await wait(p,()=>__game.introTime>.8);await reset(p);check('Reset during divine arrival skips cleanly to a fresh playable world',pristine(await baseline(p)));
 const childCount=await p.evaluate(()=>__game.scene.children.length);
 await p.evaluate(()=>addEventListener('pagehide',()=>sessionStorage.setItem('godExit',JSON.stringify({destroyed:__game.destroyed,audio:__game.audio.ctx.state,input:__game.input.abort.signal.aborted,events:__game.abort.signal.aborted})),{once:true}));
 await p.click('#btn-menu');await p.waitForFunction(()=>window.__hubReady);
 check('leaving closes audio and removes mode/input listeners',await p.evaluate(()=>{const s=JSON.parse(sessionStorage.getItem('godExit'));return s.destroyed&&s.audio==='closed'&&s.input&&s.events;}));
 await p.goBack();await p.waitForFunction(()=>window.__ready&&window.__game?.mode==='ready',null,{timeout:90000});await enter(p);
 check('browser Back re-enters without duplicated objects or stale audio',pristine(await baseline(p))&&await p.evaluate(n=>__game.scene.children.length===n&&__game.audio.running,childCount));await context.close();

 for(const [width,height] of [[320,568],[390,844],[844,390]]){
   const context=await browser.newContext({viewport:{width,height},screen:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1}),p=await open(context),cdp=await context.newCDPSession(p);await enter(p);
   check(`${width}×${height}: phone controls fit and are touch-sized`,await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth&&[...document.querySelectorAll('#powers button,.god-top button,.god-top a')].every(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})));
   const a=await truckPoint(p),hit=await p.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,a);await touch(cdp,'touchStart',[{x:a.x,y:a.y}]);await p.waitForTimeout(350);check(`${width}×${height}: real touch input grabs pickup`,await p.evaluate(()=>__game.vehicle.held),{point:a,element:hit});
   const b=await destination(p,2,3.8);for(let i=1;i<=12;i++){await touch(cdp,'touchMove',[{x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12}]);await p.waitForTimeout(16);}await touch(cdp,'touchCancel');await p.waitForTimeout(850);
   check(`${width}×${height}: pointer cancellation places pickup and clears gesture`,await p.evaluate(()=>!__game.vehicle.held&&!__game.vehicle.hand.visible&&__game.input.pointer===null&&__game.vehicle.lift===0));
   await pullPlug(p,cdp);await wait(p,()=>__game.lake.state==='drained');await p.tap('#target-ant');await wait(p,()=>__game.giant.state==='giant');await p.tap('#btn-weather');await wait(p,()=>__game.weather.spawned>8);await p.screenshot({path:`${out}/${width}x${height}-touch.png`});
   check(`${width}×${height}: all four powers work with touch`,await p.evaluate(()=>__game.lake.state==='drained'&&__game.giant.scale===45&&__game.weather.spawned>8&&Math.hypot(__game.truck.root.position.x+2.93,__game.truck.root.position.z-7.35)>1));
   await p.tap('#btn-reset');check(`${width}×${height}: touch reset restores all state`,pristine(await baseline(p)));
   await p.tap('#btn-menu');await p.waitForFunction(()=>window.__hubReady);const bounds=await p.locator('[data-game=fisherman] .card-img').boundingBox();
   await swipe(cdp,p,{x:bounds.x+30,y:Math.max(70,Math.min(height-70,bounds.y+bounds.height/2))},{x:bounds.x+85,y:Math.max(70,Math.min(height-70,bounds.y+bounds.height/2))});await p.waitForTimeout(600);
   check(`${width}×${height}: return retains touch-swipable five-card hub`,await p.evaluate(()=>!window.__game&&document.querySelectorAll('.card').length===5));await context.close();
 }
 check('no browser runtime or shader errors',errors.length===0,errors);
} catch(e){check('test completes',false,e.stack);}finally{await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors,physicalAndroid:false},null,2));}
console.log(`${results.filter(r=>r.ok).length}/${results.length} checks passed`);if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
