import * as THREE from 'three';
import { V, UP } from './layout.js';

function mergeParts(parts){
  const geo=new THREE.BufferGeometry(),indices=[];let offset=0;
  for(const p of parts){for(const i of p.index.array)indices.push(offset+i);offset+=p.attributes.position.count;}
  for(const name of ['position','normal','uv']){
    const size=parts[0].attributes[name].itemSize,array=new Float32Array(offset*size);let cursor=0;
    for(const p of parts){array.set(p.attributes[name].array,cursor);cursor+=p.attributes[name].array.length;}
    geo.setAttribute(name,new THREE.BufferAttribute(array,size));
  }
  geo.setIndex(indices);geo.computeBoundingSphere();return geo;
}

// Ant-only detail on the existing pickup, in its original axle/body coordinates.
// Merge by material so ribs, fasteners and suspension do not add hundreds of draws.
export function addUndercarriage(truck){
  const root=new THREE.Group();root.name='ant-undercarriage';truck.body.add(root);
  const materials=[
    new THREE.MeshStandardMaterial({color:0x566068,roughness:.78,metalness:.46,emissive:0x192129,emissiveIntensity:.22}),
    new THREE.MeshStandardMaterial({color:0x88725b,roughness:.88,metalness:.28,emissive:0x2b241b,emissiveIntensity:.16}),
    new THREE.MeshStandardMaterial({color:0x262a2b,roughness:.94,metalness:.12}),
  ];
  const pieces=materials.map(()=>[]),parts=[];
  const add=(name,geo,p,q,mat=0)=>{
    geo.applyMatrix4(new THREE.Matrix4().compose(p,q||new THREE.Quaternion(),V(1,1,1)));
    // Box/cylinder geometries share position, normal and UV attributes.
    pieces[mat].push(geo);parts.push(name);
  };
  const box=(name,p,size,mat=0)=>add(name,new THREE.BoxGeometry(...size),V(...p),null,mat);
  const pipe=(name,a,b,r,mat=0)=>{const d=b.clone().sub(a);add(name,new THREE.CylinderGeometry(r,r,d.length(),10),a.clone().lerp(b,.5),new THREE.Quaternion().setFromUnitVectors(UP,d.normalize()),mat);};
  const bolt=(p)=>add('hex bolt',new THREE.CylinderGeometry(.012,.012,.011,6),p,null,1);
  box('cab floor',[-.25,.562,0],[2.3,.025,1.46]);
  box('bed floor',[1.86,.568,0],[1.60,.025,1.47],1);
  for(const z of [-.52,.52]){
    box('chassis rail',[.02,.475,z],[4.94,.10,.065]);
    box('rail flange',[.02,.428,z],[4.94,.014,.11],1);
    for(let x=-2.2;x<2.5;x+=.38)bolt(V(x,.417,z));
  }
  for(const x of [-2.12,-1.04,-.3,.58,1.18,2.40])box('crossmember',[x,.494,0],[.065,.085,1.04]);
  for(let x=-1.32;x<2.65;x+=.19)box('pressed floor rib',[x,.539,0],[.024,.027,1.38],1);
  for(const x of [truck.dims.axleF,truck.dims.axleR]){
    pipe('axle',V(x,.385,-.81),V(x,.385,.81),.043,2);
    const differential=new THREE.SphereGeometry(.107,14,10);differential.scale(.88,.86,1.1);
    add('differential',differential,V(x,.365,0),null,0);
    for(const z of [-.64,.64]){
      pipe('shock piston',V(x-.16,.51,z),V(x+.055,.37,z),.019,1);
      pipe('shock body',V(x-.04,.43,z),V(x+.075,.35,z),.032,0);
    }
  }
  box('transmission',[-.97,.445,0],[.53,.16,.31],1);
  pipe('driveshaft',V(-.70,.378,0),V(1.60,.365,0),.027,1);
  for(const x of [-.66,1.47])pipe('universal joint',V(x-.035,.375,0),V(x+.035,.375,0),.047,0);
  for(const z of [-.61,.61])for(let layer=0;layer<3;layer++){
    const length=1.25-layer*.22;
    for(let j=0;j<8;j++){
      const at=t=>V(1.6+(t-.5)*length,.32+layer*.012+.095*(2*t-1)**2,z);
      pipe('rear leaf spring',at(j/8),at((j+1)/8),.011,2);
    }
    for(const x of [1.08,2.12])box('spring hanger',[x,.434,z],[.065,.10,.08],1);
  }
  box('fuel tank',[.02,.464,.28],[.72,.14,.42],2);
  for(const x of [-.20,.22])box('tank strap',[x,.389,.28],[.037,.014,.44],1);
  const exhaust=[V(-1.45,.423,-.26),V(-.9,.373,-.35),V(.45,.373,-.35),V(1.24,.39,-.35),V(1.64,.48,-.35),V(2.35,.40,-.35),V(2.64,.38,-.77)];
  for(let i=1;i<exhaust.length;i++)pipe('exhaust pipe',exhaust[i-1],exhaust[i],.025,1);
  box('muffler',[.71,.392,-.35],[.48,.11,.23],1);
  const spare=new THREE.TorusGeometry(.22,.055,10,24);spare.rotateX(Math.PI/2);
  add('spare tire',spare,V(2.10,.45,.06),null,2);
  add('spare rim',new THREE.CylinderGeometry(.167,.167,.055,16),V(2.10,.45,.06),null,0);
  pipe('spare carrier',V(1.86,.395,.06),V(2.34,.395,.06),.022,1);
  for(let i=0;i<pieces.length;i++){
    const mesh=new THREE.Mesh(mergeParts(pieces[i]),materials[i]);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);pieces[i].forEach(g=>g.dispose());
  }
  const bounce=new THREE.PointLight(0xcbd3dc,.55,3.0,1.4);bounce.position.set(.6,.20,0);root.add(bounce);
  root.userData.parts=parts;root.userData.clearance=.272;return root;
}
