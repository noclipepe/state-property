import * as THREE from 'three';
import { fishBatch } from './fish-batch.js';
import { V,mesh,ring,smooth,mix,clamp } from './common.js';

export const LAKE={x:11,z:6.5,rx:5.98,rz:4.6};
export class DivineLake {
  constructor(game) {
    this.g=game;const {world,scene}=game;
    this.water=world.pond.children[0];this.wind={value:0};
    // The original meadow remains intact outside the existing shoreline. The cutout
    // reveals real sloping geometry, so all powers share one physical surface query.
    const ground=world.ground.material,groundHook=ground.onBeforeCompile,key=ground.customProgramCacheKey();
    ground.onBeforeCompile=shader=>{groundHook(shader);shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif(length((vWPos.xz-vec2(11.,6.5))/vec2(5.98,4.6))<.998) discard;');};
    ground.customProgramCacheKey=()=>key+'-god-lake';ground.needsUpdate=true;
    const wm=this.water.material,waterHook=wm.onBeforeCompile,waterKey=wm.customProgramCacheKey();
    wm.onBeforeCompile=shader=>{waterHook(shader);shader.uniforms.uGodWind=this.wind;
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uGodWind;')
        .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=normalize(normal+vec3(sin(vWPos.x*7.+uTime*6.),0.,cos(vWPos.z*9.-uTime*5.))*uGodWind*.22);');};
    wm.customProgramCacheKey=()=>waterKey+'-god-wind';wm.needsUpdate=true;
    const positions=[],indices=[],colors=[];
    // A ring grid rather than a centre fan gives the exposed basin a broad, flat floor.
    for(let j=0;j<=28;j++)for(let i=0;i<=96;i++){
      const r=j/28,a=i/96*Math.PI*2,x=LAKE.x+Math.cos(a)*LAKE.rx*r,z=LAKE.z+Math.sin(a)*LAKE.rz*r;
      positions.push(x,this.height(x,z)-.006,z);const c=new THREE.Color().setHSL(.105,.23,.31+.07*r+.018*Math.sin(i*7+j*3));colors.push(c.r,c.g,c.b);
      if(i<96&&j<28){const k=j*97+i;indices.push(k,k+97,k+1,k+1,k+97,k+98);}
    }
    const bedGeo=new THREE.BufferGeometry();bedGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));bedGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));bedGeo.setIndex(indices);bedGeo.computeVertexNormals();
    this.bed=mesh(scene,bedGeo,new THREE.MeshStandardMaterial({color:0xc4a57b,vertexColors:true,roughness:.94,side:THREE.DoubleSide}));this.bed.receiveShadow=true;
    const dark=new THREE.MeshStandardMaterial({color:0x172027,roughness:.54,metalness:.3}),gold=new THREE.MeshStandardMaterial({color:0xd8b66a,metalness:.72,roughness:.25});
    this.plug=new THREE.Group();scene.add(this.plug);
    mesh(this.plug,new THREE.CylinderGeometry(.7,.58,.22,40),dark,V(0,0,0));
    mesh(this.plug,new THREE.CylinderGeometry(.58,.58,.03,40),gold,V(0,.13,0));
    mesh(this.plug,new THREE.TorusGeometry(.4,.095,12,40),gold,V(0,.52,0));
    this.plug.traverse(m=>{if(m.isMesh)m.castShadow=true;});
    this.halo=ring(scene,1.05,0xffedae,.045);
    this.drain=mesh(scene,new THREE.CylinderGeometry(.46,.46,.025,32),dark,V(11,-1.19,6.5));
    for(let i=0;i<7;i++)mesh(this.drain,new THREE.BoxGeometry(.045,.018,.72),gold,V((i-3)*.095,.024,0));
    this.vortex=new THREE.Group();scene.add(this.vortex);this.foam=[];
    for(let i=0;i<4;i++){
      const points=[];for(let j=0;j<58;j++){const a=j/57*Math.PI*2.1+i*Math.PI/2,r=.18+j/57*1.8;points.push(V(Math.cos(a)*r,0,Math.sin(a)*r));}
      const m=mesh(this.vortex,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),58,.035,5,false),new THREE.MeshBasicMaterial({color:0xcce1c6,transparent:true,opacity:.8,depthWrite:false}));this.foam.push(m);
    }
    this.batch=fishBatch(scene,5);this.fish=this.batch.fish;this.fish.forEach(f=>f.root.scale.setScalar(5.5));
    this.reset();
  }
  radius(x,z){return Math.hypot((x-LAKE.x)/LAKE.rx,(z-LAKE.z)/LAKE.rz);}
  height(x,z){const r=this.radius(x,z);return r>=1?0:r<=.65?-1.2+.12*(r/.65)**2:-1.08+1.08*smooth(r,.65,1);}
  wet(x,z){return this.radius(x,z)<this.waterRadius&&this.height(x,z)<this.level-.025;}
  reset(){this.g.hand.release('plug');this.state='full';this.pull=0;this.requestedPull=0;this.elapsed=0;this.level=.02;this.waterRadius=1;this.wind.value=0;this.plug.position.set(11,.19,6.5);this.plug.rotation.set(0,0,0);this.halo.visible=true;this.vortex.visible=false;this.applyWater();}
  grab(){
    if(this.state==='gripped')return true;if(this.state!=='full')return false;
    this.g.vehicle?.release();if(!this.g.hand.grab('plug'))return false;
    this.state='gripped';this.halo.visible=false;this.requestedPull=0;this.g.audio.divine('grasp');this.g.notice('Hold the ring and pull UP. ↑ also pulls on a keyboard.',4);return true;
  }
  pullTo(value){if(this.state==='gripped')this.requestedPull=clamp(value,0,1);}
  release(){if(this.state!=='gripped')return;this.state='full';this.requestedPull=0;this.halo.visible=true;this.g.hand.release('plug');}
  activate(){
    // Only a completed, visibly held pull can break the seal. Neither the HUD
    // button nor a tap runs the drain animation without the player's gesture.
    if(this.state!=='gripped'||this.pull<.96||!this.g.hand.ready('plug'))return false;
    this.state='draining';this.elapsed=0;this.g.audio.effect('drain');this.g.notice('Turns out it was a bathtub.',3);return true;
  }
  applyWater(){this.water.position.y=this.level;this.water.scale.set(1.3*this.waterRadius,this.waterRadius,1);this.halo.position.set(11,.05,6.5);}
  update(dt,time){
    if(this.state==='full'||this.state==='gripped'){
      const desired=this.state==='gripped'&&this.g.hand.ready('plug')?this.requestedPull:0;
      this.pull+=(desired-this.pull)*(1-Math.exp(-dt*20));
      this.plug.position.set(11,.19+this.pull*2.4,6.5);
      // A three-quarter ring shows the thumb and index on separate sides instead
      // of hiding one directly behind the other in a face-on front/back pinch.
      this.plug.rotation.set(0,Math.atan2(this.g.camera.position.x-11,this.g.camera.position.z-6.5)+.65,0);
      if(this.state==='gripped'&&this.pull>=.96)this.activate();
    }
    if(this.state==='draining'){
      this.elapsed+=dt;const t=this.elapsed;
      this.level=mix(.02,-1.18,smooth(t,.4,4.2));
      let lo=0,hi=1;for(let i=0;i<14;i++){const mid=(lo+hi)/2;if(this.height(11+mid*LAKE.rx,6.5)<this.level)lo=mid;else hi=mid;}
      this.waterRadius=(lo+hi)/2;
      const park=smooth(t,.25,1.25);
      this.plug.position.set(11+4.8*park,2.59-2.29*park,6.5-3*park);this.plug.rotation.z=-.5*park;
      if(t>=1.25)this.g.hand.release('plug');
      this.vortex.visible=t<4.1;this.vortex.position.set(11,this.level+.04,6.5);this.vortex.rotation.y-=dt*4;
      this.vortex.scale.setScalar(Math.min(1,this.waterRadius*2.5));this.foam.forEach(m=>m.material.opacity=.8*(1-smooth(t,3.3,4.2)));
      if(t>=4.2){this.state='drained';this.vortex.visible=false;this.g.notice('Lake drained. The pickup can go on the lake bed.',4);}
      this.applyWater();
    }
    if(this.g.hand.owner==='plug'){
      this.plug.updateWorldMatrix(true,false);
      const grip=this.plug.localToWorld(V(0,.92,0)),axis=V(0,0,1).applyQuaternion(this.plug.quaternion);
      // Pinch the front and back of the ring's upper arc, not its empty centre.
      this.g.hand.aim('plug',grip,axis,.19);
    }
    this.halo.material.opacity=.5+.2*Math.sin(time*2);
    this.fish.forEach((f,i)=>{const a=time*.28+i*2.4,r=Math.min(.36,this.waterRadius*.65);f.root.position.set(11+Math.cos(a)*LAKE.rx*r,this.level-.08,6.5+Math.sin(a)*LAKE.rz*r);f.root.rotation.set(0,-a-Math.PI/2,0);f.tail.rotation.y=Math.sin(time*7+i)*.35;});
    this.batch.sync();
  }
}
