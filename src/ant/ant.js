import * as THREE from 'three';
import { V, GROUND } from './layout.js';

const bodyMat = new THREE.MeshStandardMaterial({color:0x352016,roughness:0.4});
const legMat = new THREE.MeshStandardMaterial({color:0x261711,roughness:0.65});
const crumbMat = new THREE.MeshStandardMaterial({color:0xe8b461,roughness:0.96,flatShading:true});
const ball = new THREE.SphereGeometry(1,12,8);
const cylinder = new THREE.CylinderGeometry(1,1,1,5);
export function segment(parent,a,b,r,material=legMat) {
  const m=new THREE.Mesh(cylinder,material), d=b.clone().sub(a);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(r,d.length(),r); m.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());
  m.castShadow=true; parent.add(m); return m;
}
export function breadcrumb() {
  const group=new THREE.Group();
  const geo=new THREE.IcosahedronGeometry(0.019,1);
  const p=geo.attributes.position;
  for(let i=0;i<p.count;i++) { const k=1+0.14*Math.sin(i*9.13); p.setXYZ(i,p.getX(i)*k,p.getY(i)*k,p.getZ(i)*k); }
  geo.computeVertexNormals();
  const m=new THREE.Mesh(geo,crumbMat);m.scale.set(1.1,0.78,0.8);m.castShadow=true;group.add(m);
  const crust=new THREE.Mesh(new THREE.IcosahedronGeometry(.009,0),new THREE.MeshStandardMaterial({color:0xa96727,roughness:1}));
  crust.position.set(-.012,-.007,0);crust.scale.set(.55,.8,1.1);group.add(crust);
  for(let i=0;i<8;i++) { const pore=new THREE.Mesh(ball,new THREE.MeshStandardMaterial({color:0xb68243,roughness:1})); pore.scale.setScalar(.0017); pore.position.set(Math.sin(i*3)*.012,.012,Math.cos(i*2)*.008);group.add(pore); }
  return group;
}
export class Ant {
  constructor(parent,carrying=false) {
    this.root=new THREE.Group();parent.add(this.root);this.body=new THREE.Group();this.root.add(this.body);
    const contact=new THREE.Mesh(new THREE.CircleGeometry(.048,20),new THREE.MeshBasicMaterial({color:0x292317,transparent:true,opacity:.20,depthWrite:false}));
    contact.rotation.x=-Math.PI/2;contact.position.y=.001;contact.scale.y=.62;this.root.add(contact);
    for(const [x,y,sx,sy,sz] of [[-.025,.020,.024,.018,.016],[.001,.019,.011,.012,.010],[.024,.025,.013,.012,.012]]) {
      const m=new THREE.Mesh(ball,bodyMat);m.position.set(x,y,0);m.scale.set(sx,sy,sz);m.castShadow=true;this.body.add(m);
    }
    this.legs=[];
    for(const side of [-1,1]) for(let j=0;j<3;j++) {
      const leg=new THREE.Group();leg.position.set((j-1)*.011,.018,0);this.body.add(leg);
      const knee=V((j-1)*.012,.001,side*.024), tip=V((j-1)*.021,-.018,side*.036);
      segment(leg,V(),knee,.0019);segment(leg,knee,tip,.0014);this.legs.push({leg,side,j});
    }
    this.antennae=[];
    for(const side of [-1,1]) {
      const antenna=new THREE.Group();antenna.position.set(.029,.030,side*.006);this.body.add(antenna);this.antennae.push({antenna,side});
      segment(antenna,V(),V(.014,.015,side*.011),.0012);
      segment(antenna,V(.014,.015,side*.011),V(.027,.012,side*.015),.001);
      segment(this.body,V(.031,.023,side*.005),V(.044,.024,side*.008),.002);
    }
    this.crumb=breadcrumb();this.crumb.position.set(.043,.042,0);this.crumb.rotation.z=.25;this.body.add(this.crumb);this.crumb.visible=carrying;
    this.phase=0;
  }
  pose(p,heading,dt,moving=true) {
    this.root.position.copy(p);this.root.position.y+=GROUND;
    this.root.rotation.y=heading;
    if(moving)this.phase+=dt*27;
    for(const {leg,side,j} of this.legs) { const a=this.phase+j*2.2+side*Math.PI*.5;leg.rotation.y=moving?Math.sin(a)*.38:0;leg.rotation.x=moving?Math.cos(a)*.16:0; }
    this.body.position.y=moving?Math.sin(this.phase*2)*.0015:0;
    for(const {antenna,side} of this.antennae)antenna.rotation.y=Math.sin(this.phase*.31+side)*.12;
  }
}
