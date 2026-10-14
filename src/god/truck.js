import * as THREE from 'three';
import { HOME } from '../driver/layout.js';
import { V,UP,ring,clamp } from './common.js';

export class DivineTruck {
  constructor(game){
    this.g=game;this.truck=game.truck;this.root=this.truck.root;
    this.marker=ring(game.scene,1,0xffe4a0,.035);this.marker.rotation.set(0,0,0);this.marker.frustumCulled=false;this.markerSource=this.marker.geometry.attributes.position.array.slice();
    this.hand=game.hand.root;
    this.shadow=this.root.children.find(o=>o.isMesh&&o.geometry.type==='PlaneGeometry');
    this.reset();
  }
  local(p,center=this.root.position){return p.clone().sub(center).applyAxisAngle(UP,-HOME.yaw);}
  world(p,center=this.root.position){return p.clone().applyAxisAngle(UP,HOME.yaw).add(center);}
  distance(p,center=this.root.position){const q=this.local(p,center);return Math.hypot(Math.max(0,Math.abs(q.x)-2.95),Math.max(0,Math.abs(q.z)-1.18));}
  valid(p,{pushingAnt=false}={}){
    if(p.x<-5.5||p.x>14.5||p.z<1||p.z>10.5)return false;
    const g=this.g;
    if(this.distance(g.fisher.pos,p)<.63||this.distance(g.bucketPosition,p)<.34)return false;
    for(const tree of g.world.trees.list)if(this.distance(V(tree[0],0,tree[1]),p)<.6)return false;
    if(!pushingAnt&&g.giant&&this.distance(g.giant.position,p)<Math.max(g.giant.radius,g.giant.state==='growing'?2.25:0)+.12)return false;
    if(g.lake.state!=='drained')for(const x of [-2.8,0,2.8])for(const z of [-1.1,0,1.1]){const q=this.world(V(x,0,z),p);if(g.lake.wet(q.x,q.z))return false;}
    return true;
  }
  support(p){
    const d=this.truck.dims,heights=[];
    for(const x of [d.axleF,d.axleR])for(const z of [-d.track,d.track]){const q=this.world(V(x,0,z),p);heights.push(this.g.lake.height(q.x,q.z));}
    const [fl,fr,rl,rr]=heights,roll=Math.atan2((fr+rr-fl-rl)/2,2*d.track),pitch=Math.atan2((rl+rr-fl-fr)/2,d.axleR-d.axleF);
    const fittedPitch=clamp(pitch,-.3,.3),fittedRoll=clamp(roll,-.3,.3),rotation=new THREE.Euler(-fittedRoll,0,fittedPitch);
    // Re-evaluate the clamped support plane, preventing wheel penetration even
    // when a placement straddles a steeper part of the bank.
    let y=-Infinity,i=0;for(const x of [d.axleF,d.axleR])for(const z of [-d.track,d.track])y=Math.max(y,heights[i++]-V(x,0,z).applyEuler(rotation).y);
    return {y,pitch:fittedPitch,roll:fittedRoll};
  }
  reset(){this.held=false;this.settle=0;this.lift=0;this.truck.sim.reset();this.root.rotation.set(0,HOME.yaw,0);this.target=this.root.position.clone();this.safe=this.target.clone();this.g.hand.release('truck');this.marker.visible=false;if(this.shadow)this.shadow.visible=true;}
  begin(){if(this.held)return true;this.g.lake.release();if(!this.g.hand.grab('truck')){this.g.notice('Setting the plug down…',1);return false;}this.held=true;this.settle=0;this.safe.copy(this.root.position).setY(0);this.target.copy(this.safe);this.marker.visible=true;this.g.audio.effect('lift');this.g.notice('Pinch the pickup. Release to place it.',3);return true;}
  move(p){
    p.x=clamp(p.x,-5.5,14.5);p.z=clamp(p.z,1,10.5);p.y=0;
    if(this.valid(p)){this.safe.copy(p);this.target.copy(p);this.blocked=false;}
    else {this.target.copy(this.safe);this.blocked=true;}
    this.marker.material.color.setHex(this.blocked?0xf1a66e:0xffe4a0);
  }
  release(){if(!this.held)return;this.held=false;this.target.copy(this.safe);this.settle=1.1;this.g.hand.release('truck');this.marker.visible=false;this.g.audio.effect('land');this.g.notice('Still state property, apparently.',2.6);}
  pushByAnt(delta){
    if(this.held||this.lift>.02||this.settle>.05)return false;
    const next=this.root.position.clone().add(delta).setY(0);
    if(!this.valid(next,{pushingAnt:true}))return false;
    // The ant and truck advance by the same bounded step. There is no spring
    // chase that could let the head pass into a stationary bumper.
    this.root.position.copy(next);this.target.copy(next);this.safe.copy(next);
    const support=this.support(next);this.root.position.y=support.y;this.truck.tilt.rotation.set(-support.roll,0,support.pitch);
    const travel=delta.clone().applyAxisAngle(UP,-HOME.yaw).x;
    for(const w of this.truck.wheels){w.angle-=travel/this.truck.dims.wheelR;w.spin.rotation.z=w.angle;}
    this.truck.body.position.y=Math.sin(this.g.time*23)*.012;
    this.root.updateMatrixWorld(true);return true;
  }
  update(dt){
    const desired=this.held&&this.g.hand.ready('truck')?2.65:0;this.lift+=(desired-this.lift)*(1-Math.exp(-dt*(this.held?9:12)));
    if(Math.abs(this.lift)<.003)this.lift=0;
    this.root.position.x+=(this.target.x-this.root.position.x)*(1-Math.exp(-dt*18));this.root.position.z+=(this.target.z-this.root.position.z)*(1-Math.exp(-dt*18));
    const support=this.support(this.root.position);this.root.position.y=support.y+this.lift;
    this.truck.tilt.rotation.set(-support.roll*(1-this.lift/2.65),0,support.pitch*(1-this.lift/2.65));
    this.settle=Math.max(0,this.settle-dt);
    const bounce=this.settle>0?Math.sin((1.1-this.settle)*23)*.07*this.settle:0;
    this.truck.body.position.y=bounce;
    if(this.held){this.truck.body.updateWorldMatrix(true,false);this.g.hand.aim('truck',this.truck.body.localToWorld(V(-.1,1.46,0)),V(0,0,1).applyQuaternion(this.truck.body.getWorldQuaternion(new THREE.Quaternion())),1.97);}
    if(this.marker.visible){
      const attribute=this.marker.geometry.attributes.position;
      for(let i=0;i<attribute.count;i++){const q=this.world(V(this.markerSource[i*3]*3.1,0,this.markerSource[i*3+1]*1.35),this.target);attribute.setXYZ(i,q.x,this.g.lake.height(q.x,q.z)+.04,q.z);}
      attribute.needsUpdate=true;
    }
    if(this.shadow)this.shadow.visible=this.lift<.04&&support.y>-.05;
  }
  roofAt(x,z){
    // Body space includes the driver, suspension, and lake-bed tilt.
    this.truck.body.updateWorldMatrix(true,false);
    const q=this.truck.body.worldToLocal(V(x,this.root.position.y+1.8,z));
    if(Math.abs(q.x)<.96&&Math.abs(q.z)<.98)return this.truck.body.localToWorld(V(q.x,this.truck.dims.roof+.06,q.z));
    if(q.x>=-2.65&&q.x<-.96&&Math.abs(q.z)<.95)return this.truck.body.localToWorld(V(q.x,1.14,q.z));
    if(q.x>=.96&&q.x<2.65&&Math.abs(q.z)<.88)return this.truck.body.localToWorld(V(q.x,.72,q.z));
    return null;
  }
}
