import { Ant } from '../ant/ant.js';
import { V,UP,ring,smooth,mix } from './common.js';
import { AntBlessing } from './blessing.js';
import { AntForager } from './ant-forager.js';

export class GiantAnt {
  constructor(game){this.g=game;this.ant=new Ant(game.scene,true);this.halo=ring(game.scene,.5,0xffe9a3,.055);this.blessing=new AntBlessing(game);this.jaws=this.ant.body.children.filter(m=>m.isMesh&&m.geometry.type==='CylinderGeometry'&&m.position.x>.03).map(mesh=>({mesh,rotation:mesh.quaternion.clone()}));this.forager=new AntForager(this);this.reset();}
  get radius(){return .049*this.scale;}
  reset(){this.state='small';this.elapsed=0;this.walk=0;this.scale=2;this.heading=0;this.position=V(2.57,0,7.35);this.target=this.position.clone();this.path=[];this.ant.root.scale.setScalar(this.scale);this.ant.pose(this.position,0,0,false);this.ant.body.rotation.z=0;this.ant.crumb.visible=true;this.jaws.forEach(j=>j.mesh.quaternion.copy(j.rotation));this.forager.reset();this.halo.visible=true;this.blessing.reset();}
  startGrowth(){this.state='growing';this.elapsed=0;this.blessing.start();this.g.audio.effect('grow');}
  activate(){if(this.state!=='small')return false;this.state='making-room';this.elapsed=0;this.halo.visible=false;if(this.free(this.position,2.25))this.startGrowth();this.chooseTarget();this.g.notice('Same ant. Bigger lunch.',3);return true;}
  free(p,r,bumperContact=false){
    const g=this.g;if(p.x<-5.5||p.x>16||p.z<.8||p.z>13)return false;
    if(g.lake.wet(p.x,p.z)||(!bumperContact&&g.vehicle.distance(p)<r+.16)||p.clone().setY(0).distanceTo(g.fisher.pos.clone().setY(0))<r+.65||p.clone().setY(0).distanceTo(g.bucketPosition.clone().setY(0))<r+.3)return false;
    return !g.world.trees.list.some(t=>Math.hypot(p.x-t[0],p.z-t[1])<r+.55);
  }
  chooseTarget(){
    const c=this.g.truck.root.position,choices=[];
    for(let i=0;i<32;i++){const a=i/32*Math.PI*2,p=V(c.x+Math.cos(a)*5.5,0,c.z+Math.sin(a)*5.5);if(this.free(p,2.25)&&p.clone().sub(this.position).setY(0).length()>1.3)choices.push(p);}
    if(this.state==='making-room')for(const radius of [.75,1.5,2.25,3,4])for(let i=0;i<24;i++){
      const a=i/24*Math.PI*2,p=this.position.clone().add(V(Math.cos(a)*radius,0,Math.sin(a)*radius)).setY(0);
      if(this.free(p,2.25)&&p.distanceTo(c)<8)choices.push(p);
    }
    choices.sort((a,b)=>a.distanceTo(this.position)-b.distanceTo(this.position));
    this.path=[];this.target=this.position.clone();
    for(const candidate of choices.slice(0,10)){const path=this.findPath(candidate,this.state==='making-room'?.12:2.25);if(path){this.path=path;this.target=candidate;break;}}
    this.walk=7;this.truckAt=c.clone();
  }
  findPath(goal,radius){
    // Tiny bounded navigation grid, rebuilt only on growth or a new truck position.
    // Clearance uses the final giant footprint, including diagonal corner checks.
    const step=.25,key=(x,z)=>x+','+z,start={x:Math.round(this.position.x/step),z:Math.round(this.position.z/step)},end={x:Math.round(goal.x/step),z:Math.round(goal.z/step)};
    const startKey=key(start.x,start.z),endKey=key(end.x,end.z),nodes=new Map(),open=[];
    const heuristic=(x,z)=>Math.hypot(x-end.x,z-end.z),first={...start,g:0,f:heuristic(start.x,start.z),parent:null};nodes.set(startKey,first);open.push(first);
    const walkable=new Map(),free=(x,z)=>{const k=key(x,z);if(!walkable.has(k))walkable.set(k,this.free(V(x*step,0,z*step),radius));return walkable.get(k);};
    if(!free(end.x,end.z))return null;
    let visited=0;
    while(open.length&&visited++<3500){
      let index=0;for(let i=1;i<open.length;i++)if(open[i].f<open[index].f)index=i;
      const node=open.splice(index,1)[0];if(node.closed)continue;node.closed=true;
      if(key(node.x,node.z)===endKey){const path=[goal.clone()];let n=node;while(n.parent){path.unshift(V(n.x*step,0,n.z*step));n=n.parent;}return path;}
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
        if(!dx&&!dz)continue;const x=node.x+dx,z=node.z+dz,k=key(x,z);
        if(!free(x,z)||(dx&&dz&&(!free(node.x+dx,node.z)||!free(node.x,node.z+dz))))continue;
        const cost=node.g+Math.hypot(dx,dz),old=nodes.get(k);if(old&&old.g<=cost)continue;
        const next={x,z,g:cost,f:cost+heuristic(x,z),parent:node};nodes.set(k,next);open.push(next);
      }
    }
    return null;
  }
  update(dt,time){
    if(this.state==='growing'){this.elapsed+=dt;this.scale=mix(2,45,smooth(this.elapsed,0,1.8));if(this.elapsed>=1.8){this.state='giant';this.forager.begin();}}
    if(this.state!=='small'&&this.state!=='giant'&&this.truckAt.distanceTo(this.g.truck.root.position)>1.8&&!this.g.vehicle.held)this.chooseTarget();
    let moved=false;
    if(this.state==='giant')moved=this.forager.update(dt);
    else if(this.state!=='small'){
      // Try the direct step, then tangents around obstructions. Test the expanded ant
      // footprint, so neither its growth nor its stroll can intersect the pickup.
      if(this.path.length&&this.path[0].clone().sub(this.position).setY(0).length()<.1)this.path.shift();
      const r=this.radius,d=(this.path[0]||this.target).clone().sub(this.position).setY(0),step=Math.min(d.length(),dt*1.5);
      if(step>.005&&this.walk>0&&this.state!=='growing'){
        const angle=Math.atan2(d.z,d.x);
        for(const turn of [0,.55,-.55,1.1,-1.1,1.6,-1.6]){const p=this.position.clone().add(V(Math.cos(angle+turn)*step,0,Math.sin(angle+turn)*step));if(this.free(p,r)){this.position.copy(p);this.heading=-(angle+turn);moved=true;break;}}
      }
      // If a growing foot would meet a solid, slide gently out before enlarging.
      if(!this.free(this.position,r)){
        let best=null;
        for(let i=0;i<32;i++){const a=i/32*Math.PI*2,p=this.position.clone().add(V(Math.cos(a)*.12,0,Math.sin(a)*.12));if(this.free(p,r)){best=p;break;}}
        if(best){this.position.copy(best);moved=true;}else if(this.state==='growing'){this.scale=Math.max(2,this.scale-dt*30);this.elapsed=Math.min(this.elapsed,1.6);}
      }
      if(this.state!=='growing')this.walk=Math.max(0,this.walk-dt);
      if(this.state==='making-room'&&this.free(this.position,2.25)){this.startGrowth();this.chooseTarget();}
    }
    this.position.y=this.g.lake.height(this.position.x,this.position.z);
    this.ant.root.scale.setScalar(this.scale);this.ant.pose(this.position,this.heading,dt*.36,moved);
    this.forager.pose(time,dt);
    // Retarget the lower leg segments to the actual terrain, including a drained
    // shoreline. The original ant animation still drives the knees and antennae.
    this.ant.root.updateMatrixWorld(true);
    for(const {leg,side,j} of this.ant.legs){
      const knee=V((j-1)*.012,.001,side*.024),foot=leg.localToWorld(V((j-1)*.021,-.018,side*.036));foot.y=this.g.lake.height(foot.x,foot.z)+.012;
      leg.worldToLocal(foot);const segment=leg.children[1],d=foot.clone().sub(knee);segment.position.copy(knee).add(foot).multiplyScalar(.5);segment.scale.y=d.length();segment.quaternion.setFromUnitVectors(UP,d.normalize());
    }
    this.halo.position.copy(this.position).add(V(0,.03,0));this.halo.material.opacity=.55+.2*Math.sin(time*2.4);
    this.blessing.update(dt,this.position,this.scale);
  }
}
