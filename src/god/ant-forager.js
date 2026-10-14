import { V,smooth,clamp } from './common.js';
import { GROUND } from '../ant/layout.js';

// Small, deterministic behaviours for this one ant. Navigation still uses the
// giant's existing clearance grid; only its final, straight bumper approach
// allows the mandibles to touch the vehicle.
export class AntForager {
  constructor(giant){this.ant=giant;this.g=giant.g;this.reset();}
  reset(){
    this.behavior='idle';this.timer=0;this.path=[];this.food=null;this.elapsed=0;
    this.pushes=0;this.fishEaten=0;this.pushedDistance=0;this.pushesAtParking=0;
    this.truckAt=this.g.truck.root.position.clone();this.blockedTime=0;this.pushPitch=0;this.lean=0;
    this.repathTime=0;this.truckFirst=true;this.wasHeld=false;
  }
  cancel(delay=0){
    // A moving pickup takes priority, including during a meal. Return the same
    // pooled fish to the ground instead of leaving it owned by an idle ant.
    if(this.food?.state==='eating'){this.food.state='flop';this.food.root.position.copy(this.foodStart);this.food.root.scale.setScalar(this.foodScale);}
    this.behavior='idle';this.path=[];this.food=null;this.timer=delay;this.blockedTime=0;
  }
  begin(){this.cancel();this.truckAt.copy(this.g.truck.root.position);this.truckFirst=true;this.repathTime=0;}
  yieldTruck(){if(['approach','push'].includes(this.behavior)){this.behavior='backoff';this.elapsed=0;}}
  edible(f){return f.state==='flop'&&!f.roof&&f.age<15&&!this.g.lake.wet(f.root.position.x,f.root.position.z)&&!this.g.vehicle.roofAt(f.root.position.x,f.root.position.z);}
  contactPose(contact,normal,delta=V()){
    const a=this.ant,v=this.g.vehicle,body=this.g.truck.body;
    body.updateWorldMatrix(true,false);
    const surface=body.localToWorld(contact.clone().setY(Math.abs(contact.x)<1?1.65:1.02)).add(delta);
    let reach=1.98,pitch=0,goal;
    // The bank can put the ant above the pickup. Bow the body and adjust its
    // stopping distance so its mandibles still meet metal, rather than pushing
    // empty air above the tailgate. All six feet are retargeted by GiantAnt.
    for(let i=0;i<4;i++){
      goal=v.world(contact.clone().addScaledVector(normal,reach)).add(delta).setY(0);
      const ground=this.g.lake.height(goal.x,goal.z)+GROUND;
      const desired=clamp(ground+.023*a.scale,surface.y-.5,surface.y);
      pitch=clamp(Math.asin(clamp((desired-ground)/(Math.hypot(.044,.023)*a.scale),-1,1))-Math.atan2(.023,.044),-.5,.16);
      reach=(.044*Math.cos(pitch)-.023*Math.sin(pitch))*a.scale;
    }
    return {goal,pitch};
  }
  seekFood(){
    const a=this.ant;
    const choices=this.g.weather.fish.filter(f=>this.edible(f)).sort((x,y)=>x.root.position.distanceToSquared(a.position)-y.root.position.distanceToSquared(a.position));
    for(const f of choices.slice(0,6)){
      const point=f.root.position.clone().setY(0),angle=Math.atan2(a.position.z-point.z,a.position.x-point.x);
      for(const turn of [0,.6,-.6,1.2,-1.2,Math.PI]){
        const goal=point.clone().add(V(Math.cos(angle+turn)*1.85,0,Math.sin(angle+turn)*1.85));
        if(!a.free(goal,a.radius))continue;
        const path=a.findPath(goal,a.radius);if(!path)continue;
        this.food=f;this.path=path;this.behavior='food';this.blockedTime=0;return true;
      }
    }
    return false;
  }
  canPush(contact=this.contact,normal=this.normal){
    const a=this.ant,v=this.g.vehicle;if(!contact||v.held||v.lift>.02||v.settle>.05||this.pushesAtParking>=2)return false;
    const direction=v.world(normal.clone().negate(),V()).normalize(),destination=v.root.position.clone().addScaledVector(direction,1.15).setY(0);
    return v.valid(destination,{pushingAnt:true})&&a.free(this.contactPose(contact,normal).goal,a.radius,true);
  }
  truckPath(goal){
    const a=this.ant,d=goal.clone().sub(a.position).setY(0),steps=Math.ceil(d.length()/.2);
    // Most pursuit updates are an unobstructed straight walk. Only run the
    // clearance grid when the lake, props or truck actually block that segment.
    for(let i=1;i<=steps;i++)if(!a.free(a.position.clone().addScaledVector(d,i/steps),a.radius))return a.findPath(goal,a.radius);
    return [goal.clone()];
  }
  seekTruck(){
    const a=this.ant,v=this.g.vehicle;
    const options=[];
    for(const x of [-1,1]){
      options.push({contact:V(x*2.71,0,0),normal:V(x,0,0)});
      for(const z of [-1,1])options.push({contact:V(x*2.66,0,z*.92),normal:V(x,0,z).normalize()});
    }
    for(const z of [-1,1])for(const x of [-1.9,0,1.9])options.push({contact:V(x,0,z*.985),normal:V(0,0,z)});
    for(const option of options){option.goal=v.world(option.contact.clone().addScaledVector(option.normal,2.82)).setY(0);option.pushable=this.canPush(option.contact,option.normal);}
    options.sort((x,y)=>Number(y.pushable)-Number(x.pushable)||x.goal.distanceToSquared(a.position)-y.goal.distanceToSquared(a.position));
    for(const {contact,normal,goal} of options){
      if(!a.free(goal,a.radius))continue;
      const path=this.truckPath(goal);if(!path)continue;
      const direction=v.world(normal.clone().negate(),V()).normalize();
      this.contact=contact;this.normal=normal;this.direction=direction;this.path=path;this.behavior='truck';this.blockedTime=0;return true;
    }
    return false;
  }
  follow(dt){
    const a=this.ant;
    while(this.path.length&&this.path[0].clone().sub(a.position).setY(0).length()<(this.behavior==='truck'&&this.path.length===1?.004:.09))this.path.shift();
    if(!this.path.length)return false;
    const d=this.path[0].clone().sub(a.position).setY(0),step=Math.min(d.length(),dt*1.85),next=a.position.clone().addScaledVector(d.normalize(),step);
    if(a.free(next,a.radius)){a.position.copy(next);a.heading=-Math.atan2(d.z,d.x);this.blockedTime=0;return step>0;}
    this.blockedTime+=dt;if(this.blockedTime>.3)this.cancel();return false;
  }
  update(dt){
    if(dt<=0)return false;
    const a=this.ant,v=this.g.vehicle;
    this.repathTime=Math.max(0,this.repathTime-dt);
    const moved=Math.hypot(v.root.position.x-this.truckAt.x,v.root.position.z-this.truckAt.z)>.2;
    const grabbed=v.held&&!this.wasHeld;this.wasHeld=v.held;
    if(grabbed){this.truckFirst=true;if(['food','eating'].includes(this.behavior))this.cancel();}
    // Once the last leg of the route is clear, steer its endpoint every frame.
    // This lets a nearby ant match a slowly dragged pickup instead of stopping
    // between grid replans whenever it catches up with the previous endpoint.
    let tracking=false;
    if(['truck','waiting'].includes(this.behavior)&&this.path.length<=1&&this.contact){
      const goal=v.world(this.contact.clone().addScaledVector(this.normal,2.82)).setY(0);
      if(a.free(goal,a.radius)){
        tracking=true;
        if(goal.clone().sub(a.position).setY(0).length()>.004){this.path=[goal];this.behavior='truck';}
      }
    }
    if(moved&&this.repathTime===0){
      this.truckAt.copy(v.root.position);this.pushesAtParking=0;this.truckFirst=true;this.repathTime=.18;
      // Replan without an idle cooldown, even while the hand is carrying it.
      // Keep a short retreat only when the ant is still touching the bumper.
      if(!tracking&&(this.behavior!=='backoff'||v.distance(a.position)>a.radius+.16)){this.cancel();this.seekTruck();}
    }
    if(v.held)this.yieldTruck();
    if(this.behavior==='eating'){
      this.elapsed+=dt;
      if(this.elapsed>=1.5){
        const f=this.food;if(f?.state==='eating'){f.state='off';f.root.visible=false;this.fishEaten++;}
        this.cancel();this.timer=.5;
      }
      return false;
    }
    if(this.behavior==='food'&&!this.edible(this.food))this.cancel();
    if(this.behavior==='idle'){
      this.timer-=dt;if(this.timer<=0){
        const found=this.truckFirst||v.held?this.seekTruck():this.seekFood()||this.seekTruck();
        if(!found)this.timer=.25;
      }
      // Take the first step in the same frame that growth finishes and a path
      // is found, rather than adding an idle beat after the divine effect.
      if(this.behavior==='idle')return false;
    }
    if(this.behavior==='food'||this.behavior==='truck'){
      const moved=this.follow(dt);if(this.path.length||this.behavior==='idle')return moved;
      if(this.behavior==='food'){
        const d=this.food.root.position.clone().sub(a.position).setY(0);
        if(d.length()>2.2){this.cancel();return moved;}
        a.heading=-Math.atan2(d.z,d.x);this.behavior='eating';this.elapsed=0;
        this.food.state='eating';this.foodStart=this.food.root.position.clone();this.foodScale=this.food.root.scale.x;
        this.g.audio.effect('munch');this.g.notice('Bigger ant. Bigger appetite.',2);
      }else{this.truckFirst=false;this.behavior=this.canPush()?'approach':'waiting';this.timer=0;a.heading=-Math.atan2(this.direction.z,this.direction.x);}
      return moved;
    }
    if(this.behavior==='waiting'){
      const d=v.root.position.clone().sub(a.position);a.heading=-Math.atan2(d.z,d.x);
      this.timer-=dt;
      if(this.timer<=0&&!v.held){
        this.timer=.25;
        if(this.canPush())this.behavior='approach';
        else if(this.seekFood()||(this.pushesAtParking<2&&this.seekTruck()))return this.follow(dt);
      }
      if(this.behavior==='waiting')return false;
    }
    if(this.behavior==='approach'){
      if(v.held||v.lift>.02){this.cancel();return false;}
      const pose=this.contactPose(this.contact,this.normal),goal=pose.goal,d=goal.clone().sub(a.position).setY(0),step=Math.min(d.length(),dt*1.2),next=a.position.clone().addScaledVector(d.normalize(),step);
      this.pushPitch=pose.pitch*smooth(.85-d.length(),0,.6);
      if(!a.free(next,a.radius,true)){this.cancel();return false;}
      a.position.copy(next);a.heading=-Math.atan2(this.direction.z,this.direction.x);
      if(next.clone().setY(0).distanceTo(goal)<.025){this.behavior='push';this.elapsed=0;this.g.audio.effect('push');this.g.notice('That is ant property now.',2.5);}
      return step>0;
    }
    if(this.behavior==='push'){
      const delta=this.direction.clone().multiplyScalar(dt*.86),pose=this.contactPose(this.contact,this.normal,delta),next=pose.goal;
      if(a.free(next,a.radius,true)&&v.pushByAnt(delta)){
        a.position.copy(next);this.pushPitch=pose.pitch;this.truckAt.copy(v.root.position);this.elapsed+=dt;this.pushedDistance+=delta.length();
        if(this.elapsed<1.35)return true;
        this.pushes++;this.pushesAtParking++;
      }
      // Back off along the same safe line before finding another route.
      this.behavior='backoff';this.elapsed=0;return false;
    }
    if(this.behavior==='backoff'){
      const next=a.position.clone().addScaledVector(this.direction,-dt*1.2);
      if(a.free(next,a.radius,true)&&v.distance(next)>=v.distance(a.position)-.001){a.position.copy(next);this.elapsed+=dt;}
      else this.elapsed=1;
      if(this.elapsed>=.7)this.cancel();
      return true;
    }
    return false;
  }
  pose(time,dt){
    const a=this.ant,eating=this.behavior==='eating',pushing=this.behavior==='push';
    a.ant.crumb.visible=a.state!=='giant';
    this.lean+=((pushing||this.behavior==='approach'?this.pushPitch:0)-this.lean)*(1-Math.exp(-dt*18));
    a.ant.body.rotation.z=eating?-.15*smooth(this.elapsed,0,.3)+Math.sin(time*22)*.018:this.lean;
    for(const [i,jaw] of a.jaws.entries()){jaw.mesh.quaternion.copy(jaw.rotation);if(eating)jaw.mesh.rotateY((i?1:-1)*(.18+Math.sin(time*24)*.17));}
    if(!eating||this.food?.state!=='eating')return;
    a.ant.root.updateMatrixWorld(true);
    const mouth=a.ant.body.localToWorld(V(.044,.023,0));
    this.food.root.position.copy(this.foodStart).lerp(mouth,smooth(this.elapsed,0,.38));
    this.food.root.rotation.set(Math.PI/2,a.heading+Math.PI/2,Math.sin(time*24)*.12);
    this.food.root.scale.setScalar(this.foodScale*(1-smooth(this.elapsed,.48,1.45)));
    this.food.tail.rotation.y=Math.sin(time*22)*.5;
  }
}
