import * as THREE from 'three';
import { V,UP,clamp } from './common.js';
import { HandSkin } from './hand-skin.js';

// World-space fingertips meet the object; the forearm exits the player's frame.
export class DivineHand {
  constructor(game){
    this.g=game;this.root=new THREE.Group();this.root.name='firstPersonDivineHand';game.scene.add(this.root);
    const skin=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.68,metalness:0});
    const nail=new THREE.MeshStandardMaterial({color:0xe4bdb1,roughness:.3,metalness:0});
    const edge=new THREE.MeshStandardMaterial({color:0xf1dcc7,roughness:.4});
    const crease=new THREE.LineBasicMaterial({color:0x926452,transparent:true,opacity:.22,depthWrite:false});
    this.skin=new HandSkin(this.root,skin,{rings:52,sides:32,palm:true});
    this.palm=new THREE.Object3D();this.root.add(this.palm);
    this.fingers=Array.from({length:5},(_,i)=>{
      const surface=new HandSkin(this.root,skin,{rings:40,sides:24,nails:[nail,edge]});
      const creases=Array.from({length:i===1?2:4},()=>{const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(13*3),3));const line=new THREE.Line(geo,crease);line.frustumCulled=false;this.root.add(line);return line;});
      return {surface,creases,radius:i===1?.68:i===0?.57:.55-(i-2)*.065};
    });
    this.target=V();this.axis=V(1,0,0);this.indexTip=V();this.thumbTip=V();this.wrist=V();this.armEnd=V();this.lastTarget=V();this.lastAxis=V();this.lastCamera=V();this.lastRotation=new THREE.Quaternion();this.reset();
  }
  reset(){this.owner=null;this.lastOwner=null;this.amount=0;this.span=2;this.lastAmount=-1;this.root.visible=false;}
  grab(owner){if(this.owner&&this.owner!==owner)return false;if(this.lastOwner!==owner)this.amount=0;this.lastOwner=owner;this.owner=owner;return true;}
  ready(owner){return this.owner===owner&&this.amount>=.99;}
  aim(owner,point,axis,span){if(this.owner!==owner)return;this.target.copy(point);this.axis.copy(axis).normalize();this.span=span;}
  release(owner){if(this.owner===owner)this.owner=null;}
  update(dt){
    this.amount=clamp(this.amount+dt*(this.owner?4.5:-6),0,1);this.root.visible=this.amount>0;if(!this.root.visible)return;
    const camera=this.g.camera;
    // A held, still hand has no geometry work. Rebuild only during reaching,
    // dragging or a camera/layout change; no new meshes are created per frame.
    if(this.amount===this.lastAmount&&this.span===this.lastSpan&&this.target.distanceToSquared(this.lastTarget)<1e-8&&this.axis.distanceToSquared(this.lastAxis)<1e-8&&camera.position.distanceToSquared(this.lastCamera)<1e-8&&camera.quaternion.angleTo(this.lastRotation)<1e-6)return;
    this.lastAmount=this.amount;this.lastSpan=this.span;this.lastTarget.copy(this.target);this.lastAxis.copy(this.axis);this.lastCamera.copy(camera.position);this.lastRotation.copy(camera.quaternion);
    const right=V(1,0,0).applyQuaternion(camera.quaternion),up=V(0,1,0).applyQuaternion(camera.quaternion),back=V(0,0,1).applyQuaternion(camera.quaternion);
    const retreat=(1-this.amount)**2,origin=this.target.clone().addScaledVector(right,retreat*18).addScaledVector(back,retreat*5);
    this.armEnd.copy(camera.position).addScaledVector(right,9).addScaledVector(up,-5).addScaledVector(back,-3);
    // One grip frame for palm, knuckles and tips. The index and thumb stay on
    // their own sides all the way from the hand to the object.
    const axis=this.axis.clone();if(axis.dot(right)>0)axis.negate();
    const dorsal=UP.clone().addScaledVector(axis,-UP.dot(axis)).normalize();
    const long=new THREE.Vector3().crossVectors(axis,dorsal).normalize();
    if(long.dot(right)<0)long.negate();long.addScaledVector(dorsal,.35).normalize();
    const p=(x,y,z)=>origin.clone().addScaledVector(axis,x).addScaledVector(dorsal,y).addScaledVector(long,z);
    const gap=this.span/2+(this.owner?0:(1-this.amount)*1.5);
    // Each distal phalanx descends outside the object. Opposing soft pads meet
    // its actual surface; nails face out. The old camera-facing parallel fingers
    // touched the roof with their nails and left the thumb floating below it.
    const pads=[origin.clone().addScaledVector(axis,-gap),origin.clone().addScaledVector(axis,gap)];
    const normals=[axis.clone().negate(),axis.clone()];
    const centers=pads.map((contact,i)=>contact.clone().addScaledVector(normals[i],this.fingers[i].radius*.65));
    const distalUp=UP.clone().addScaledVector(axis,-UP.dot(axis)).normalize();
    this.indexTip.copy(centers[0]).addScaledVector(distalUp,-.44);this.thumbTip.copy(centers[1]).addScaledVector(distalUp,-.48);
    this.contacts=pads;this.padNormals=normals;
    this.palm.position.copy(p(-2,2.65,4.65));this.wrist.copy(p(-1.6,2.6,7));
    this.skin.set([this.armEnd,this.wrist.clone().lerp(this.armEnd,.35),this.wrist,p(-1.8,2.65,5.8),p(-2,2.7,4.45),p(-2.15,2.7,3.5),p(-2.15,2.7,3.15)],
      [1.95,1.65,1.24,1.65,1.85,1.65,.02],[1.55,1.2,.76,.82,.72,.57,.02],dorsal);
    const paths=[
      [p(-.95,2.8,3.4),p(-gap-.95,3.1,1.75),centers[0].clone().addScaledVector(distalUp,1.05),centers[0],this.indexTip],
      [p(.1,1.7,5.1),p(gap+1.1,1.4,2.2),centers[1].clone().addScaledVector(distalUp,.95),centers[1],this.thumbTip]
    ];
    // The other three fingers curl beside the index knuckle, outside the pinch.
    for(let i=0;i<3;i++){const x=-2.45-i*.93,z=4.15+i*.22;paths.push([p(x,2.7,z),p(x-.08,2.75,z-1.12),p(x-.12,1.9,z-1.2),p(x-.08,1.45,z-.35),p(x,1.65,z+.25)]);}
    this.fingers.forEach((f,i)=>{
      const r=f.radius,hint=i<2?normals[i]:dorsal;
      f.surface.set(paths[i],[r*1.04,r,r*.86,r*.72,r*.67],[r*.86,r*.83,r*.76,r*.65,r*.59],hint);
      // Nails are inset material regions of the actual skin surface: they bend
      // with the fingertip and cannot float above it as separate billboards.
      const {center,normal,side}=f.surface;
      f.creases.forEach((line,j)=>{
        const t=(j<2?.32:.63)+(j%2)*.018;f.surface.frame(t,hint);const a=line.geometry.attributes.position,w=f.surface.profile(f.surface.widths,t),h=f.surface.profile(f.surface.depths,t);
        for(let k=0;k<13;k++){const angle=.2*Math.PI+k/12*.6*Math.PI,q=center.clone().addScaledVector(side,Math.cos(angle)*(w+.008)).addScaledVector(normal,Math.sin(angle)*(h+.009));a.setXYZ(k,q.x,q.y,q.z);}a.needsUpdate=true;
      });
    });
  }
}
