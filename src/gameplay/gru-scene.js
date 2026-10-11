import * as THREE from 'three';

export const GRU_CONFIG=Object.freeze({
  finalVehicleScale:0.12,
  finalBucketScale:0.22,
  finalVoicePitch:1.85,
  shrinkDuration:0.8,
  pickupDuration:0.78,
  takeReach:1.45,
  fireCooldown:0.55,
  reactionDuration:8,
  reactionSpeechDuration:26,
  reactionSpeechGap:0.55,
});
const COMPLAINTS=['g_name','g_call','g_never_heard','g_report_call','g_report_lock','g_lock','g_private_short','g_road','g_private'];
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const ease=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};

// One interaction path for mouse, touch and the optional recording showcase.
// Speech stays on the existing dialogue bus; a shot never replaces its playing source.
export class GruScene {
  constructor(game) {
    this.game=game;
    this.config=GRU_CONFIG;
    this.ray=game.truck.gru.ray; this.mount=game.truck.gru.mount;
    this.mountPosition=this.ray.position.clone(); this.mountRotation=this.ray.quaternion.clone();
    this.raycaster=new THREE.Raycaster();
    this.held=new THREE.Group();this.held.name='heldShrinkRay';game.camera.add(this.held);
    this.hand=game.rod.hand.clone();this.hand.position.set(0,-0.067,0.036);this.hand.rotation.set(Math.PI/2,0,Math.PI*0.62);this.held.add(this.hand);
    const sleeve=new THREE.MeshStandardMaterial({color:0x384336,roughness:0.92});
    const arm=new THREE.Mesh(new THREE.CylinderGeometry(0.032,0.059,0.33,16),sleeve);
    arm.position.set(0.026,-0.13,0.21);arm.rotation.x=1.04;this.held.add(arm);
    this.heldPose=V(0.105,-0.17,-0.54);
    this.beam=new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,1,10),new THREE.MeshBasicMaterial({color:0xb0fff0,transparent:true,opacity:0.9,depthWrite:false}));
    this.beam.name='shrinkBeam';game.scene.add(this.beam);
    this.flash=new THREE.Mesh(new THREE.SphereGeometry(0.042,16,12),new THREE.MeshBasicMaterial({color:0xc7fff1,transparent:true,opacity:0.9,depthWrite:false}));
    game.scene.add(this.flash);
    this.glow=new THREE.PointLight(0x7fffe3,0,2.3);game.scene.add(this.glow);
    this.sounds=new Set();
    this.fillDefaults=game.fills.map(light=>({light,intensity:light.intensity,distance:light.distance}));
    this.bucketLights=[];
    game.bucket.root.traverse(o=>{if(o.isLight)this.bucketLights.push({light:o,intensity:o.intensity,distance:o.distance});});
    this.voicePanner=game.audio.ctx.createPanner();
    Object.assign(this.voicePanner,{panningModel:'HRTF',distanceModel:'inverse',refDistance:1.5,maxDistance:20,rolloffFactor:0.35});
    this.voicePanner.connect(game.audio.voice);
    game.dialogue.voiceOptions=line=>line.speaker==='grandpa'?{bus:this.voicePanner,rate:this.voicePitch}:null;
    this.voicePosition=V();this.listenerPosition=V();this.listenerForward=V();this.listenerUp=V();
    this.#buildUI();this.reset();
  }

  #buildUI() {
    const hud=document.getElementById('hud');
    const button=(id,text,cls)=>{const b=document.createElement('button');b.id=id;b.textContent=text;b.className=cls;hud.append(b);return b;};
    this.action=button('btn-ray','TAKE','round-btn gru-action');
    this.action.addEventListener('click',()=>this.act());
    this.label=button('ray-take-label','TAKE','pill-btn gru-take-label');
    this.label.addEventListener('click',()=>this.take());
    this.reticle=document.createElement('div');this.reticle.id='ray-reticle';this.reticle.setAttribute('aria-hidden','true');hud.append(this.reticle);
    this.replay=document.createElement('div');this.replay.className='gru-replay hidden';hud.append(this.replay);
    for(const [text,act] of [['PLAY AGAIN',()=>this.game.reset()],['ALL GAMES',()=>this.game.backToGames()]]) {
      const b=document.createElement('button');b.className='pill-btn';b.textContent=text;b.addEventListener('click',act);this.replay.append(b);
    }
    this.control=button('btn-gru-control','TAKE CONTROL','pill-btn gru-control hidden');
    this.control.addEventListener('click',()=>this.stopShowcase());
    this.soundButton=button('btn-gru-sound','TAP FOR SOUND','pill-btn gru-sound hidden');
    this.soundButton.addEventListener('click',()=>this.game.audio.unlock());
    document.querySelector('[data-act="showcase"]').textContent='Gru Showcase';
    document.getElementById('btn-rec-show').textContent='showcase';
    this.game.stage.classList.add('gru-mode');
  }

  reset() {
    for(const s of this.sounds) {try{s.stop();}catch{/* Already ended. */}}
    this.sounds.clear();
    this.state='mounted';this.pickupT=0;this.shrinkT=null;this.scale=1;
    this.bucketShrinkT=null;this.bucketScale=1;this.bucketHits=0;this.voicePitch=1;
    this.game.bucket.root.scale.setScalar(1);this.game.bucket.root.position.copy(this.game.bucket.home);
    for(const f of this.bucketLights){f.light.intensity=f.intensity;f.light.distance=f.distance;}
    if(this.game.dialogue.grandpaSpeaking)this.game.dialogue.setPlaybackRate(1);
    this.cooldown=0;this.beamT=0;this.reactionT=0;this.shots=0;this.hits=0;
    this.reactionQueued=false;
    this.reactionComplete=false;this.reactionSpeechUntil=null;this.reactionNextAt=null;this.reactionLineIndex=0;
    this.showcase=null;
    this.game.truck.root.scale.setScalar(1);
    this.game.grandpa.group.position.fromArray(this.game.grandpa.header.seat);
    for(const f of this.fillDefaults){f.light.intensity=f.intensity;f.light.distance=f.distance;}
    this.mount.add(this.ray);this.ray.position.copy(this.mountPosition);this.ray.quaternion.copy(this.mountRotation);this.ray.scale.setScalar(1);
    this.held.visible=false;this.held.position.copy(this.heldPose);this.held.quaternion.identity();
    this.beam.visible=false;this.flash.visible=false;this.glow.intensity=0;
    this.game.rod.group.visible=true;this.game.line.line.visible=true;this.game.fishing.lure.visible=true;
    this.replay.classList.add('hidden');this.control.classList.add('hidden');
    this.game.input?.reset();
    this.game.truck.root.updateMatrixWorld(true);
    this.#voice();
  }

  canAct() { return this.game.mode==='play'&&!this.game.paused&&this.game.input.enabled; }
  weaponPoint() { return this.ray.localToWorld(V(0,0,-0.075)); }
  canTake() {
    if(this.state!=='mounted'||!this.canAct())return false;
    const p=this.weaponPoint(),camera=this.game.camera;
    if(p.distanceTo(camera.position)>GRU_CONFIG.takeReach)return false;
    const screen=p.clone().project(camera);
    if(screen.z>1||Math.abs(screen.x)>1.1||Math.abs(screen.y)>1.1)return false;
    // Prevent reaching through the cabin from its opposite side.
    const local=this.game.truck.root.worldToLocal(camera.position.clone());
    return local.z>0.97;
  }
  take() {
    if(!this.canTake())return false;
    this.game.audio.unlock();this.game.fishing.reset();this.game.input.reelHeld={key:false,button:false};
    this.state='picking';this.pickupT=0;
    return true;
  }
  act() { if(this.state==='mounted')return this.take(); if(this.state==='held')return this.fire();return false; }
  tap(x,y) {
    if(this.state==='held')return this.fire(x,y);
    if(!this.canTake())return false;
    const p=this.weaponPoint().project(this.game.camera),s=this.game.size;
    this.raycaster.setFromCamera(new THREE.Vector2(x/s.w*2-1,1-y/s.h*2),this.game.camera);
    if(this.raycaster.intersectObject(this.ray,true).length || Math.hypot(x-(p.x+1)*s.w/2,y-(1-p.y)*s.h/2)<48)return this.take();
    return false;
  }

  fire(x=this.game.size.w/2,y=this.game.size.h/2) {
    if(!this.canAct()||this.state!=='held'||this.cooldown>0)return false;
    this.game.audio.unlock();this.cooldown=GRU_CONFIG.fireCooldown;this.shots++;
    const g=this.game,s=g.size;
    g.truck.root.updateWorldMatrix(true,true);g.camera.updateWorldMatrix(true,true);
    this.raycaster.setFromCamera(new THREE.Vector2(x/s.w*2-1,1-y/s.h*2),g.camera);
    this.raycaster.far=30;
    // Raycast rendered surfaces, with the world included for occlusion. Hidden original
    // meshes and the camera's own viewmodel cannot register a hit.
    // Grass bends in its shader and is not a solid shot blocker.
    const hits=this.raycaster.intersectObjects(g.scene.children.filter(o=>o!==g.camera&&o!==g.world.grass&&o!==this.beam&&o!==this.flash),true);
    let hit=null;
    for(const h of hits) {
      if(!h.object.isMesh||h.object===g.line.line)continue;
      let visible=true;
      for(let o=h.object;o;o=o.parent)if(!o.visible)visible=false;
      if(!visible)continue;
      hit=h;break;
    }
    const end=hit?hit.point:this.raycaster.ray.at(15,V());
    const origin=this.ray.localToWorld(this.ray.userData.muzzle.clone());
    const d=end.clone().sub(origin);
    this.beam.position.copy(origin).addScaledVector(d,0.5);this.beam.scale.set(1,d.length(),1);
    this.beam.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());this.beam.visible=true;
    this.flash.position.copy(end);this.flash.visible=!!hit;this.flash.scale.setScalar(1);
    this.glow.position.copy(origin);this.glow.intensity=2;this.beamT=0.16;
    this.#zap();
    let onVehicle=false,onBucket=false;
    for(let o=hit?.object;o;o=o.parent){if(o===g.truck.tilt)onVehicle=true;if(o===g.bucket.root&&!g.bucket.spilled)onBucket=true;}
    this.lastShot={hit:onVehicle||onBucket,target:onVehicle?'vehicle':onBucket?'bucket':null,object:hit?.object.name||'',point:end.toArray()};
    if(onVehicle&&this.shrinkT===null&&this.scale===1) {
      this.hits++;this.shrinkT=0;
      g.world.trample.stamp(g.truck.root.position.x,g.truck.root.position.z,0.85,1);
    }
    if(onBucket&&this.bucketShrinkT===null&&this.bucketScale===1){this.bucketHits++;this.bucketShrinkT=0;}
    return onVehicle||onBucket;
  }

  #voice() {
    const g=this.game,c=g.audio.ctx,listener=c.listener;
    this.voicePitch=THREE.MathUtils.lerp(1,GRU_CONFIG.finalVoicePitch,(1-this.scale)/(1-GRU_CONFIG.finalVehicleScale));
    if(g.dialogue.grandpaSpeaking)g.dialogue.setPlaybackRate(this.voicePitch);
    g.grandpa.bones.head.getWorldPosition(this.voicePosition);
    g.camera.getWorldPosition(this.listenerPosition);
    g.camera.getWorldDirection(this.listenerForward);
    this.listenerUp.set(0,1,0).applyQuaternion(g.camera.quaternion);
    const p=this.voicePosition,l=this.listenerPosition,f=this.listenerForward,u=this.listenerUp;
    // HRTF uses the actual head position, so the source moves down as Gru shrinks.
    if(this.voicePanner.positionX){
      this.voicePanner.positionX.value=p.x;this.voicePanner.positionY.value=p.y;this.voicePanner.positionZ.value=p.z;
    }else this.voicePanner.setPosition(p.x,p.y,p.z);
    if(listener.positionX){
      listener.positionX.value=l.x;listener.positionY.value=l.y;listener.positionZ.value=l.z;
      listener.forwardX.value=f.x;listener.forwardY.value=f.y;listener.forwardZ.value=f.z;
      listener.upX.value=u.x;listener.upY.value=u.y;listener.upZ.value=u.z;
    }else{listener.setPosition(l.x,l.y,l.z);listener.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z);}
  }

  #zap() {
    const a=this.game.audio,c=a.ctx,t=c.currentTime;
    for(const [f,gain,type] of [[1650,0.065,'sine'],[820,0.025,'triangle']]) {
      const o=c.createOscillator(),volume=c.createGain();o.type=type;
      o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(110,t+0.28);
      volume.gain.setValueAtTime(0,t);volume.gain.linearRampToValueAtTime(gain,t+0.012);volume.gain.exponentialRampToValueAtTime(0.001,t+0.30);
      o.connect(volume).connect(a.sfx);o.start(t);o.stop(t+0.31);this.sounds.add(o);
      o.onended=()=>{this.sounds.delete(o);o.disconnect();volume.disconnect();};
    }
  }

  startShowcase() { this.showcase={time:0,taken:false,fired:false};this.control.classList.remove('hidden'); }
  stopShowcase() { this.showcase=null;this.game.showcase=false;this.control.classList.add('hidden'); }
  #aimAt(point,dt,rate=4) {
    const p=this.game.player,d=point.clone().sub(this.game.camera.position);
    const yaw=Math.atan2(-d.x,-d.z),pitch=Math.atan2(d.y,Math.hypot(d.x,d.z)),k=1-Math.exp(-rate*dt);
    p.yaw+=Math.atan2(Math.sin(yaw-p.yaw),Math.cos(yaw-p.yaw))*k;
    p.pitch=THREE.MathUtils.clamp(THREE.MathUtils.lerp(p.pitch,pitch,k),-1.15,0.95);
  }
  #showcase(dt) {
    const s=this.showcase;if(!s)return;
    const g=this.game;if(!g.audio.running)return;s.time+=dt;
    if(s.time<3.8)this.#aimAt(g.grandpa.bones.head.getWorldPosition(V()).add(V(0,0.065,0)),dt);
    else if(!s.taken) {
      this.#aimAt(this.weaponPoint(),dt);
      if(s.time>5.0)s.taken=this.take();
    } else if(this.state==='held'&&!s.fired) {
      this.#aimAt(g.truck.worldPoint(V(-0.15,1.12,0.94)),dt);
      if(s.time>6.7)s.fired=this.fire();
    } else if(s.fired) {
      this.#aimAt(g.truck.worldPoint(V(0,0.80,0)),dt,2.5);
      // Walk through the space the full-sized vehicle occupied, using player collision.
      if(s.time>8.4&&s.time<10.8&&g.player.pos.z>0.96)g.player.pos.z-=dt*0.30;
      if(s.time>17)this.stopShowcase();
    }
  }

  update(dt) {
    const g=this.game;
    if(g.mode==='play')this.#showcase(dt);
    this.#argument();
    this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.state==='picking') {
      this.pickupT+=dt;
      g.rod.group.position.y-=ease(this.pickupT/0.24)*0.55;
      if(this.pickupT>=0.24&&!this.held.visible) {
        // The same weapon leaves the mount only after the rod and its hand are stowed.
        g.rod.group.visible=false;g.line.line.visible=false;g.fishing.lure.visible=false;
        const pos=this.ray.getWorldPosition(V()),q=this.ray.getWorldQuaternion(new THREE.Quaternion());
        this.held.position.copy(g.camera.worldToLocal(pos));
        this.held.quaternion.copy(g.camera.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
        this.drawFrom=this.held.position.clone();this.drawRotation=this.held.quaternion.clone();
        this.held.add(this.ray);this.ray.position.set(0,0,0);this.ray.quaternion.identity();this.held.visible=true;
        g.audio.click(0.15,1450,0.055);
      }
      if(this.held.visible) {
        const t=ease((this.pickupT-0.24)/(GRU_CONFIG.pickupDuration-0.24));
        this.held.position.copy(this.drawFrom).lerp(this.heldPose,t);this.held.position.y+=Math.sin(t*Math.PI)*0.045;
        this.held.quaternion.copy(this.drawRotation).slerp(new THREE.Quaternion(),t);
      }
      if(this.pickupT>=GRU_CONFIG.pickupDuration)this.state='held';
    }
    if(this.state==='held') {
      this.held.position.copy(this.heldPose);this.held.position.y+=Math.sin(g.player.time*2)*0.003;
      this.held.position.z+=Math.max(0,this.cooldown-0.36)*0.22;
      this.held.rotation.x=Math.max(0,this.cooldown-0.36)*0.16;
    }
    if(this.state!=='mounted'&&this.held.visible){g.line.line.visible=false;g.fishing.lure.visible=false;}
    if(this.shrinkT!==null) {
      this.shrinkT=Math.min(GRU_CONFIG.shrinkDuration,this.shrinkT+dt);
      this.scale=THREE.MathUtils.lerp(1,GRU_CONFIG.finalVehicleScale,ease(this.shrinkT/GRU_CONFIG.shrinkDuration));
      // truckRoot is already located at tyre contact height. Scaling there keeps all
      // four contact patches on the ground and carries body, bones, wheels and bounds.
      g.truck.root.scale.setScalar(this.scale);g.truck.root.updateMatrixWorld(true);
      for(const f of this.fillDefaults){f.light.intensity=f.intensity*this.scale*this.scale;f.light.distance=f.distance*this.scale;}
      // The driver stays on his seat. Head tracking and gestures use the scaled rig;
      // translating the whole character toward the window would push hips through the door.
      if(this.shrinkT>=GRU_CONFIG.shrinkDuration)this.reactionT+=dt;
    }
    if(this.bucketShrinkT!==null){
      this.bucketShrinkT=Math.min(GRU_CONFIG.shrinkDuration,this.bucketShrinkT+dt);
      this.bucketScale=THREE.MathUtils.lerp(1,GRU_CONFIG.finalBucketScale,ease(this.bucketShrinkT/GRU_CONFIG.shrinkDuration));
      g.bucket.root.scale.setScalar(this.bucketScale);
      // The pail's lowest metal surface is 2 cm above its local origin.
      g.bucket.root.position.y=g.bucket.home.y+0.02*(1-this.bucketScale);
      for(const f of this.bucketLights){f.light.intensity=f.intensity*this.bucketScale*this.bucketScale;f.light.distance=f.distance*this.bucketScale;}
      g.bucket.root.updateMatrixWorld(true);
    }
    this.#voice();
    if(this.beamT>0) {
      this.beamT=Math.max(0,this.beamT-dt);const k=this.beamT/0.16;
      this.beam.material.opacity=k;this.flash.material.opacity=k;this.flash.scale.setScalar(1+(1-k)*1.7);this.glow.intensity=k*2;
      if(!this.beamT){this.beam.visible=false;this.flash.visible=false;}
    }
    this.replay.classList.toggle('hidden',!this.reactionComplete||this.reactionT<GRU_CONFIG.reactionDuration||g.dialogue.speaking||g.dialogue.queue.length>0||!!g.dialogue._gapTimer||g.recordMode);
    this.#ui();
  }

  #argument() {
    const g=this.game,d=g.dialogue;
    if(!this.hits||g.introActive||this.reactionComplete||!g.audio.running)return;
    const now=d.now();
    if(!this.reactionQueued){
      this.reactionQueued=true;
      this.reactionSpeechUntil=now+GRU_CONFIG.reactionSpeechDuration;
    }
    // Let the current line and any existing sequence finish. The audio clock freezes on pause.
    if(d.speaking||d.queue.length||d._gapTimer){this.reactionNextAt=null;return;}
    if(now>=this.reactionSpeechUntil){this.reactionComplete=true;g.idleTalkT=40;return;}
    this.reactionNextAt??=now+(this.reactionLineIndex?GRU_CONFIG.reactionSpeechGap:0.1);
    if(now<this.reactionNextAt)return;
    const id=COMPLAINTS[this.reactionLineIndex++%COMPLAINTS.length];
    const pose=['L_pointOut','L_thumbBack','L_pointDown'][this.reactionLineIndex%3];
    const duration=d.lines[id].duration/this.voicePitch;
    d.playNext(id,()=>{
      const a=g.animator;
      a.setFace({browAngry:0.85,frown:0.65});
      a.play('gruComplaint',[[0,()=>a.setArm('L',pose)],[duration*0.72,()=>a.setArm('L','L_sill')]],duration+0.2);
    });
    this.reactionNextAt=null;
  }

  #ui() {
    const g=this.game,can=this.canTake(),p=this.weaponPoint().project(g.camera);
    this.soundButton.classList.toggle('hidden',g.mode!=='play'||g.audio.running||g.paused);
    this.label.hidden=!can||g.recordMode;
    this.label.style.left=((p.x+1)*g.size.w/2)+'px';this.label.style.top=((1-p.y)*g.size.h/2-38)+'px';
    this.action.hidden=(this.state==='mounted'&&!can)||this.state==='picking'||g.recordMode;
    this.action.textContent=this.state==='held'?'FIRE':'TAKE';this.action.disabled=this.cooldown>0;
    this.reticle.hidden=this.state!=='held'||g.recordMode;
    if(!g.recordMode)g.ui.setHint(this.state==='held'?(g.isTouch?'Drag to aim · FIRE':'Drag to aim · Click / SPACE to fire'):can?(g.isTouch?'TAKE':'E · TAKE'):'');
  }
}
