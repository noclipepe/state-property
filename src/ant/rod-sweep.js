import * as THREE from 'three';
import { V, UP, GROUND, RADIUS, toWorld, toLocal } from './layout.js';

const smooth=t=>THREE.MathUtils.smoothstep(t,0,1);
function pointBone(bone,child,target) {
  const origin=bone.getWorldPosition(V());
  const q=new THREE.Quaternion().setFromUnitVectors(child.getWorldPosition(V()).sub(origin).normalize(),target.clone().sub(origin).normalize()).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  bone.updateWorldMatrix(true,true);
}

// Direct the existing hand and rod together. The rod stays full length, gripped by the
// original character; only its last few centimetres enter the ant's collision height.
export class RodSweep {
  constructor(game) {
    this.g=game;this.grip=V(-.70,.96,1.80);this.startAngle=-.65;this.endAngle=.30;
    const length=1.35-.5*.05**2/1.62;
    this.down=Math.asin((this.grip.y-.026)/Math.hypot(length,.05))-Math.atan2(.05,length);
    this.radius=length*Math.cos(this.down)-.05*Math.sin(this.down);
    this.inner=this.radius-.072;this.outer=this.radius+.022;
    const vertices=[],indices=[];
    for(let i=0;i<=40;i++) {
      const a=THREE.MathUtils.lerp(this.startAngle-.025,this.endAngle+.025,i/40);
      for(const r of [this.inner,this.outer])vertices.push(this.grip.x+Math.cos(a)*r,GROUND+.006,this.grip.z+Math.sin(a)*r);
      if(i<40){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
    this.material=new THREE.MeshBasicMaterial({color:0xf1483e,transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide});
    this.zone=new THREE.Mesh(geo,this.material);this.zone.renderOrder=5;game.root.add(this.zone);
    this.reset();
  }
  reset(done=false){this.phase=done?'done':'idle';this.t=0;this.zone.visible=false;this.lastContacts=null;this.rest=null;}
  get danger(){return ['warning','sweeping','lifting'].includes(this.phase);}
  start(){
    this.phase='warning';this.t=0;this.zone.visible=true;
    this.rest={butt:this.g.fisher.rod.pointWorld(0),dir:this.g.fisher.rod.pointWorld(1).sub(this.g.fisher.rod.pointWorld(0)).normalize()};
    if(this.g.fisher.leftMode==='rod')this.g.fisher.setLeft('open');
    this.g.notice('ROD SWEEP · Wait before the red arc.',3.2);this.g.audio.rustle();
  }
  update(dt){
    if(!this.danger)return;
    this.t+=dt;this.material.opacity=.30+Math.sin(this.t*10)*.065;
    if(this.phase==='warning'&&this.t>=1.5){this.phase='sweeping';this.g.audio.whoosh(.8,.24);}
    if(this.t>=2.4)this.phase='lifting';
    if(this.t>=3.05){this.phase='done';this.zone.visible=false;this.lastContacts=null;this.g.notice('Clear. A leaf-sized breather ahead.',2);}
  }
  pose(dt){
    if(!this.danger)return;
    const f=this.g.fisher;
    const angle=THREE.MathUtils.lerp(this.startAngle,this.endAngle,smooth((this.t-1.5)/.9));
    const lower=smooth(this.t/1.2),raise=smooth((this.t-2.4)/.65);
    const dir=V(Math.cos(angle)*Math.cos(this.down),-Math.sin(this.down),Math.sin(angle)*Math.cos(this.down)).applyAxisAngle(UP,this.g.root.rotation.y);
    const grip=toWorld(this.grip),butt=grip.clone().addScaledVector(dir,-.27);
    // Lower to just above the ground during the warning, then sweep and lift clear.
    const lift=this.t<1.5?.18*(1-smooth((this.t-1.2)/.3)):0;
    butt.y+=lift;
    butt.lerp(this.rest.butt,1-lower+raise*lower);dir.lerp(this.rest.dir,1-lower+raise*lower).normalize();
    const X=UP.clone().cross(dir).normalize(),Y=dir.clone().cross(X).normalize();
    const hand=butt.clone().addScaledVector(dir,.27).addScaledVector(Y,.07).addScaledVector(X,-.03);
    const B=f.B,a=B.upperArmR,b=B.forearmR,c=B.handR;
    const shoulder=a.getWorldPosition(V()),l1=shoulder.distanceTo(b.getWorldPosition(V())),l2=b.getWorldPosition(V()).distanceTo(c.getWorldPosition(V()));
    const d=hand.clone().sub(shoulder),length=Math.min(d.length(),l1+l2-.00001);d.normalize();
    const along=(l1*l1-l2*l2+length*length)/(2*length),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const pole=f.forward.addScaledVector(d,-f.forward.dot(d)).normalize();
    pointBone(a,b,shoulder.clone().addScaledVector(d,along).addScaledVector(pole,height));pointBone(b,c,hand);
    const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X,Y,dir));
    c.quaternion.copy(c.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));c.updateWorldMatrix(true,true);
    // Derive the butt from the solved hand, never from an unattached visual proxy.
    const actual=c.getWorldPosition(V()).addScaledVector(Y,-.07).addScaledVector(X,.03).addScaledVector(dir,-.27);
    f.rod.bend.set(0,-.05,0);f.rod.updateHeld(dt,{butt:actual,dir,up:UP,tension:0});
  }
  contact(){
    if(!this.danger)return;
    const rod=this.g.fisher.rod,contacts=[];
    for(let i=0;i<=10;i++)contacts.push(toLocal(rod.pointWorld(.9+i*.01)));
    if(this.phase==='sweeping') {
      const p=this.g.player.clone();p.y+=GROUND+.023;
      for(let i=0;i<contacts.length;i++) {
        const a=this.lastContacts?.[i]||contacts[i],b=contacts[i],d=b.clone().sub(a),n=d.lengthSq();
        const q=a.clone().addScaledVector(d,n?THREE.MathUtils.clamp(p.clone().sub(a).dot(d)/n,0,1):0);
        if(q.distanceToSquared(p)<(RADIUS+.003)**2){this.g.fail('rod');break;}
      }
    }
    this.lastContacts=contacts;
  }
}
