import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE=process.argv[2]||'http://127.0.0.1:8095/';
const out='check-out/ant-mode';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const results=[],errors=[];
function check(name,ok,detail=''){results.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${typeof detail==='string'?detail:JSON.stringify(detail)}`);}
async function pageFor(options={}) {
  const p=await browser.newPage({viewport:{width:432,height:900},...options});p.on('pageerror',e=>errors.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(BASE+'ant.html');await p.waitForFunction(()=>window.__ready,null,{timeout:90000});return p;
}
try {
  const p=await pageFor();
  const physics=await p.evaluate(async()=>{
    const g=__game,{V,toWorld,toLocal,HOME_ANT,LEAF,INTRO,PULL_APPROACH,PULL_TRIGGER_X,ROUTE}=await import('/src/ant/layout.js');
    const checks=[];const c=(name,ok,detail)=>checks.push({name,ok,detail});
    const tick=n=>{for(let i=0;i<n;i++)g.update(1/60);};
    const reset=()=>{g.restart();g.audio.setMuted(true);g.input.reset();};
    reset();
    const visible=point=>{const q=point.clone().project(g.camera);return q.z<1&&Math.abs(q.x)<1&&Math.abs(q.y)<1;};
    c('opening frames original fisherman, driver and connected rod near ground',g.camera.position.y<.25&&visible(g.fisher.headWorld)&&visible(g.eyeWorld())&&visible(g.fisher.tipWorld));
    c('original scene positions and dimensions',g.truck.root.scale.x===1&&g.truck.dims.wheelR===.385&&g.fisher.home.distanceTo(g.fisher.pos)<.001&&g.friends.length===6);
    const introX=g.player.x,friendX=g.friends.map(f=>f.p.x),firstCam=g.camera.position.clone();
    tick(138);c('wide opening shows the moving colony with walking legs',!!g.intro&&g.player.x>introX+.2&&g.friends.every((f,i)=>f.p.x>friendX[i]+.2&&f.ant.phase>0)&&g.ant.phase>0&&g.friends.filter(f=>visible(toWorld(f.p))).length>=3);
    c('wide shot holds before the forward camera move',g.camera.position.distanceTo(firstCam)<.001&&g.pitch>0);
    let previous=g.camera.position.clone(),largestStep=0,heroInFrame=true;
    for(let i=0;i<135;i++){tick(1);largestStep=Math.max(largestStep,g.camera.position.distanceTo(previous));previous.copy(g.camera.position);heroInFrame&&=visible(toWorld(g.player.clone().add(V(0,.035,0))));}
    c('camera continuously moves forward to the playable ant',!g.intro&&g.viewPitch<-.27&&g.camera.position.distanceTo(toWorld(g.player))<.6&&toLocal(g.camera.position).x>INTRO.camera.x+.7&&largestStep<.04&&g.ant.crumb.visible,{largestStep});
    c('camera keeps the playable ant in frame throughout the approach',heroInFrame);
    let maxBoom=0;
    for(let i=0;i<160;i++){g.look(.21,Math.sin(i*.12)*.07);tick(1);maxBoom=Math.max(maxBoom,g.camera.position.distanceTo(toWorld(g.player)));}
    g.lookUp();tick(60);maxBoom=Math.max(maxBoom,g.camera.position.distanceTo(toWorld(g.player)));
    c('dragging and LOOK UP keep camera within half a metre of the ant',maxBoom<.51,{maxBoom});
    g.recenter();tick(60);
    c('fine grass and crumbs use two instanced batches; soil uses mipmaps',g.trail.smallGrass.isInstancedMesh&&g.trail.smallGrass.count===1800&&g.trail.crumbTrail.isInstancedMesh&&g.trail.soilTexture.generateMipmaps);
    tick(600);c('waiting never consumes approach hazards',g.hazards.boots[0].phase==='idle'&&g.hazards.rod.phase==='idle'&&g.hazards.pull.phase==='idle');
    g.player.set(-1.24,0,1.63);tick(1);const b=g.hazards.boots[0];g.player.copy(b.center).setY(0);tick(72);
    c('boot warning remains harmless for at least 1.2 seconds',g.mode==='play'&&b.phase==='warning');
    c('actual skeletal boot lifts above its warning',toLocal(g.fisher.B.footL.getWorldPosition(V())).y>b.origin.y+.08);
    for(let i=0;i<30&&g.active;i++)tick(1);
    c('actual landing causes failure and dust',g.failure==='boot'&&b.t>=1.4&&g.hazards.dust.visible);
    c('boot impact has a visible dust burst, ground ring and strong decaying shake',g.hazards.shake>.5&&g.hazards.dust.children.length===24&&g.hazards.ring.visible);
    const impactCamera=g.camera.position.clone();tick(5);
    c('impact shakes camera even during the quick failure',g.camera.position.distanceTo(impactCamera)>.003&&g.hazards.shake>.4);
    c('warned footprint matches posed sole',Math.hypot(b.center.x-b.sole.x,b.center.z-b.sole.z)<.002);
    const epoch=g.conv.epoch;tick(52);
    c('automatic front checkpoint retry in under a second; no opening/dialogue replay',g.active&&!g.intro&&g.player.x===-1.53&&g.conv.epoch===epoch);
    g.checkpoint='rod';for(const b of g.hazards.boots)b.phase='done';g.player.set(-.32,0,1.5);tick(1);
    const rod=g.hazards.rod,mid=(rod.startAngle+rod.endAngle)/2;
    g.player.set(rod.grip.x+rod.radius*Math.cos(mid),0,rod.grip.z+rod.radius*Math.sin(mid));tick(75);
    c('rod lowering telegraph is harmless before sweep',g.active&&rod.phase==='warning');
    let contactsInside=true,attached=true;
    for(let i=0;i<75&&g.active;i++){
      tick(1);
      if(rod.phase==='sweeping'){
        const tip=toLocal(g.fisher.tipWorld),r=Math.hypot(tip.x-rod.grip.x,tip.z-rod.grip.z);
        contactsInside&&=r>=rod.inner&&r<=rod.outer&&Math.abs(tip.y-.026)<.003;
        const B=g.fisher.B.handR,m=B.matrixWorld,X=V().setFromMatrixColumn(m,0).normalize(),Y=V().setFromMatrixColumn(m,1).normalize();
        const grip=B.getWorldPosition(V()).addScaledVector(Y,-.07).addScaledVector(X,.03);
        attached&&=grip.distanceTo(g.fisher.rod.pointWorld(.27/1.62))<.004;
      }
    }
    c('rod collision follows actual low tip',g.mode==='failed'&&g.failure==='rod');
    c('rod warning covers physical sweep and handle stays in solved hand',contactsInside&&attached);
    tick(52);c('rod checkpoint skips boot and opening',g.active&&g.checkpoint==='rod'&&g.player.x===-.42&&!g.intro&&g.hazards.boots.every(b=>b.phase==='done')&&g.hazards.rod.phase==='idle');
    g.checkpoint='rod';g.hazards.reset(true);g.player.copy(PULL_APPROACH);g.recenter();g.placeCamera(0,true);tick(600);
    c('slow arrivals do not spend the truck pull early',g.hazards.pull.phase==='idle');
    g.lookUp();g.placeCamera(0,true);g.player.x=PULL_TRIGGER_X+.001;tick(1);const pull=g.hazards.pull;
    c('truck pull starts at player position after the rod even while looking up',pull.phase==='warning'&&g.checkpoint==='crossing'&&g.hazards.rod.phase==='done'&&pull.triggerPosition.x<0);
    g.player.set(1.51,0,1.30);tick(72);
    c('hooked truck gives at least 1.2 seconds of harmless warning',g.active&&pull.phase==='warning'&&pull.zones.visible&&pull.u===0);
    c('fishing line connects actual rod tip to truck window frame',pull.line.p[0].distanceTo(g.fisher.tipWorld)<.001&&pull.line.end.distanceTo(pull.hookWorld())<.001&&g.fisher.reeling);
    let matched=true,warningsCover=true;
    const zones=pull.zones.children.filter(o=>o.isMesh);
    for(let i=0;i<140&&g.active;i++){
      tick(1);
      g.truck.wheels.forEach((w,wi)=>{
        const actual=toLocal(w.pivot.getWorldPosition(V())),q=pull.wheelPose(w);matched&&=Math.hypot(actual.x-q.x,actual.z-q.z)<.0001;
        const points=zones[wi].geometry.attributes.position;
        for(const x of [-g.hazards.halfContact,g.hazards.halfContact])for(const z of [-.122,.122]){
          const p=toLocal(w.pivot.localToWorld(V(x,-g.truck.dims.wheelR,z)));
          for(let k=0;k<points.count;k++){const next=(k+1)%points.count,ax=points.getX(k),az=points.getZ(k);warningsCover&&=(points.getX(next)-ax)*(p.z-az)-(points.getZ(next)-az)*(p.x-ax)>-.00002;}
        }
      });
    }
    c('hooked truck physical wheel transforms match hazard geometry',matched);
    c('red ground polygons contain actual tire contact corners during movement',warningsCover);
    c('being in the pulled tire path causes failure',g.mode==='failed'&&g.failure==='pull');
    const pullEpoch=g.conv.epoch;tick(51);
    c('pull checkpoint restores the early approach without replaying dialogue',g.active&&g.checkpoint==='crossing'&&g.player.distanceTo(PULL_APPROACH)<.001&&g.hazards.pull.phase==='idle'&&g.fisher.pos.distanceTo(g.fisher.home)<.001&&g.conv.epoch===pullEpoch&&!g.intro);
    g.player.x=PULL_TRIGGER_X+.001;tick(160);c('approach remains safe throughout the strong pull',g.active&&pull.phase==='done');
    c('pickup moves over a metre and fisherman retreats with attached line',toLocal(g.truck.root.position).distanceTo(V())>1.3&&g.fisher.pos.distanceTo(g.fisher.home)>1.3&&g.driver.group.parent===g.truck.body&&pull.line.end.distanceTo(pull.hookWorld())<.001);
    c('strong pull pushes the original bucket clear of the bodywork',pull.toTruck(toLocal(g.bucket.root.position)).z>=g.truck.dims.halfW+.349&&pull.bucketBumped);
    const names=g.undercarriage.userData.parts;
    c('underbody includes chassis, axles, drivetrain, exhaust, tank and spare in three draws',['chassis rail','axle','differential','driveshaft','exhaust pipe','fuel tank','spare tire'].every(n=>names.includes(n))&&g.undercarriage.children.filter(o=>o.isMesh).length===3);
    g.player.set(1.35,0,1.30);g.recenter();g.placeCamera(0,true);
    let ceilingClear=true;
    for(let i=0;i<100;i++){g.look(.15,-.02);tick(1);const cp=pull.toTruck(toLocal(g.camera.position));if(cp.x>-.7&&cp.x<2.55&&Math.abs(cp.z)<.79)ceilingClear&&=cp.y<.22;}
    c('camera remains below the detailed underbody during orbit',ceilingClear);
    const ground=g.trail.ground.geometry,positions=ground.attributes.position,ids=ground.index.array;let area=0,positive=true;
    for(let i=0;i<ids.length;i+=3){const a=ids[i],b=ids[i+1],c=ids[i+2],cross=(positions.getX(b)-positions.getX(a))*(positions.getZ(c)-positions.getZ(a))-(positions.getZ(b)-positions.getZ(a))*(positions.getX(c)-positions.getX(a));positive&&=cross<0;area+=Math.abs(cross)/2;}
    ground.computeBoundingBox();const groundSize=ground.boundingBox.getSize(V());
    c('ground is one non-folding grid, with no overlapping bend triangles',positive&&Math.abs(area-groundSize.x*groundSize.z)<.001,{area});
    for(const hz of [60,20]){
      reset();let count=0,failed=false,overlap=false;
      while(g.mode!=='complete'&&count++<hz*50){
        const h=g.hazards;g.input.stick={x:0,y:h.bootDanger||h.rod.danger||h.pull.danger?0:-1};
        g.update(1/hz);failed||=g.mode==='failed';overlap||=[h.bootDanger,h.rod.danger,h.pull.danger].filter(Boolean).length>1;
      }
      c(`complete route through regular movement at ${hz} Hz takes 25–35 seconds`,g.mode==='complete'&&g.time+1.5>=25&&g.time+1.5<=35&&!failed,{time:g.time,total:g.time+1.5,mode:g.mode});
      c(`${hz} Hz: boot, rod, strong pull, then crawl under the pickup`,!overlap&&g.hazards.boots[0].phase==='done'&&g.hazards.rod.phase==='done'&&g.hazards.pull.phase==='done'&&g.crawledUnder&&g.checkpoint==='crossing');
      tick(180);
      c(`${hz} Hz: delivered crumb remains visible and colony gathers`,!g.ant.crumb.visible&&g.trail.delivered.visible&&g.friends.every(f=>f.p.distanceTo(HOME_ANT.clone().add(V(-.27,0,0)))<.16));
    }
    for(const hz of [60,20]){
      reset();g.recenter();g.hazards.reset(true);g.checkpoint='rod';g.player.copy(PULL_APPROACH);g.input.stick={x:0,y:-1};
      let count=0,settled=null,underBeforeAxle=false,failed=false;
      while(g.player.x<2.65&&count++<hz*15){
        g.update(1/hz);failed||=g.mode==='failed';
        const h=g.hazards.pull,local=h.toTruck(g.player);
        if(h.phase==='done'&&settled===null)settled=local.x;
        if(h.under(g.player)&&local.x<g.truck.dims.axleR-.2)underBeforeAxle=true;
      }
      c(`${hz} Hz: continuous forward input meets a stopped truck BEFORE the rear axle`,!failed&&settled!==null&&settled<g.truck.dims.axleR-.35&&underBeforeAxle&&g.crawledUnder,{settledTruckX:settled,rearAxle:g.truck.dims.axleR});
    }
    reset();c('full restart resets all state',g.checkpoint==='front'&&!!g.intro&&g.hazards.boots[0].phase==='idle'&&g.hazards.rod.phase==='idle'&&g.hazards.pull.u===0&&g.ant.crumb.visible&&!g.trail.delivered.visible);
    g.paused=true;return checks;
  });physics.forEach(r=>check(r.name,r.ok,r.detail));
  await p.evaluate(()=>{__game.paused=false;__game.recenter();__game.audio.setMuted(false);});
  await p.keyboard.down('ArrowUp');await p.waitForTimeout(350);await p.keyboard.up('ArrowUp');
  check('desktop arrow keys move the ant',await p.evaluate(()=>__game.player.x>-2.92));
  const box=await p.locator('#view').boundingBox(),yaw=await p.evaluate(()=>__game.yaw);
  await p.mouse.move(box.x+box.width*.65,box.y+box.height*.5);await p.mouse.down();await p.mouse.move(box.x+box.width*.8,box.y+box.height*.55,{steps:5});await p.mouse.up();
  check('mouse drag changes camera',await p.evaluate(y=>Math.abs(__game.yaw-y)>.05,yaw));
  await p.keyboard.press('KeyV');await p.waitForTimeout(500);check('V looks up',await p.evaluate(()=>__game.pitch>0));await p.keyboard.press('KeyC');
  await p.keyboard.press('Escape');const before=await p.evaluate(()=>({time:__game.time,a:__game.audio.ctx.currentTime}));await p.waitForTimeout(350);
  check('pause freezes game and audio',await p.evaluate(b=>__game.paused&&__game.time===b.time&&Math.abs(__game.audio.ctx.currentTime-b.a)<.05,before));
  await p.click('#btn-resume');
  await p.evaluate(()=>{__game.complete();});await p.waitForTimeout(1900);
  const a=await p.evaluate(()=>__game.audio.ctx.currentTime);await p.waitForTimeout(350);
  check('ending keeps the argument and audio clock running',await p.evaluate(a=>__game.mode==='complete'&&__game.audio.running&&__game.audio.ctx.currentTime>a+.2,a));
  check('exact completion copy and replay/menu controls',await p.locator('#end .title').innerText()==='CRUMB\nSECURED.'&&await p.locator('#btn-again').isVisible()&&await p.locator('#btn-other').isVisible());
  await p.click('#btn-again');check('Replay starts a fresh marching opening',await p.evaluate(()=>__game.active&&!!__game.intro&&__game.player.x<-2.98));await p.close();
  const mobile=await pageFor({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await mobile.tap('#btn-recenter');
  const pad=await mobile.locator('#move-pad').boundingBox(),session=await mobile.context().newCDPSession(mobile),px=pad.x+pad.width/2,py=pad.y+pad.height/2;
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:px,y:py-32,id:1}]});await mobile.waitForTimeout(350);
  const b=await mobile.evaluate(()=>({x:__game.player.x,yaw:__game.yaw}));
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:px,y:py-32,id:1},{x:310,y:420,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:px,y:py-32,id:1},{x:345,y:445,id:2}]});await mobile.waitForTimeout(200);
  check('touch stick and camera work simultaneously',await mobile.evaluate(b=>__game.player.x>b.x&&Math.abs(__game.yaw-b.yaw)>.03,b));
  await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});check('cancel releases movement',await mobile.evaluate(()=>__game.input.movement.y===0));
  await mobile.tap('#btn-look-up');await mobile.waitForTimeout(650);await mobile.screenshot({path:out+'/mobile-up.png'});
  await mobile.tap('#btn-recenter');await mobile.waitForTimeout(650);await mobile.screenshot({path:out+'/mobile-trail.png'});
  check('mobile trail button restores readable ground camera',await mobile.evaluate(()=>__game.viewPitch<-.25));
  for(const [width,height] of [[360,800],[390,844],[844,390]]){
    await mobile.setViewportSize({width,height});await mobile.waitForTimeout(100);
    check(`controls fit ${width}×${height}`,await mobile.evaluate(()=>['move-pad','btn-look-up','btn-recenter','btn-pause'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})));
  }
  await mobile.close();check('no browser runtime or resource errors',errors.length===0,errors);
} finally {await browser.close();fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors},null,2));}
if(results.some(r=>!r.ok)||errors.length)process.exitCode=1;
