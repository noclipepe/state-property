import * as THREE from 'three';
import { createWorld } from '../scene/world.js';
import { loadTruck } from '../scene/truck.js';
import { loadGrandpa,loadFisherman } from '../character/grandpa.js';
import { GrandpaAnimator } from '../character/animator.js';
import { Fisherman } from '../driver/fisherman.js';
import { HOME,FISHER_LOCAL,BUCKET_LOCAL } from '../driver/layout.js';
import { toWorld } from '../ant/layout.js';
import { addUndercarriage } from '../ant/undercarriage.js';
import { Bucket } from '../fish/bucket.js';
import { AntConversation } from '../ant/conversation.js';
import { GodAudio } from './audio.js';
import { GodInput } from './input.js';
import { DivineLake } from './lake.js';
import { DivineTruck } from './truck.js';
import { DivineHand } from './hand.js';
import { GiantAnt } from './ant.js';
import { DivineWeather } from './weather.js';
import { setupFoliageCutaway } from './foliage.js';
import { V,smooth,mix } from './common.js';

export class GodGame {
  constructor(options){
    Object.assign(this,options);this.mode='loading';this.time=0;this.paused=false;this.destroyed=false;this.clips={};this.reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.audio=new GodAudio();this.camera=new THREE.PerspectiveCamera(48,1,.1,250);this.size={w:1,h:1};this.focus=V(4.2,0,6.5);this.abort=new AbortController();
    this.ui={setSubtitle:cue=>{document.getElementById('subtitle').textContent=cue?.text||'';}};
    const on=(id,fn)=>document.getElementById(id).addEventListener('click',fn,{signal:this.abort.signal});
    on('btn-enter',()=>this.start());on('btn-skip',()=>this.skipIntro());on('btn-reset',()=>this.reset());
    on('btn-plug',()=>this.power('plug'));on('btn-ant',()=>this.power('ant'));on('btn-weather',()=>this.power('weather'));on('btn-truck',()=>{this.audio.unlock();this.input.armTruck();});
    on('target-ant',()=>this.power('ant'));
    on('btn-sound',()=>{this.audio.unlock();this.audio.setMuted(!this.audio.muted);this.renderUI();});
    on('btn-retry',()=>location.reload());
    document.getElementById('btn-menu').addEventListener('click',()=>this.destroy(),{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>{this.paused=document.hidden;this.input?.clear(true);if(this.paused)this.audio.suspend();else if(this.mode!=='ready')this.audio.unlock();},{signal:this.abort.signal});
    window.addEventListener('pagehide',()=>this.destroy(),{signal:this.abort.signal});
    this.input=new GodInput(this);
  }
  progress(t,message){document.getElementById('load-fill').style.width=`${t*100}%`;document.getElementById('load-text').textContent=message;}
  async load(){
    this.progress(.05,'Making room for a higher power…');
    this.world=createWorld(this.renderer,{...this.quality,grass:Math.min(12000,this.quality.grass),leaves:Math.min(160,this.quality.leaves)},{grass:{x:3,z:6,r:22}});this.scene=this.world.scene;
    this.foliageCutaway=setupFoliageCutaway(this.world.trees);
    const [truck,driver,fisher]=await Promise.all([loadTruck(p=>this.progress(.1+p*.35,'Loading the familiar argument…')),loadGrandpa(),loadFisherman(),this.loadClips()]);
    if(this.destroyed)return;
    this.truck=truck;this.driver=driver;this.scene.add(truck.root);truck.sim.home={...HOME};truck.sim.reset();addUndercarriage(truck);
    driver.group.position.fromArray(driver.header.seat);truck.body.add(driver.group);this.driverAnim=new GrandpaAnimator(driver,{glances:[]});
    this.fisher=new Fisherman(fisher,this.scene);const fp=toWorld(V(...FISHER_LOCAL)),eye=this.eyeWorld();this.fisher.setHome(fp,Math.atan2(eye.x-fp.x,eye.z-fp.z));
    this.bucketPosition=toWorld(V(...BUCKET_LOCAL));this.bucket=new Bucket(this.scene,this.bucketPosition);
    this.conv=new AntConversation({audio:this.audio,clips:this.clips,ui:this.ui,onAction:(...args)=>this.perform(...args)});
    this.hand=new DivineHand(this);this.lake=new DivineLake(this);this.vehicle=new DivineTruck(this);this.giant=new GiantAnt(this);this.weather=new DivineWeather(this);
    const sc=this.world.sun.shadow.camera;sc.left=-18;sc.right=18;sc.top=18;sc.bottom=-18;sc.far=65;sc.updateProjectionMatrix();
    this.reset(false);this.resize(this.size.w,this.size.h);this.setIntroCamera(0);this.world.update(0,this.focus);
    this.renderer.compile(this.scene,this.camera);this.renderer.render(this.scene,this.camera);this.progress(1,'Four powers. Absolutely no jurisdiction.');
    this.mode='ready';document.getElementById('btn-enter').hidden=false;window.__ready=true;
    let previous=null;const loop=now=>{if(this.destroyed)return;this.raf=requestAnimationFrame(loop);const dt=previous===null?0:Math.min((now-previous)/1000,.05);previous=now;if(!document.hidden&&!this.paused)this.frame(dt);};this.raf=requestAnimationFrame(loop);
  }
  async loadClips(){const [r]=await Promise.all([fetch('assets/audio/ant_dialogue.json'),this.audio.prepareDivine()]);if(!r.ok)throw Error('Dialogue unavailable');const lines=await r.json();await Promise.all(Object.entries(lines).map(async([id,line])=>{this.clips[id]={line,buffer:await this.audio.decode(line.file)};}));this.audio.dialogue=this.clips.ant_argument;}
  eyeWorld(){this.truck.root.updateMatrixWorld(true);return this.driver.bones.eyeL.getWorldPosition(V());}
  perform(who,action,arg,extra){
    if(who==='d'){if(action==='arm')this.driverAnim.setArm(arg[0],arg==='R_pocket'?'R_rest':arg,{speed:extra??7});return;}
    const f=this.fisher;if(action==='listen')f.lookAt(()=>this.eyeWorld(),60);if(action==='face')f.setFace(arg);if(action==='gesture')f.setLeft(arg);if(action==='nod')f.nod();if(action==='lean')f.setLean(arg);if(action==='prepare')f.setHold('ready',3);
  }
  poseActors(dt){const speaker=this.conv.speaker,env=this.conv.speakerEnv;this.driverAnim.lookTarget.copy(this.fisher.headWorld);this.driverAnim.update(dt,{speechEnv:speaker==='driver'?env:0,speaking:speaker==='driver'});this.fisher.update(dt,{lookTarget:this.eyeWorld(),speechEnv:speaker==='fisherman'?env:0,speaking:speaker==='fisherman'});}
  start(){if(this.mode!=='ready')return;this.audio.unlock();document.getElementById('start').hidden=true;document.getElementById('hud').hidden=false;this.mode='intro';this.introTime=0;this.introCue=false;this.time=0;this.conv.begin(0);this.renderUI();}
  skipIntro(){if(this.mode!=='intro')return;this.mode='play';this.introTime=4.3;this.camera.position.copy(this.finalPosition);this.camera.quaternion.copy(this.finalQuaternion);this.camera.fov=48;this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();this.titleUntil=this.time+1.6;this.notice('Pull the plug. Move the pickup. Think bigger.',4);this.renderUI();}
  reset(play=true){
    if(!this.weather||(play&&this.mode==='ready'))return;this.input.clear(false);this.audio.resetEffects();this.conv.reset();this.fisher.reset();this.fisher.faceToward(()=>this.eyeWorld());this.driverAnim.reset();this.driverAnim.idlePose();
    this.lake.reset();this.vehicle.reset();this.hand.reset();this.giant.reset();this.weather.reset();this.time=0;this.introTime=4.3;this.titleUntil=0;this.message='';this.noticeUntil=0;this.loopPause=0;
    for(let i=0;i<30;i++)this.poseActors(1/60);
    if(play){this.mode='play';this.audio.unlock();this.conv.begin();this.resize(this.size.w,this.size.h);}
    this.renderUI();
  }
  power(kind){if(this.mode!=='play'||this.paused)return false;this.audio.unlock();let activated=false;if(kind==='plug')activated=this.input.armPlug();if(kind==='ant')activated=this.giant.activate();if(kind==='weather')activated=this.weather.activate();this.renderUI();return activated;}
  notice(text,seconds=3){this.message=text;this.noticeUntil=this.time+seconds;}
  resize(w,h){
    this.size={w,h};this.renderer.setSize(w,h,false);const camera=this.camera;camera.aspect=w/h;camera.fov=48;camera.updateProjectionMatrix();
    // Fit the same world from a three-quarter angle. Portrait runs along the lake–
    // pickup axis rather than shrinking both into the width of a distant map.
    const direction=(w<h?V(1,1.22,.12):V(1,1.05,-.35)).normalize();camera.position.copy(this.focus).addScaledVector(direction,30);camera.lookAt(this.focus);camera.updateMatrixWorld();
    const right=V(1,0,0).applyQuaternion(camera.quaternion),up=V(0,1,0).applyQuaternion(camera.quaternion),tan=Math.tan(48*Math.PI/360);
    let distance=23;
    for(const x of [-5.8,16.5])for(const z of [2.4,11])for(const y of [0,2.5]){const d=V(x,y,z).sub(this.focus);distance=Math.max(distance,d.dot(direction)+Math.abs(d.dot(right))/(tan*camera.aspect*.92),d.dot(direction)+Math.abs(d.dot(up))/(tan*.76));}
    this.finalPosition=this.focus.clone().addScaledVector(direction,distance);camera.position.copy(this.finalPosition);camera.lookAt(this.focus);camera.updateMatrixWorld();this.finalQuaternion=camera.quaternion.clone();
    this.weather?.layout(camera,this.finalPosition);
    if(this.mode==='intro'||this.mode==='ready')this.setIntroCamera(this.mode==='ready'?0:this.introTime);
  }
  setIntroCamera(t){
    const c=this.camera,portrait=this.size.w<this.size.h;
    // Start beside the driver's window so the argument fills the opening frame.
    // Use the pickup's original staging; the later sky turn and ascent stay continuous.
    const start=toWorld(V(.7,portrait?1.8:2.2,4.8)),ordinary=toWorld(V(-.4,1.2,.8)),opening=this.weather.opening.position;
    c.position.copy(start);c.lookAt(ordinary);const groundQ=c.quaternion.clone();c.lookAt(opening);const skyQ=c.quaternion.clone();
    // Clouds and light have had a full second on screen before translation starts.
    const tilt=smooth(t,.55,1.4),rise=smooth(t,1.5,4.3),down=smooth(t,2.6,4.3);
    c.position.copy(start).lerp(this.finalPosition,rise);c.quaternion.copy(groundQ).slerp(skyQ,tilt).slerp(this.finalQuaternion,down);
    c.fov=mix(portrait?76:60,48,smooth(t,2,4.3));c.updateProjectionMatrix();c.updateMatrixWorld();
  }
  project(point){const p=point.clone().project(this.camera),r=this.canvas.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,visible:p.z>-1&&p.z<1&&Math.abs(p.x)<1&&Math.abs(p.y)<1};}
  renderUI(){
    const play=this.mode==='play';document.getElementById('powers').hidden=!play;document.getElementById('btn-skip').hidden=this.mode!=='intro';
    document.getElementById('btn-reset').disabled=!play&&this.mode!=='intro';document.getElementById('god-title').hidden=!(play&&this.time<this.titleUntil);
    document.getElementById('notice').textContent=this.time<this.noticeUntil?this.message:'';
    const sound=document.getElementById('btn-sound');sound.textContent=this.audio.muted?'SOUND OFF':'SOUND ON';sound.setAttribute('aria-pressed',String(!this.audio.muted));
    if(!this.lake)return;
    document.getElementById('btn-plug').disabled=!play||!['full','gripped'].includes(this.lake.state);document.getElementById('btn-plug').classList.toggle('done',this.lake.state==='drained');document.getElementById('btn-plug').classList.toggle('active',this.lake.state==='gripped');
    document.getElementById('btn-ant').disabled=!play||this.giant.state!=='small';document.getElementById('btn-ant').classList.toggle('done',this.giant.state==='giant');
    document.getElementById('btn-weather').disabled=!play||this.weather.state!=='clear';document.getElementById('btn-weather').classList.toggle('active',this.weather.state!=='clear');
    document.getElementById('btn-truck').classList.toggle('active',this.vehicle.held);
    for(const [id,point,visible] of [['target-plug',this.lake.plug.position,this.lake.state==='full'],['target-ant',this.giant.position,this.giant.state==='small']]){
      const el=document.getElementById(id),p=this.project(point);el.hidden=!play||!visible||!p.visible;
      el.style.left=(id==='target-ant'?Math.min(this.size.w-85,p.x+20):p.x)+'px';el.style.top=(p.y+(id==='target-ant'?0:-30))+'px';
    }
  }
  frame(dt){
    const live=this.mode==='intro'||this.mode==='play';if(live){this.time+=dt;this.conv.update(dt);if(this.conv.state==='done'){this.loopPause+=dt;if(this.loopPause>3){this.conv.begin();this.loopPause=0;}}
      if(this.mode==='intro'){this.introTime+=dt;if(this.introTime>=.35&&!this.introCue){this.audio.divine('arrival');this.introCue=true;}this.setIntroCamera(this.introTime);if(this.introTime>=4.3)this.skipIntro();}}
    this.vehicle.update(live?dt:0);this.giant.update(live?dt:0,this.time);this.lake.update(live?dt:0,this.time);this.hand.update(live?dt:0);
    const divine=this.mode==='play'?1:this.mode==='intro'?smooth(this.introTime,.35,1.35):0;
    this.foliageCutaway.value=this.mode==='play'?1:smooth(this.introTime||0,1.5,3.5);
    this.weather.update(live?dt:0,this.time,divine);this.poseActors(live?dt:0);this.world.update(dt*(1+this.weather.intensity),this.focus);
    this.audio.spatial(this.camera,this.fisher.headWorld,this.eyeWorld());this.renderUI();this.renderer.render(this.scene,this.camera);
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;cancelAnimationFrame(this.raf);this.input.destroy();this.abort.abort();this.resizeObserver?.disconnect();this.conv?.reset();this.audio.destroy();
    // Each page owns one renderer and scene. Release GPU resources on navigation,
    // including objects shared within this scene (dispose each resource only once).
    const geometries=new Set(),materials=new Set(),textures=new Set();this.scene?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});
    if(this.scene?.environment)textures.add(this.scene.environment);if(this.world?.trample.tex)textures.add(this.world.trample.tex);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());this.renderer.dispose();
  }
}
