import * as THREE from 'three';
export const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const clamp=THREE.MathUtils.clamp, smooth=THREE.MathUtils.smoothstep, mix=THREE.MathUtils.lerp;
export const UP=V(0,1,0);
export function mesh(parent,geometry,material,position=V()) {
  const m=new THREE.Mesh(geometry,material);m.position.copy(position);parent.add(m);return m;
}
export function ring(parent,r,color=0xffe6a0,width=.05) {
  const m=mesh(parent,new THREE.RingGeometry(r-width,r,64),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));
  m.rotation.x=-Math.PI/2;return m;
}
export function capsule(parent,a,b,r,material) {
  const d=b.clone().sub(a),m=mesh(parent,new THREE.CapsuleGeometry(r,Math.max(.01,d.length()-r*2),4,10),material,a.clone().add(b).multiplyScalar(.5));
  m.quaternion.setFromUnitVectors(UP,d.normalize());m.castShadow=true;return m;
}
