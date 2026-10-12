import * as THREE from 'three';
import { V, UP, toWorld, toLocal, GROUND, RADIUS, PULL_TRIGGER_X } from './layout.js';
import { RodSweep } from './rod-sweep.js';
import { TruckPull } from './truck-pull.js';

const smooth = t => { t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t); };
function rotateBoneTo(bone,child,target) {
  const origin=bone.getWorldPosition(V()),from=child.getWorldPosition(V()).sub(origin).normalize(),to=target.clone().sub(origin).normalize();
  const q=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  bone.updateWorldMatrix(true,true);
}
function legIK(fisher,side,target,footQ) {
  const B=fisher.B,a=B['thigh'+side],b=B['shin'+side],c=B['foot'+side];
  const hip=a.getWorldPosition(V()),knee=b.getWorldPosition(V()),ankle=c.getWorldPosition(V());
  const l1=hip.distanceTo(knee),l2=knee.distanceTo(ankle),d=target.clone().sub(hip),length=Math.min(d.length(),l1+l2-.00001);d.normalize();
  const along=(l1*l1-l2*l2+length*length)/(2*length),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const pole=fisher.forward.addScaledVector(d,-fisher.forward.dot(d)).normalize();
  const middle=hip.clone().addScaledVector(d,along).addScaledVector(pole,height);
  rotateBoneTo(a,b,middle);rotateBoneTo(b,c,target);
  c.quaternion.copy(c.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footQ));c.updateWorldMatrix(true,true);
}
function warning(parent,w,l) {
  const mat=new THREE.MeshBasicMaterial({color:0xf1483e,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,l),mat);mesh.rotation.x=-Math.PI/2;mesh.position.y=GROUND+.005;mesh.renderOrder=5;
  const group=new THREE.Group();group.add(mesh);parent.add(group);group.visible=false;
  const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(-w/2,GROUND+.006,-l/2),V(w/2,GROUND+.006,-l/2),V(w/2,GROUND+.006,l/2),V(-w/2,GROUND+.006,l/2)]),new THREE.LineBasicMaterial({color:0xff6c51,transparent:true,opacity:.9}));group.add(line);
  return {group,mat};
}
export class Hazards {
  constructor(game) {
    this.g=game;this.boots=[];
    game.fisher.c.group.updateMatrixWorld(true);
    for(const side of ['L','R']) {
      const bone=game.fisher.B['foot'+side],origin=toLocal(bone.getWorldPosition(V()));origin.y=GROUND+.086;
      const forward=game.fisher.forward.applyAxisAngle(UP,-game.truck.root.rotation.y);
      const target=origin.clone().addScaledVector(forward,side==='L'?.13:0);
      const zone=warning(game.root,.108,.276);
      const center=target.clone().addScaledVector(forward,.064);
      zone.group.position.set(center.x,0,center.z);zone.group.rotation.y=Math.atan2(forward.x,forward.z);
      this.boots.push({side,origin,target,forward,center,zone,footQ:bone.getWorldQuaternion(new THREE.Quaternion()),phase:'idle',t:0});
    }
    const D=game.truck.dims;this.halfContact=Math.sqrt(D.wheelR**2-(D.wheelR-.047)**2);
    this.rod=new RodSweep(game);
    this.pull=new TruckPull(game,this);
    this.dust=new THREE.Group();game.root.add(this.dust);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');
    const gradient=ctx.createRadialGradient(32,32,2,32,32,32);gradient.addColorStop(0,'rgba(215,188,146,0.85)');gradient.addColorStop(.45,'rgba(203,174,132,0.55)');gradient.addColorStop(1,'rgba(192,159,117,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    this.dustMaterial=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,opacity:0,depthWrite:false});
    for(let i=0;i<24;i++)this.dust.add(new THREE.Sprite(this.dustMaterial));
    this.ring=new THREE.Mesh(new THREE.RingGeometry(.85,1,48),new THREE.MeshBasicMaterial({color:0xcab18a,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));this.ring.rotation.x=-Math.PI/2;game.root.add(this.ring);
    this.reset();
  }
  reset(checkpoint=false) {
    for(const b of this.boots){b.phase=checkpoint||b.side==='R'?'done':'idle';b.t=0;b.zone.group.visible=false;}
    this.g.fisher.reset();
    this.g.truck.sim.reset();for(const w of this.g.truck.wheels){w.angle=0;w.spin.rotation.z=0;}
    this.rod.reset(checkpoint);this.pull.reset();this.shake=0;this.dustTime=2;this.dust.visible=false;this.ring.visible=false;
  }
  containsBoot(p,b,margin=RADIUS) {
    const v=p.clone().sub(b.center),f=b.forward,right=V(f.z,0,-f.x);
    const x=Math.max(0,Math.abs(v.dot(right))-.054),z=Math.max(0,Math.abs(v.dot(f))-.138);
    return x*x+z*z<=margin*margin;
  }
  update(dt) {
    const g=this.g,p=g.player;
    if(this.boots[0].phase==='idle'&&p.x>-1.32&&p.x<.1&&Math.abs(p.z-1.65)<.9) this.startBoot(0);
    for(const b of this.boots) {
      if(b.phase!=='warning')continue;
      b.t+=dt;b.zone.mat.opacity=.26+Math.sin(b.t*11)*.055;
      if(b.t>=1.4) {
        b.phase='done';b.zone.group.visible=false;this.shake=.6;g.audio.thud(.9,54);g.audio.whoosh(.42,.23);this.burst(b.center,1);
        g.notice('THOOM. Just a footstep.',2);
        if(this.containsBoot(p,b)) {g.fail('boot');break;}
      }
    }
    if(this.rod.phase==='idle'&&this.boots.every(b=>b.phase==='done')&&p.x>-.35&&p.x<.65)this.rod.start();
    this.rod.update(dt);
    // Position, not a scene timer or camera angle, triggers the pull just beyond the rod.
    // At walking speed the pickup settles before the ant reaches the rear axle.
    if(this.pull.phase==='idle'&&this.rod.phase==='done'&&p.x>=PULL_TRIGGER_X)this.pull.start();
    this.pull.update(dt);
  }
  burst(point,strength=1){this.dust.position.copy(point).setY(GROUND);this.ring.position.copy(point).setY(GROUND+.007);this.dustTime=0;this.dustStrength=strength;this.dust.visible=true;}
  updateEffects(dt){
    this.shake=Math.max(0,this.shake-dt);this.dustTime+=dt;const t=this.dustTime,s=this.dustStrength||1;
    this.dust.visible=t<1.1;this.dustMaterial.opacity=Math.max(0,.8*(1-t/1.1))*s;
    this.dust.children.forEach((p,i)=>{const a=i*2.4,r=.075+(i%3)*.025+t*(.18+(i%5)*.055);p.position.set(Math.cos(a)*r,.018+Math.sin(Math.min(1,t/1.1)*Math.PI)*(.05+i%3*.03),Math.sin(a)*r);p.scale.setScalar((.055+(i%4)*.012+t*.22)*s);});
    this.ring.visible=t<.58;this.ring.scale.setScalar(.09+t*.75);this.ring.material.opacity=Math.max(0,.25*(1-t/.58))*s;
  }
  startBoot(i) { const b=this.boots[i];b.phase='warning';b.t=0;b.zone.group.visible=true;this.g.notice(i?'One more very normal human step.':'He moved a foot. This is a major event.'); }
  pose() {
    const f=this.g.fisher;
    if(this.pull.u>0){
      for(const b of this.boots){b.sole=toLocal(f.B['foot'+b.side].getWorldPosition(V())).addScaledVector(b.forward,.064);b.lift=0;}
      return;
    }
    f.B.pelvis.position.y-=.025;f.c.group.updateMatrixWorld(true);
    for(const b of this.boots) {
      let p=b.phase==='done'?b.target.clone():b.origin.clone();
      if(b.phase==='warning') {
        p.lerp(b.target,smooth(b.t/.65));
        const lift=b.t<1.24?smooth(b.t/.38):1-((b.t-1.24)/.16)**2;
        p.y+=Math.max(0,lift)*.24;
      }
      legIK(f,b.side,toWorld(p),b.footQ);
      // Actual posed sole is the stationary obstacle. Warnings alone never block or hurt.
      b.sole=toLocal(f.B['foot'+b.side].getWorldPosition(V())).addScaledVector(b.forward,.064);
      b.lift=p.y-b.origin.y;
    }
    f.c.group.updateMatrixWorld(true);
  }
  solids() {
    const shapes=[];
    for(const b of this.boots)if(b.sole&&b.phase!=='warning'&&b.lift<.045)shapes.push({type:'box',x:b.sole.x,z:b.sole.z,hx:.054,hz:.138,yaw:Math.atan2(b.forward.x,b.forward.z)});
    if(this.pull.phase!=='moving')for(const w of this.g.truck.wheels) shapes.push({type:'box',...this.pull.wheelPose(w),hx:this.halfContact,hz:.122});
    return shapes;
  }
  cameraPoint(pivot,desired){
    const D=this.g.truck.dims,delta=desired.clone().sub(pivot);
    // Sample a short boom against tires and boots; avoids raycasting dense character meshes.
    for(let i=2;i<=18;i++){
      const p=pivot.clone().addScaledVector(delta,i/18);
      const tireHit=this.g.truck.wheels.some(w=>{
        const pose=this.pull.wheelPose(w);
        const dx=p.x-pose.x,dz=p.z-pose.z,co=Math.cos(pose.yaw),si=Math.sin(pose.yaw),x=dx*co-dz*si,z=dx*si+dz*co;
        return Math.abs(z)<.145&&x*x+(p.y-D.wheelR)**2<(D.wheelR+.012)**2;
      });
      const bootHit=this.boots.some(b=>{
        if(!b.sole||p.y<b.sole.y-.086||p.y>b.sole.y+.055)return false;
        const d=p.clone().sub(b.sole),right=V(b.forward.z,0,-b.forward.x);
        return Math.abs(d.dot(right))<.065&&Math.abs(d.dot(b.forward))<.15;
      });
      const truckPoint=this.pull.toTruck(p),ceilingHit=truckPoint.y>.215&&truckPoint.x>D.frontX&&truckPoint.x<D.rearX&&Math.abs(truckPoint.z)<.79;
      if(tireHit||bootHit||ceilingHit)return pivot.clone().addScaledVector(delta,Math.max(.16,(i-1)/18));
    }
    return desired;
  }
  get bootDanger(){return this.boots.some(b=>b.phase==='warning');}
}
