import * as THREE from 'three';
import { FishingLine } from '../gameplay/rod.js';
import { makeLure } from '../gameplay/fishing.js';
import { HOME } from '../driver/layout.js';
import { V, UP, toWorld, toLocal, GROUND, RADIUS } from './layout.js';

const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
const cross=(o,a,b)=>(a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
function hull(points){
  points.sort((a,b)=>a.x-b.x||a.z-b.z);const lo=[],hi=[];
  for(const p of points){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}
  for(const p of [...points].reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}
  return lo.slice(0,-1).concat(hi.slice(0,-1));
}

// The fisherman hauls the pickup over the colony trail, opening a tunnel beneath it.
// Every warning and collision uses the same four wheel transforms as the pickup.
export class TruckPull {
  constructor(game,hazards){
    this.g=game;this.h=hazards;this.u=0;
    this.line=new FishingLine(game.scene,new THREE.Vector2(game.size.w,game.size.h));
    this.line.mat.linewidth=2;this.lure=makeLure(1.7);game.scene.add(this.lure);
    const D=game.truck.dims,T=game.truck.tumble,y=1.60;
    this.anchor=V(D.doorRear.x0+.11,y,T.a[0]-(y-T.a[1])*T.n[1]/T.n[0]+.012);
    this.zones=new THREE.Group();game.root.add(this.zones);
    this.material=new THREE.MeshBasicMaterial({color:0xf1483e,transparent:true,opacity:.27,depthWrite:false,side:THREE.DoubleSide});
    const edgeMat=new THREE.LineBasicMaterial({color:0xff6c51,transparent:true,opacity:.9});
    for(const wheel of game.truck.wheels){
      const pts=[];
      for(let i=0;i<=24;i++){
        const p=this.wheelPose(wheel,i/24),co=Math.cos(p.yaw),si=Math.sin(p.yaw);
        for(const x of [-hazards.halfContact,hazards.halfContact])for(const z of [-.122,.122])pts.push(V(p.x+co*x+si*z,GROUND+.006,p.z-si*x+co*z));
      }
      const outline=hull(pts),vertices=[],indices=[];
      outline.forEach(p=>vertices.push(...p.toArray()));for(let i=1;i<outline.length-1;i++)indices.push(0,i,i+1);
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);
      const mesh=new THREE.Mesh(geo,this.material);mesh.renderOrder=5;this.zones.add(mesh);
      this.zones.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outline),edgeMat));
    }
    this.reset();
  }
  reset(){
    this.phase='idle';this.t=0;this.u=0;this.zones.visible=false;this.line.line.visible=false;this.lure.visible=false;this.line.inited=false;
    this.flightFrom=null;this.triggerPosition=null;this.fisherStart=this.g.fisher.home.clone();this.bucketBumped=false;this.g.bucket.reset();
    const f=this.g.fisher;f.walkVel.set(0,0,0);f.reeling=false;f.tension=0;f.lineDir=null;f.setLean({back:0});f.setHold('ready',5);
  }
  get danger(){return this.phase==='warning'||this.phase==='moving';}
  poseAt(u=this.u){
    return {x:-.25*u,z:1.60*u,yaw:-.10*u};
  }
  wheelPose(w,u=this.u){
    const p=this.poseAt(u),co=Math.cos(p.yaw),si=Math.sin(p.yaw),z=w.s*this.g.truck.dims.track;
    return {x:p.x+w.x*co+z*si,z:p.z-w.x*si+z*co,yaw:p.yaw};
  }
  toTruck(point){const p=this.poseAt();return point.clone().sub(V(p.x,0,p.z)).applyAxisAngle(UP,-p.yaw);}
  under(point){const p=this.toTruck(point);return this.phase==='done'&&p.x>-.7&&p.x<2.55&&Math.abs(p.z)<.72;}
  hookWorld(){return this.g.truck.worldPoint(this.anchor.clone(),V());}
  start(){
    this.phase='warning';this.t=0;this.zones.visible=true;this.line.line.visible=true;this.lure.visible=true;
    const f=this.g.fisher;this.fisherStart=f.pos.clone();f.setLeft('rod');f.setHold('back',7);f.lookAt(()=>this.hookWorld(),6);f.faceToward(()=>this.hookWorld());
    this.triggerPosition=this.g.player.clone();this.g.checkpoint='crossing';this.g.notice('He hooked the truck! Red ground = moving tires.',3);
  }
  contains(p,w,u=this.u,margin=RADIUS){
    const q=this.wheelPose(w,u),co=Math.cos(q.yaw),si=Math.sin(q.yaw),dx=p.x-q.x,dz=p.z-q.z;
    const x=Math.max(0,Math.abs(co*dx-si*dz)-this.h.halfContact),z=Math.max(0,Math.abs(si*dx+co*dz)-.122);
    return x*x+z*z<=margin*margin;
  }
  update(dt){
    if(!this.danger)return;
    const g=this.g,f=g.fisher,before=this.t;this.t+=dt;
    if(before<.2&&this.t>=.2){f.setHold('forward',18);f.whip=.22;g.audio.whoosh(.28,.28);}
    if(before<.32&&this.t>=.32)this.flightFrom=f.tipWorld.clone();
    if(before<.6&&this.t>=.6){f.setHold('fight',6);f.setLeft('reel');f.reeling=true;g.audio.click(.22,1900,.03);}
    if(before<.8&&this.t>=.8){f.setLean({back:.65});g.audio.creak(.18,520);}
    if(this.t>=1.25){
      if(this.phase==='warning'){this.phase='moving';g.audio.groan(.60);g.audio.thud(.45,50);this.h.shake=.36;this.h.burst(V(1.60,0,.83),.8);}
      const old=this.u;this.u=smooth((this.t-1.25)/.90);f.tension=.92*Math.sin(Math.PI*Math.min(1,(this.t-.8)/1.55));
      const p=this.poseAt();g.truck.root.position.copy(toWorld(V(p.x,0,p.z)));g.truck.root.rotation.y=HOME.yaw+p.yaw;
      // Step backwards with the load instead of letting the body pass through his boots.
      const retreat=V(-.25,0,1.85).applyAxisAngle(UP,HOME.yaw);
      f.pos.copy(this.fisherStart).addScaledVector(retreat,old);f.walkVel.copy(retreat).multiplyScalar(dt>0?(this.u-old)/dt:0);
      g.truck.body.rotation.x=Math.sin(this.u*Math.PI)*.028;g.truck.body.position.y=-Math.sin(this.u*Math.PI)*.012;
      // The original pail stays put until the approaching side panel actually reaches it.
      const bucketHome=toLocal(g.bucket.home),bucketInTruck=this.toTruck(bucketHome),push=Math.max(0,g.truck.dims.halfW+.35-bucketInTruck.z);
      g.bucket.root.position.copy(toWorld(bucketHome.add(V(Math.sin(p.yaw),0,Math.cos(p.yaw)).multiplyScalar(push))));
      if(push>0&&!this.bucketBumped){this.bucketBumped=true;g.bucket.splash(.2);g.audio.creak(.10,850);}
      for(const w of g.truck.wheels){
        const a=this.wheelPose(w,old),b=this.wheelPose(w);
        w.angle-=((b.x-a.x)*Math.cos(p.yaw)-(b.z-a.z)*Math.sin(p.yaw))/g.truck.dims.wheelR;w.spin.rotation.z=w.angle;
        if(this.u>old)for(let i=0;i<=4;i++)if(this.contains(g.player,w,THREE.MathUtils.lerp(old,this.u,i/4))){g.fail('pull');break;}
      }
      g.truck.root.updateMatrixWorld(true);
    }
    this.material.opacity=.27+Math.sin(this.t*10)*.04;
    if(this.t>=2.25){this.phase='done';this.zones.visible=false;f.walkVel.set(0,0,0);f.reeling=false;f.tension=0;f.setLean({back:0});f.setHold('ready',3);g.notice('Now crawl underneath. Between the wheels, then home.',5);}
  }
  updateLine(dt){
    if(this.phase==='idle')return;
    const f=this.g.fisher,tip=f.tipWorld;
    let end=null;
    if(this.t>=.6)end=this.hookWorld();
    else if(this.t>=.32){const u=smooth((this.t-.32)/.28);end=(this.flightFrom||tip).clone().lerp(this.hookWorld(),u);end.y+=Math.sin(u*Math.PI)*.3;}
    this.line.length=end?tip.distanceTo(end)*(this.phase==='moving'?1.002:1.04)+.02:.3;
    this.line.simulate(dt,tip,end);this.lure.position.copy(this.line.end);this.lure.quaternion.setFromUnitVectors(V(0,1,0),this.line.endDir());f.lineDir=this.line.tipDir();
  }
}
