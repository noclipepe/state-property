// Regression for crossing fingers: test the complete curves and rendered pads,
// not only the two target transforms. Browser input remains in verify-god-hand.
import * as THREE from 'three';
import { DivineHand } from '../src/god/hand.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),UP=V(0,1,0);
function inspect(g){
  const h=g.hand,axis=h.contacts[1].clone().sub(h.contacts[0]).normalize(),origin=h.contacts[0].clone().lerp(h.contacts[1],.5);
  const curves=h.fingers.map(f=>Array.from({length:65},(_,i)=>f.surface.curve.getPoint(i/64)));
  const screens=curves.map(c=>c.map(p=>p.clone().project(g.camera)));
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  let crossings=0,minSeparation=Infinity,padError=0,distalSide=Infinity;
  for(let i=0;i<64;i++)for(let j=0;j<64;j++){
    const [a,b,c,d]=[screens[0][i],screens[0][i+1],screens[1][j],screens[1][j+1]];
    if([a,b,c,d].every(p=>Math.abs(p.x)<=1&&Math.abs(p.y)<=1)&&cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)crossings++;
    minSeparation=Math.min(minSeparation,curves[0][i].distanceTo(curves[1][j]));
  }
  const ordered=curves.slice(0,2).every((curve,i)=>curve.every(p=>p.clone().sub(origin).dot(axis)*(i?1:-1)>0));
  h.fingers.slice(0,2).forEach((f,i)=>{
    const s=f.surface,a=s.mesh.geometry.attributes.position,k=.75*s.rings*(s.sides+1)+s.sides*.75;
    padError=Math.max(padError,origin.clone().fromBufferAttribute(a,k).distanceTo(h.contacts[i]));
    for(let r=s.rings/2;r<=s.rings;r++)for(let j=0;j<=s.sides;j++)distalSide=Math.min(distalSide,origin.clone().fromBufferAttribute(a,r*(s.sides+1)+j).sub(origin).dot(axis)*(i?1:-1));
  });
  let foldedGap=Infinity;for(const f of curves.slice(2))for(const a of curves[0])for(const b of f)foldedGap=Math.min(foldedGap,a.distanceTo(b));
  return {ordered,crossings,minSeparation,padError,distalSide,foldedGap};
}
let failures=0,total=0;
for(const [width,height] of [[1280,800],[320,568],[360,800],[390,844],[412,915],[844,390]]){
  const camera=new THREE.PerspectiveCamera(48,width/height,.1,250);camera.position.copy(width<height?V(28.63,29.8,9.43):V(28.45,25.47,-1.99));camera.lookAt(4.2,0,6.5);camera.updateMatrixWorld();
  const g={camera,scene:new THREE.Scene()};g.hand=new DivineHand(g);let count=0;
  for(const [owner,target] of [['truck',V(-2.93,4.11,7.35)],['truck',V(10,3.2,8)],['truck',V(3,4.11,1.5)],['plug',V(11,1.11,6.5)],['plug',V(15,1.5,4)]])for(const reach of [.55,.75,1]){
    const axis=owner==='truck'?V(0,0,1).applyAxisAngle(UP,2.428):V(0,0,1).applyAxisAngle(UP,Math.atan2(camera.position.x-11,camera.position.z-6.5)+.65);
    const h=g.hand;h.reset();h.grab(owner);h.aim(owner,target,axis,owner==='truck'?1.97:.19);h.update(reach/4.5);
    const m=inspect(g),ok=m.ordered&&m.crossings===0&&m.minSeparation>.8&&m.padError<.008&&m.distalSide>0&&m.foldedGap>1;
    total++;if(ok)count++;else{failures++;console.log('FAIL',JSON.stringify({width,height,owner,target:target.toArray(),reach,...m}));}
  }
  console.log(`${width}x${height}: ${count}/15 grip poses keep separate fingers and matching pads`);
}
console.log(`${total-failures}/${total} checks passed`);if(failures)process.exitCode=1;
