import * as THREE from 'three';
import { HOME } from '../driver/layout.js';

// Everything is in the ORIGINAL parked pickup's frame: -X is front, +Z driver side.
// Do not attach this frame to the moving truck.
export const UP = new THREE.Vector3(0, 1, 0);
export const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
export const toWorld = p => p.clone().applyAxisAngle(UP, HOME.yaw).add(V(HOME.x,0,HOME.z));
export const toLocal = p => p.clone().sub(V(HOME.x,0,HOME.z)).applyAxisAngle(UP,-HOME.yaw);
export const ROUTE = [V(-2.98,0,1.64), V(-1.45,0,1.64), V(-0.55,0,1.62), V(0.72,0,1.30), V(1.35,0,1.30), V(2.05,0,1.32), V(2.80,0,1.44), V(4.10,0,1.75)];
export const LEAF = V(0.78,0,1.34);
export const PULL_APPROACH = V(-.24,0,1.50);
export const PULL_TRIGGER_X = -.22;
export const INTRO = { hold:2.4, duration:4.2, march:.5, approachSlope:2.8, camera:V(-4.4,.20,4.2), target:V(-1.05,.63,.9) };
export const HOME_ANT = ROUTE.at(-1);
export const SPEED = 0.38;
export const RADIUS = 0.019;
export const GROUND = 0.007;
export const routeLength = ROUTE.slice(1).reduce((n,p,i)=>n+p.distanceTo(ROUTE[i]),0);
export function onRoute(distance) {
  for(let i=1;i<ROUTE.length;i++) {
    const length=ROUTE[i].distanceTo(ROUTE[i-1]);
    if(distance<=length) return ROUTE[i-1].clone().lerp(ROUTE[i],Math.max(0,distance/length));
    distance-=length;
  }
  return HOME_ANT.clone();
}
export function routeDistance(p) {
  let best=Infinity, along=0, total=0;
  for(let i=1;i<ROUTE.length;i++) {
    const a=ROUTE[i-1], d=ROUTE[i].clone().sub(a), len=d.length();
    const t=THREE.MathUtils.clamp(p.clone().sub(a).dot(d)/(len*len),0,1);
    const q=a.clone().addScaledVector(d,t), dist=q.distanceToSquared(p);
    if(dist<best) { best=dist; along=total+len*t; }
    total+=len;
  }
  return along;
}
