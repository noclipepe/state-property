import * as THREE from 'three';
import { createWorld } from '../scene/world.js';
import { loadTruck } from '../scene/truck.js';
import { loadGrandpa,loadFisherman } from '../character/grandpa.js';
import { GrandpaAnimator } from '../character/animator.js';
import { Fisherman } from '../driver/fisherman.js';
import { AntConversation } from './conversation.js';
import { HOME,FISHER_LOCAL,BUCKET_LOCAL } from '../driver/layout.js';
import { Bucket } from '../fish/bucket.js';
import { Ant } from './ant.js';
import { Trail } from './trail.js';
import { Hazards } from './hazards.js';
import { AntAudio } from './audio.js';
import { AntInput } from './input.js';
import { AntUI } from './ui.js';
import { addUndercarriage } from './undercarriage.js';
import { V,UP,toWorld,toLocal,ROUTE,LEAF,HOME_ANT,SPEED,RADIUS,INTRO,PULL_APPROACH,onRoute,routeDistance,routeLength } from './layout.js';

export class AntGame {
  constructor(options) {
    Object.assign(this,options);this.mode='loading';this.paused=false;this.exited=false;this.time=0;
    this.audio=new AntAudio();this.ui=new AntUI(this);this.input=new AntInput(this,this.canvas);
    this.camera=new THREE.PerspectiveCamera(62,9/16,.008,250);this.size={w:1,h:1};this.clips={};
    this.player=ROUTE[0].clone();this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  get active(){return this.mode==='play'&&!this.paused&&!this.exited;}
  async load() {
    this.ui.progress(.05,'Finding the trail…');
    this.world=createWorld(this.renderer,{...this.quality,grass:Math.round(this.quality.grass*.55)},{grass:{x:-1.5,z:6,r:17}});this.scene=this.world.scene;
    const [truck,driver,fisher]=await Promise.all([loadTruck(p=>this.ui.progress(.1+p*.3,'Loading the pickup…')),loadGrandpa(),loadFisherman(),this.loadClips()]);
    this.truck=truck;this.driver=driver;this.scene.add(truck.root);truck.sim.home={...HOME};truck.sim.reset();
    this.undercarriage=addUndercarriage(truck);
    const contact=truck.root.children.find(o=>o.isMesh&&o.geometry.type==='PlaneGeometry');if(contact)contact.material.opacity=.72;
    driver.group.position.fromArray(driver.header.seat);truck.body.add(driver.group);this.driverAnim=new GrandpaAnimator(driver,{glances:[]});
    this.fisher=new Fisherman(fisher,this.scene);const fp=toWorld(V(...FISHER_LOCAL)),eye=this.eyeWorld();
    this.fisher.setHome(fp,Math.atan2(eye.x-fp.x,eye.z-fp.z));
    this.root=new THREE.Group();this.root.position.set(HOME.x,0,HOME.z);this.root.rotation.y=HOME.yaw;this.scene.add(this.root);
    this.trail=new Trail(this.root,this.world,this.renderer);this.ant=new Ant(this.root,true);this.friends=[.28,.56,.84,-.25,-.50,-.75].map(offset=>({ant:new Ant(this.root,true),p:V(),distance:0,offset}));
    for(const f of this.friends)f.ant.root.scale.setScalar(.73);
    this.bucket=new Bucket(this.scene,toWorld(V(...BUCKET_LOCAL)));
    const fill=new THREE.PointLight(0xffe3bb,1.5,6,1.2);fill.position.copy(toWorld(V(-1,1.8,2.6)));this.scene.add(fill);
    const cabinFill=new THREE.PointLight(0xffe9cc,.9,2,1);cabinFill.position.set(-.5,1.55,.75);truck.body.add(cabinFill);
    this.world.sun.shadow.normalBias=.004;this.world.sun.shadow.bias=-.00006;
    this.conv=new AntConversation({audio:this.audio,clips:this.clips,ui:this.ui,onAction:(...a)=>this.perform(...a)});
    this.hazards=new Hazards(this);
    this.mode='play';this.restart();this.renderer.compile(this.scene,this.camera);this.ui.progress(1,'Ready');window.__ready=true;
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();});
    addEventListener('pagehide',()=>this.stop());
    addEventListener('pageshow',e=>{if(e.persisted){this.exited=false;this.paused=true;this.ui.showPause(true);}});
    let previous=null;
    const loop=now=>{
      const raw=previous===null?0:Math.max(0,(now-previous)/1000),dt=Math.min(raw,.05);previous=now;
      if(!document.hidden&&!this.paused&&!this.exited){this.adapt(raw);this.frame(dt);}
      requestAnimationFrame(loop);
    };requestAnimationFrame(loop);
  }
  async loadClips(){
    const r=await fetch('assets/audio/ant_dialogue.json');if(!r.ok)throw Error('Dialogue unavailable');
    const lines=await r.json();await Promise.all(Object.entries(lines).map(async([id,line])=>{this.clips[id]={line,buffer:await this.audio.decode(line.file)};}));
  }
  eyeWorld(){this.truck.root.updateMatrixWorld(true);return this.driver.bones.eyeL.getWorldPosition(V());}
  restart(){
    if(!this.hazards)return;
    this.mode='play';this.paused=false;this.exited=false;this.time=0;this.checkpoint='front';this.failure=null;this.delivery=0;this.retryTime=0;this.intro=null;
    this.fisher.reset();this.driverAnim.reset();this.driverAnim.idlePose();this.hazards.reset();this.input.reset();this.audio.flushSfx();
    this.player.copy(ROUTE[0]).add(V(-INTRO.march,0,0));this.heading=0;this.crawledUnder=false;this.trail.delivered.visible=false;this.trail.delivered.scale.setScalar(1);this.ant.crumb.visible=true;this.ant.body.rotation.set(0,0,0);this.lastStep=0;
    this.resetFriends(-INTRO.march);this.ant.pose(this.player,0,0,false);this.audio.unlock();this.conv.begin(0);this.ui.reset();
    // Settle the original rigs before the first visible frame (the rod starts in his hand).
    for(let i=0;i<45;i++)this.poseActors(1/60);
    const d=INTRO.target.clone().sub(INTRO.camera);
    this.yaw=Math.atan2(-d.z,d.x);this.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));
    this.intro={elapsed:0,yaw:this.yaw,pitch:this.pitch};this.marchIntro(0);this.cameraPreset='intro';this.placeCamera(0,true);
    this.notice('They argue. You deliver.',4);
    if(new URLSearchParams(location.search).has('clean'))this.ui.toggleClean(true);
  }
  resetFriends(distance){this.friends.forEach((f,i)=>{f.distance=Math.min(routeLength,distance+f.offset);f.p.copy(this.friendPoint(f.distance));if(f.offset<0)f.p.z+=.23;f.ant.crumb.visible=i===0;f.ant.pose(f.p,0,0,false);});}
  friendPoint(distance){return distance<0?ROUTE[0].clone().add(V(distance,0,-distance*INTRO.approachSlope)):onRoute(distance);}
  marchIntro(dt){
    const distance=-INTRO.march*(1-THREE.MathUtils.smoothstep(this.intro.elapsed,0,INTRO.duration));
    const heading=d=>Math.atan(INTRO.approachSlope)*(1-THREE.MathUtils.smoothstep(d,-.16,0));
    this.player.copy(this.friendPoint(distance));this.heading=heading(distance);this.ant.pose(this.player,this.heading,dt,dt>0);
    const spread=THREE.MathUtils.smoothstep(this.intro.elapsed,INTRO.hold,INTRO.duration);
    this.friends.forEach(f=>{
      f.distance=distance+f.offset;f.p.copy(this.friendPoint(f.distance));if(f.offset<0)f.p.z+=.23*spread;
      f.ant.pose(f.p,heading(f.distance),dt,dt>0);
    });
  }
  skipIntro(){if(!this.intro)return;this.intro=null;this.player.copy(ROUTE[0]);this.resetFriends(0);this.ant.pose(this.player,0,0,false);}
  retry(){
    if(this.mode!=='failed')return;
    this.mode='play';this.failure=null;this.paused=false;this.intro=null;this.input.reset();
    const crossing=this.checkpoint==='crossing',leaf=this.checkpoint==='leaf',rod=this.checkpoint==='rod';this.hazards.reset(crossing?'crossing':leaf);
    if(rod)for(const b of this.hazards.boots)b.phase='done';
    this.player.copy(crossing?PULL_APPROACH:leaf?LEAF:rod?V(-.42,0,1.70):V(-1.53,0,1.64));this.heading=0;this.crawledUnder=false;this.ant.body.rotation.set(0,0,0);
    const cue=this.ui.cue;
    this.resetFriends(routeDistance(this.player));this.recenter();this.ui.reset();this.ui.setSubtitle(cue);this.audio.flushSfx();this.audio.unlock();this.notice(crossing?'Still got the crumb. Mind the hooked truck.':leaf?'Same leaf. Same crumb. One more crossing.':rod?'Same crumb. Wait for the rod to lift.':'Nobody saw that. Mind the boot.');
    // Conversation and its audio clock are preserved. Retrying never replays a line.
    this.poseActors(0);this.placeCamera(0,true);
  }
  notice(message,seconds=4){this.message=message;this.noticeUntil=this.time+seconds;}
  look(yaw,pitch){if(!this.active)return;this.skipIntro();this.yaw+=yaw;this.pitch=THREE.MathUtils.clamp(this.pitch+pitch,-.9,1.25);this.cameraPreset=null;}
  recenter(){if(!this.active)return;this.skipIntro();this.yaw=this.heading+.15;this.pitch=-.29;this.cameraPreset='trail';}
  lookUp(){if(!this.active)return;
    this.skipIntro();
    const target=toLocal(this.fisher.headWorld.clone().lerp(this.eyeWorld(),.5));
    const d=target.sub(this.player);this.yaw=Math.atan2(-d.z,d.x);this.pitch=THREE.MathUtils.clamp(Math.atan2(d.y,Math.hypot(d.x,d.z)+.47)-.08,.2,1.05);this.cameraPreset='up';
  }
  placeCamera(dt,snap=false){
    if(this.cameraPreset==='trail'&&!this.intro)this.pitch=this.hazards.pull.under(this.player)?-.09:-.29;
    const k=snap?1:1-Math.exp(-7*dt);
    this.viewYaw??=this.yaw;this.viewPitch??=this.pitch;
    this.viewYaw+=Math.atan2(Math.sin(this.yaw-this.viewYaw),Math.cos(this.yaw-this.viewYaw))*k;
    this.viewPitch=THREE.MathUtils.lerp(this.viewPitch,this.pitch,k);
    // A fixed boom follows the ant itself. Pitch can never zoom or translate the camera away.
    const elevation=THREE.MathUtils.clamp(-this.viewPitch,.075,1.05),length=.47;
    const pivot=this.player.clone().add(V(0,.035,0));
    const offset=V(-Math.cos(this.viewYaw)*Math.cos(elevation)*length,Math.sin(elevation)*length,Math.sin(this.viewYaw)*Math.cos(elevation)*length);
    let desired=pivot.clone().add(offset);
    if(this.intro){
      const u=THREE.MathUtils.smoothstep(this.intro.elapsed,INTRO.hold,INTRO.duration);
      desired=INTRO.camera.clone().lerp(desired,u);
    }else desired=this.hazards.cameraPoint(pivot,desired);
    this.camera.position.copy(toWorld(desired));
    let aimYaw=this.viewYaw,aimPitch=this.viewPitch;
    if(this.intro&&this.intro.elapsed>=INTRO.hold){
      // Preserve the ant's composition as the lens travels diagonally toward it. Simply
      // interpolating camera yaw would sweep past the colony and lose the hero offscreen.
      const u=THREE.MathUtils.smoothstep(this.intro.elapsed,INTRO.hold,INTRO.duration);
      const holdDistance=-INTRO.march*(1-THREE.MathUtils.smoothstep(INTRO.hold,0,INTRO.duration));
      const hold=this.friendPoint(holdDistance).add(V(0,.035,0)).sub(INTRO.camera);
      const focus=pivot.clone().sub(desired);
      aimYaw=Math.atan2(-focus.z,focus.x)+(this.intro.yaw-Math.atan2(-hold.z,hold.x))*(1-u);
      aimPitch=Math.atan2(focus.y,Math.hypot(focus.x,focus.z))+(this.intro.pitch-Math.atan2(hold.y,Math.hypot(hold.x,hold.z)))*(1-u);
    }
    const d=V(Math.cos(aimYaw)*Math.cos(aimPitch),Math.sin(aimPitch),-Math.sin(aimYaw)*Math.cos(aimPitch)).applyAxisAngle(UP,HOME.yaw);
    this.camera.up.copy(UP);this.camera.lookAt(this.camera.position.clone().add(d));
    if(!this.reducedMotion&&this.hazards.shake>0){
      const s=this.hazards.shake,a=(s/.6)**2;
      this.camera.position.add(V(Math.sin(s*83)*.015,Math.sin(s*61)*.011,Math.cos(s*73)*.007).multiplyScalar(a).applyAxisAngle(UP,HOME.yaw));
      this.camera.rotateZ(Math.sin(s*75)*.019*a);
    }
    this.camera.updateMatrixWorld();
  }
  resolve(p){
    // Ground level collision only: the real truck's underbody is above an ant.
    for(let pass=0;pass<2;pass++) {
      for(const r of this.trail.rocks) {
        const dx=p.x-r.x,dz=p.z-r.z,length=Math.hypot(dx,dz),min=r.r+RADIUS;
        if(length<min){p.x=r.x+(length?dx/length:1)*min;p.z=r.z+(length?dz/length:0)*min;}
      }
      for(const r of this.hazards.solids()) {
        const co=Math.cos(r.yaw),si=Math.sin(r.yaw),dx=p.x-r.x,dz=p.z-r.z;
        let x=co*dx-si*dz,z=si*dx+co*dz;
        const cx=THREE.MathUtils.clamp(x,-r.hx,r.hx),cz=THREE.MathUtils.clamp(z,-r.hz,r.hz),ox=x-cx,oz=z-cz,length=Math.hypot(ox,oz);
        if(length>=RADIUS)continue;
        if(length>1e-6){x=cx+ox/length*RADIUS;z=cz+oz/length*RADIUS;}
        else if(r.hx-Math.abs(x)<r.hz-Math.abs(z))x=(x<0?-1:1)*(r.hx+RADIUS);else z=(z<0?-1:1)*(r.hz+RADIUS);
        p.x=r.x+co*x+si*z;p.z=r.z-si*x+co*z;
      }
    }
    // A broad, soft trail boundary keeps the camera and ant clear of the underbody and lawn.
    const nearest=onRoute(routeDistance(p)),away=p.clone().sub(nearest).setY(0);
    if(away.length()>.46)p.copy(nearest.add(away.setLength(.46)));
    p.y=this.trail.height(p);return p;
  }
  move(dt){
    const m=this.input.movement;
    // Forward follows the visible trail tangent; looking around never changes the controls.
    const s=routeDistance(this.player),tangent=onRoute(Math.min(routeLength,s+.15)).sub(onRoute(Math.max(0,s-.04))).normalize();
    if(tangent.lengthSq()<.01)tangent.set(1,0,0);
    // A gentle return toward the next crumbs makes "forward follows the trail" consistent
    // after a dodge. Lateral input remains immediate; standing still never moves the ant.
    if(m.y<0&&Math.abs(m.x)<.05){const toward=onRoute(Math.min(routeLength,s+.48)).sub(this.player).setY(0).normalize();tangent.lerp(toward,.45).normalize();}
    // Follow the broad bend only in the explicitly selected trail camera. A manual drag
    // immediately releases this assistance; sideways dodges never whip the camera around.
    if(this.cameraPreset==='trail'&&m.y<-.05){const target=Math.atan2(-tangent.z,tangent.x)+.15,d=target-this.yaw;this.yaw+=Math.atan2(Math.sin(d),Math.cos(d))*(1-Math.exp(-1.6*dt));}
    const speed=SPEED*(this.hazards.pull.under(this.player)?.85:1);
    const right=V(-tangent.z,0,tangent.x),step=tangent.multiplyScalar(-m.y).addScaledVector(right,m.x).multiplyScalar(speed*dt);
    const old=this.player.clone();this.resolve(this.player.add(step));const moved=this.player.distanceTo(old)>.0001;
    if(moved){const d=this.player.clone().sub(old);this.heading=Math.atan2(-d.z,d.x);if(this.time-(this.lastStep||0)>.13){this.audio.click(.013,2600,.009);this.lastStep=this.time;}}
    this.ant.pose(this.player,this.heading,dt,moved);
    if(this.checkpoint==='front'&&this.hazards.boots.every(b=>b.phase==='done')&&this.player.x>-.48)this.checkpoint='rod';
    if(!['leaf','crossing'].includes(this.checkpoint)&&this.player.distanceTo(LEAF)<.27){this.checkpoint='leaf';this.audio.rustle();this.notice('LEAF SHELTER · Checkpoint saved.',3);}
    if(!this.crawledUnder&&this.hazards.pull.under(this.player)){this.crawledUnder=true;this.notice('Under the pickup. Keep the crumb low.',4);}
    if(this.player.distanceTo(HOME_ANT)<.25&&this.player.x>HOME_ANT.x-.26)this.complete();
  }
  updateFriends(dt){
    for(const f of this.friends){
      const ahead=routeDistance(this.player)+f.offset;
      const stopped=(this.hazards.bootDanger&&f.p.x>-1.3&&f.p.x<-.45)||(this.hazards.rod.danger&&f.p.x>-.5&&f.p.x<.6)||(this.hazards.pull.danger&&f.p.x>-.24&&f.p.x<2.3);
      if(!stopped&&f.distance<ahead)f.distance=Math.min(routeLength-.22,f.distance+SPEED*dt*.96);
      const target=this.friendPoint(f.distance);
      if(f.offset<0)target.z+=.23;
      if(stopped&&this.hazards.bootDanger)target.z=2.03;
      if(stopped&&this.hazards.rod.danger)target.x=Math.min(-.09,f.p.x);
      if(stopped&&this.hazards.pull.danger){target.x=Math.min(PULL_APPROACH.x,f.p.x);target.z=1.50;}
      // The player has right of way; companions spread out gently without crowding the crumb.
      const away=target.clone().sub(this.player).setY(0);if(away.length()<.14)target.z+=f.offset<0?.12:-.12;
      for(const r of this.trail.rocks)if(Math.hypot(target.x-r.x,target.z-r.z)<r.r+.045)target.z=r.z+r.r+.07;
      const d=target.sub(f.p),step=Math.min(d.length(),SPEED*dt),old=f.p.clone();if(step>.00001)f.p.addScaledVector(d.normalize(),step);
      this.resolve(f.p);const delta=f.p.clone().sub(old);const heading=delta.lengthSq()>1e-8?Math.atan2(-delta.z,delta.x):f.ant.root.rotation.y;
      f.ant.pose(f.p,heading,dt,delta.lengthSq()>1e-8);
    }
  }
  perform(who,action,arg,extra){
    if(who==='d') {if(action==='arm')this.driverAnim.setArm(arg[0],arg==='R_pocket'?'R_rest':arg,{speed:extra??7});return;}
    const f=this.fisher;
    if(this.hazards?.pull.danger&&['gesture','lean','prepare'].includes(action))return;
    if(action==='listen')f.lookAt(()=>this.eyeWorld(),60);
    if(action==='face')f.setFace(arg);if(action==='gesture')f.setLeft(arg);if(action==='nod')f.nod();if(action==='lean')f.setLean(arg);
    if(action==='prepare')f.setHold('ready',3);
  }
  poseActors(dt){
    const speaker=this.conv.speaker,env=this.conv.speakerEnv;
    this.driverAnim.lookTarget.copy(this.fisher.headWorld);this.driverAnim.update(dt,{speechEnv:speaker==='driver'?env:0,speaking:speaker==='driver'});
    // A brief glance along the bank exposes his profile in the opening. Body and feet keep
    // their original staging; the glance is at human height, never at the ants.
    this.fisher.anim.setLean({twist:this.time<3.5?3.2:0});
    if(this.time<3.5)this.fisher.lookAt(toWorld(V(-3.1,1.6,4.1)),.15);
    this.fisher.update(dt,{lookTarget:this.eyeWorld(),speechEnv:speaker==='fisherman'?env:0,speaking:speaker==='fisherman'});
    this.hazards.pose();
    this.hazards.rod.pose(dt);
    this.hazards.pull.updateLine(dt);
  }
  fail(cause){if(!this.active)return;this.mode='failed';this.failure=cause;this.retryTime=0;this.input.reset();this.ant.body.rotation.z=-.35;this.ui.showFailure();}
  complete(){if(!this.active)return;this.mode='delivering';this.delivery=0;this.input.reset();this.ant.crumb.visible=false;this.trail.delivered.visible=true;this.audio.rustle();this.notice('CRUMB SECURED.');}
  gatherFriends(dt){
    this.friends.forEach((f,i)=>{
      const angle=1.05+i*Math.PI*2/this.friends.length,target=HOME_ANT.clone().add(V(-.27+Math.cos(angle)*.10,0,Math.sin(angle)*.12));
      const d=target.clone().sub(f.p),step=Math.min(d.length(),SPEED*1.5*dt);
      if(step>.001)f.p.addScaledVector(d.normalize(),step);
      f.ant.crumb.visible=false;f.ant.pose(f.p,Math.atan2(-(HOME_ANT.z-f.p.z),HOME_ANT.x-.25-f.p.x),dt,step>.001);
    });
    this.ant.pose(this.player,this.heading,dt,false);
  }
  update(dt){
    if(this.audio.running&&this.mode!=='loading')this.conv.update(dt);
    if(this.active){
      if(this.intro){
        if(this.audio.running||this.audio.muted){this.intro.elapsed+=dt;this.time+=dt;}
        const u=THREE.MathUtils.smoothstep(this.intro.elapsed,INTRO.hold,INTRO.duration);
        this.yaw=THREE.MathUtils.lerp(this.intro.yaw,.15,u);this.pitch=THREE.MathUtils.lerp(this.intro.pitch,-.29,u);
        this.marchIntro(this.audio.running||this.audio.muted?dt:0);
        if(this.intro.elapsed>=INTRO.duration){this.intro=null;this.cameraPreset='trail';this.notice('Follow the crumbs. Red ground? Wait or go around.',3);}
      } else {
        this.time+=dt;this.move(dt);if(this.active)this.hazards.update(dt);
        this.updateFriends(dt);
      }
      this.poseActors(dt);if(this.active)this.hazards.rod.contact();this.placeCamera(dt);
    } else if(this.mode==='failed') {
      this.retryTime+=dt;
      this.placeCamera(dt);
      if(this.retryTime>=.85)this.retry();
    } else if(this.mode==='delivering'||this.mode==='complete') {
      this.delivery+=dt;this.gatherFriends(dt);this.poseActors(dt);
      this.trail.delivered.position.x=-.255;
      const position=toWorld(HOME_ANT.clone().add(V(-.80,.29,.35))),target=toWorld(HOME_ANT.clone().add(V(-.17,.025,0)));
      this.camera.position.lerp(position,1-Math.exp(-2*dt));
      const before=this.camera.quaternion.clone();this.camera.lookAt(target);this.camera.quaternion.slerpQuaternions(before,this.camera.quaternion.clone(),1-Math.exp(-3*dt));
      if(this.mode==='delivering'&&this.delivery>1.5){this.mode='complete';this.ui.showEnd();}
    }
    this.hazards.updateEffects(dt);
    this.trail.updateCamera(this.camera);
  }
  frame(dt){
    this.update(dt);
    this.world.update(dt,toWorld(V(.1,0,1)));
    this.bucket?.update?.(dt);
    if(this.audio.running){const moving=this.hazards.pull.phase==='moving';this.audio.update({engine:.13,roll:moving?.65:0,water:.05});this.audio.spatial(this.camera,this.conv.speaker==='fisherman'?this.fisher.headWorld:this.eyeWorld());}
    this.ui.update();this.renderer.render(this.scene,this.camera);
  }
  resize(w,h){this.size={w,h};this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.fov=w/h>1?54:62;this.camera.updateProjectionMatrix();this.hazards?.pull.line.mat.resolution.set(w,h);}
  adapt(raw){
    if(raw<=0||raw>.3)return;this.frameTime=(this.frameTime||raw)*.97+raw*.03;this.adaptTime=(this.adaptTime||0)+raw;
    if(this.adaptTime<2)return;this.adaptTime=0;const d=this.renderer.getPixelRatio();
    if(this.frameTime>1/38&&d>.8){this.renderer.setPixelRatio(Math.max(.8,d*.85));this.resize(this.size.w,this.size.h);}
  }
  pause(){if(this.mode==='loading'||this.paused)return;this.paused=true;this.input.reset();this.audio.suspend();this.ui.showPause(true);}
  resume(){if(!this.paused||this.exited)return;this.paused=false;this.audio.unlock();this.ui.showPause(false);}
  toggleMute(){this.audio.setMuted(!this.audio.muted);this.ui.update();}
  stop(){this.paused=true;this.exited=true;this.input.reset();this.conv?.reset();this.audio.suspend();}
  backToGames(){this.stop();location.href='./';}
}
