import * as THREE from 'three';

const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
function mesh(parent,geo,mat,p=[0,0,0]) {
  const m=new THREE.Mesh(geo,mat); m.position.fromArray(p); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
}
function box(parent,mat,size,p) { return mesh(parent,new THREE.BoxGeometry(...size),mat,p); }
function tube(parent,mat,a,b,r=0.025) {
  const d=V(...b).sub(V(...a)), m=mesh(parent,new THREE.CylinderGeometry(r,r,d.length(),12),mat);
  m.position.copy(V(...a).add(V(...b)).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(V(0,1,0),d.normalize()); return m;
}

function roundedPath(path,x,y,w,h,r) {
  path.moveTo(x+r,y);path.lineTo(x+w-r,y);path.quadraticCurveTo(x+w,y,x+w,y+r);
  path.lineTo(x+w,y+h-r);path.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  path.lineTo(x+r,y+h);path.quadraticCurveTo(x,y+h,x,y+h-r);
  path.lineTo(x,y+r);path.quadraticCurveTo(x,y,x+r,y);return path;
}

// Sections along the longitudinal axis: x, centre height, vertical radius, half width.
// This is shaped within the pickup's measured envelope; no final mesh stretching.
function loft(parent,mat,sections,start=0,end=Math.PI*2,segments=40) {
  const p=[],idx=[];
  for (const [x,y,ry,rz] of sections) for(let j=0;j<=segments;j++) {
    const a=start+(end-start)*j/segments; p.push(x,y+Math.cos(a)*ry,Math.sin(a)*rz);
  }
  for(let i=0;i<sections.length-1;i++) for(let j=0;j<segments;j++) {
    const a=i*(segments+1)+j,b=a+segments+1; idx.push(a,a+1,b,a+1,b+1,b);
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); geo.setIndex(idx); geo.computeVertexNormals();
  return mesh(parent,geo,mat);
}

export function createShrinkRay() {
  const ray=new THREE.Group(); ray.name='shrinkRay';
  const metal=new THREE.MeshStandardMaterial({color:0x9ca6ac,metalness:0.82,roughness:0.28});
  const dark=new THREE.MeshStandardMaterial({color:0x262c32,metalness:0.6,roughness:0.48});
  const brass=new THREE.MeshStandardMaterial({color:0xc39a51,metalness:0.75,roughness:0.31});
  const glow=new THREE.MeshStandardMaterial({color:0x72f6e4,emissive:0x25bea8,emissiveIntensity:1.5,roughness:0.25});
  const cylinder=(r1,r2,l,z,mat) => { const m=mesh(ray,new THREE.CylinderGeometry(r1,r2,l,24),mat,[0,0,z]); m.rotation.x=Math.PI/2; return m; };
  cylinder(0.049,0.063,0.20,-0.04,metal);
  cylinder(0.045,0.026,0.15,-0.205,dark);
  for(const z of [-0.13,-0.17,-0.21,-0.25]) cylinder(0.061,0.061,0.014,z,brass);
  cylinder(0.044,0.027,0.035,-0.285,metal);
  cylinder(0.025,0.025,0.007,-0.306,glow);
  cylinder(0.060,0.051,0.045,0.080,dark);
  const grip=box(ray,dark,[0.045,0.115,0.055],[0,-0.078,0.035]); grip.rotation.x=-0.23;
  const trigger=mesh(ray,new THREE.TorusGeometry(0.038,0.005,8,20),metal,[0,-0.055,-0.026]); trigger.rotation.y=Math.PI/2;
  for(const x of [-0.034,0.034]) {
    tube(ray,brass,[x,0.045,0.045],[x,0.045,-0.092],0.009);
    tube(ray,glow,[x,0.058,0.033],[x,0.058,-0.078],0.009);
  }
  box(ray,dark,[0.016,0.030,0.026],[0,0.071,-0.07]);
  ray.userData.muzzle=V(0,0,-0.314);
  return ray;
}

export function createGruVehicle(truck) {
  truck.body.clear();
  const body=truck.body;
  const steel=new THREE.MeshStandardMaterial({color:0xa3abb0,metalness:0.72,roughness:0.37,side:THREE.DoubleSide});
  // Fine brushed marks and broad variations keep the metal legible in daylight.
  steel.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 metalP;').replace('#include <begin_vertex>','#include <begin_vertex>\nmetalP=position;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 metalP;').replace('#include <color_fragment>',`#include <color_fragment>
      float grain=fract(sin(dot(floor(metalP*vec3(530.0,850.0,390.0)),vec3(12.9898,78.233,39.425)))*43758.5453);
      diffuseColor.rgb *= 0.90+0.12*grain+0.055*sin(metalP.x*17.0+metalP.y*13.0);`);
  };
  const trim=new THREE.MeshStandardMaterial({color:0x9ca7ae,metalness:0.86,roughness:0.30});
  const dark=new THREE.MeshStandardMaterial({color:0x1b2227,roughness:0.77,metalness:0.3});
  const rubber=new THREE.MeshStandardMaterial({color:0x111417,roughness:0.91});
  const glass=new THREE.MeshPhysicalMaterial({color:0x668b90,roughness:0.1,transparent:true,opacity:0.22,depthWrite:false,side:THREE.DoubleSide});
  const rivets=[];
  const rivetLine=(a,b,n)=>{for(let i=0;i<=n;i++) rivets.push(V(...a).lerp(V(...b),i/n));};
  const hull=[[-2.94,0.71,0.08,0.19],[-2.72,0.74,0.20,0.37],[-2.30,0.81,0.31,0.57],[-1.58,0.86,0.46,0.79],[-0.96,0.83,0.49,0.94],[0.56,0.81,0.50,0.96],[1.48,0.79,0.46,0.86],[2.28,0.74,0.37,0.63],[2.72,0.71,0.25,0.40],[2.82,0.71,0.21,0.30]];
  // The cockpit is a real opening: the upper hull ends at its front and rear bulkheads.
  // A closed loft here would run a metal surface through the driver's waist and seats.
  const frontEnd=[-1.25,0.845,0.475,0.87],rearStart=[0.94,0.80,0.484,0.92];
  truck.bodyMesh=loft(body,steel,[...hull.filter(s=>s[0]<-1.25),frontEnd]);
  truck.bodyMesh.name='gruNose';
  loft(body,steel,[rearStart,...hull.filter(s=>s[0]>0.94)]).name='gruRearHull';
  loft(body,steel,[frontEnd,[-0.96,0.83,0.49,0.94],[0.56,0.81,0.50,0.96],rearStart],Math.PI/2,Math.PI*1.5,32).name='gruLowerHull';
  // Rounded cockpit, long tapered nose and high rear jet define Gru's vehicle.
  const roofSections=[[-1.21,1.79,0.015,0.61],[-0.94,1.84,0.19,0.82],[-0.47,1.86,0.22,0.94],[0.42,1.85,0.22,0.94],[0.93,1.78,0.15,0.79]];
  loft(body,steel,roofSections,-Math.PI/2,Math.PI/2,32);
  for(const s of [-1,1]) {
    const z=s*0.91;
    const frame=roundedPath(new THREE.Shape(),-1.13,1.185,2.16,0.755,0.23);
    frame.holes.push(roundedPath(new THREE.Path(),-1.00,1.25,1.87,0.56,0.155));
    mesh(body,new THREE.ExtrudeGeometry(frame,{depth:0.037,bevelEnabled:true,bevelSize:0.008,bevelThickness:0.008,bevelSegments:2,steps:1}),steel,[0,0,z-0.0185]).name=s===1?'gruDriverWindowFrame':'gruPassengerWindowFrame';
    const seam=roundedPath(new THREE.Path(),-1.065,1.235,2.02,0.64,0.195);
    for(const p of seam.getSpacedPoints(58))rivets.push(V(p.x,p.y,z+s*0.032));
    // Flush curved door panels leave the forearm supported on the window sill.
    box(body,steel,[2.14,0.43,0.05],[-0.10,1.015,z-0.018*s]).name=s===1?'gruDriverDoor':'gruPassengerDoor';
    for(const x of [-0.88,0.80])rivetLine([x,0.83,z+s*0.026],[x,1.18,z+s*0.026],5);
    box(body,dark,[0.15,0.025,0.038],[0.59,1.14,z+s*0.037]);
    // Side step and restrained swept fenders over the original wheelbase.
    box(body,dark,[1.70,0.055,0.15],[-0.02,0.43,s*1.015]);
    for(const x of [-1.70,1.60]) {
      const f=mesh(body,new THREE.TorusGeometry(0.442,0.065,10,40,Math.PI),steel,[x,0.39,s*0.89]);
      f.scale.z=2.6;
      for(let j=0;j<=10;j++){const a=j*Math.PI/10;rivets.push(V(x+Math.cos(a)*0.45,0.39+Math.sin(a)*0.45,s*1.065));}
    }
  }
  // Windshield sits ahead of Gru; the near side window remains completely open.
  const ws=box(body,glass,[0.018,0.55,1.43],[-1.145,1.55,0]); ws.rotation.z=-0.39;
  tube(body,trim,[-1.25,1.29,0],[-1.03,1.81,0],0.021);
  for(const s of [-1,1])tube(body,steel,[-1.24,1.29,s*0.72],[-1.04,1.81,s*0.71],0.044);
  const passenger=box(body,glass,[1.53,0.47,0.008],[-0.01,1.55,-0.887]); passenger.renderOrder=2;
  box(body,steel,[0.07,1.23,1.77],[0.94,1.075,0]).name='gruCabinBulkhead';
  // The footwell, inner door cards and upholstery are below the seated driver's body.
  const cabin=new THREE.Group();cabin.name='gruCabinInterior';body.add(cabin);
  const lining=new THREE.MeshStandardMaterial({color:0x39434a,roughness:0.89});
  const upholstery=new THREE.MeshStandardMaterial({color:0x333033,roughness:0.92});
  box(cabin,lining,[2.12,0.045,1.72],[-0.10,0.4775,0]).name='gruCabinFloor';
  box(cabin,lining,[0.08,0.73,1.66],[-1.14,0.855,0]).name='gruFirewall';
  box(cabin,lining,[0.055,1.00,1.65],[0.88,0.99,0]);
  for(const s of [-1,1]){
    box(cabin,lining,[1.82,0.51,0.035],[-0.06,0.94,s*0.854]);
    box(cabin,upholstery,[1.74,0.04,0.085],[-0.04,1.229,s*0.861]).name=s===1?'gruDriverSill':'gruPassengerSill';
    box(cabin,dark,[0.22,0.027,0.04],[0.42,1.13,s*0.831]);
  }
  // Two upholstered seats, a shallow dash and a steering wheel.
  for(const z of [-0.43,0.40]) {
    const seat=box(cabin,upholstery,[0.13,0.69,0.45],[0.38,1.205,z]); seat.rotation.z=0.10;seat.name='gruSeatBack';
    box(cabin,upholstery,[0.61,0.11,0.46],[-0.025,0.905,z]).name='gruSeatCushion';
    box(cabin,dark,[0.34,0.30,0.34],[0.03,0.70,z]);
    for(const dz of [-0.12,0,0.12])box(cabin,lining,[0.014,0.52,0.010],[0.298,1.24,z+dz]);
  }
  box(cabin,lining,[0.29,0.16,1.56],[-0.90,1.19,0]).name='gruDashboard';
  for(const z of [0.23,0.39,0.55]){
    const dial=mesh(cabin,new THREE.CylinderGeometry(0.057,0.057,0.012,24),dark,[-0.746,1.22,z]);dial.rotation.z=Math.PI/2;
    tube(cabin,trim,[-0.734,1.22,z],[-0.734,1.25,z+0.021],0.003);
  }
  const steering=mesh(body,new THREE.TorusGeometry(0.17,0.017,10,32),rubber,[-0.51,1.21,0.40]); steering.rotation.y=Math.PI/2; steering.rotation.z=0.35;
  tube(body,trim,[-0.64,1.15,0.4],[-0.49,1.25,0.4],0.024);
  // The oversized-looking turbine is built inside the original pickup size budget.
  const jet=[ [0.79,1.42,0.30,0.39],[1.08,1.44,0.57,0.60],[1.39,1.44,0.65,0.65],[1.97,1.44,0.62,0.62],[2.53,1.43,0.49,0.49],[2.85,1.43,0.43,0.43] ];
  loft(body,steel,jet);
  for(const x of [1.10,1.42,1.96,2.53]){
    const sec=jet.reduce((a,b)=>Math.abs(b[0]-x)<Math.abs(a[0]-x)?b:a);
    const band=mesh(body,new THREE.TorusGeometry(sec[2]+0.006,0.016,8,48),trim,[x,sec[1],0]);band.rotation.y=Math.PI/2;
    for(let j=0;j<24;j++){const a=j*Math.PI/12;rivets.push(V(x+0.035,sec[1]+Math.cos(a)*(sec[2]+0.006),Math.sin(a)*(sec[3]+0.006)));}
  }
  for(const [x,r,y] of [[-2.955,0.135,0.71],[2.88,0.425,1.43]]) {
    const ring=mesh(body,new THREE.TorusGeometry(r,0.028,12,32),trim,[x,y,0]); ring.rotation.y=Math.PI/2;
    const disc=mesh(body,new THREE.CylinderGeometry(r-0.02,r-0.02,0.034,32),dark,[x,y,0]); disc.rotation.z=Math.PI/2;
    for(let j=0;j<12;j++){const a=j*Math.PI/6;const blade=box(body,trim,[0.045,r*0.72,0.025],[x,y+Math.cos(a)*r*0.53,Math.sin(a)*r*0.53]);blade.rotation.x=-a+0.4;}
    const cone=mesh(body,new THREE.ConeGeometry(r*0.22,0.13,24),trim,[x+0.035,y,0]);cone.rotation.z=-Math.PI/2;
  }
  const light=new THREE.MeshStandardMaterial({color:0xffdf9a,emissive:0x8e641c,emissiveIntensity:0.4,roughness:0.2});
  for(const s of [-1,1]) {
    const lamp=mesh(body,new THREE.SphereGeometry(0.108,20,12),trim,[-2.13,1.00,s*0.64]); lamp.scale.x=0.80;
    const lens=mesh(body,new THREE.CircleGeometry(0.083,24),light,[-2.208,1.00,s*0.64]); lens.rotation.y=-Math.PI/2;
    const tail=mesh(body,new THREE.SphereGeometry(0.062,12,8),new THREE.MeshStandardMaterial({color:0x982c22,roughness:0.3}),[2.40,0.96,s*0.43]); tail.scale.x=0.45;
  }
  for(const s of [-1,1]){
    const finShape=new THREE.Shape();finShape.moveTo(1.07,0.95);finShape.lineTo(2.31,1.62);finShape.lineTo(2.64,1.21);finShape.lineTo(2.69,0.79);finShape.closePath();
    mesh(body,new THREE.ExtrudeGeometry(finShape,{depth:0.032,bevelEnabled:true,bevelSize:0.009,bevelThickness:0.009,bevelSegments:2,steps:1}),steel,[0,0,s*0.71]);
    // Exhaust cooling slots and pressed seams read at both full and miniature scales.
    for(let i=0;i<6;i++)tube(body,dark,[1.43+i*0.14,0.98,s*0.76],[1.37+i*0.14,1.10,s*0.72],0.011);
  }
  for(const x of [-2.1,-1.45,1.42,2.18]) {
    const sec=hull.reduce((a,b)=>Math.abs(b[0]-x)<Math.abs(a[0]-x)?b:a);
    for(let i=0;i<32;i++){const a=i*Math.PI/16;rivets.push(V(x,sec[1]+Math.cos(a)*(sec[2]+0.007),Math.sin(a)*(sec[3]+0.007)));}
  }
  const rivetMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(0.009,8,6),trim,rivets.length), dummy=new THREE.Object3D();
  rivets.forEach((p,i)=>{dummy.position.copy(p);dummy.updateMatrix();rivetMesh.setMatrixAt(i,dummy.matrix);});body.add(rivetMesh);
  // Disc wheel covers preserve the pickup's grounded tyre geometry.
  for(const w of truck.wheels) {
    const hub=mesh(w.spin,new THREE.CylinderGeometry(0.213,0.213,0.045,32),steel,[0,0,w.s*0.11]);hub.rotation.x=Math.PI/2;
    const bolt=mesh(w.spin,new THREE.SphereGeometry(0.048,16,10),trim,[0,0,w.s*0.14]);bolt.scale.z=0.4;
  }
  const mount=new THREE.Group(); mount.name='rayMount'; mount.position.set(-0.10,1.015,1.015); body.add(mount);
  box(mount,dark,[0.36,0.08,0.06],[0,-0.016,-0.040]);
  for(const x of [-0.11,0.11]) {
    const clamp=mesh(mount,new THREE.TorusGeometry(0.063,0.010,8,16,Math.PI*1.25),trim,[x,0.037,0.006]);clamp.rotation.y=Math.PI/2;
  }
  const ray=createShrinkRay(); mount.add(ray); ray.position.set(0.075,0.082,0.015);ray.rotation.y=Math.PI/2;
  truck.gru={mount,ray,cabin};
  truck.collisionBoxes=[
    {min:[-2.98,0.25,-0.90],max:[-1.17,1.29,0.90]},
    {min:[-1.17,0.25,-0.96],max:[0.94,0.52,0.96]},
    {min:[-1.17,0.52,0.83],max:[0.94,1.25,0.95]},
    {min:[-1.17,0.52,-0.95],max:[0.94,1.25,-0.83]},
    {min:[-1.21,1.81,-0.94],max:[0.94,2.09,0.94]},
    {min:[0.87,0.25,-0.92],max:[2.96,2.112,0.92]},
  ];
  truck.collisionHalf={x:2.99,z:1.11};
  return truck;
}

export function visibleVehicleBounds(truck) {
  const bounds=new THREE.Box3(),part=new THREE.Box3(); truck.root.updateWorldMatrix(true,true);
  // The contact shadow is a projection, not part of the exterior.
  truck.tilt.traverseVisible(o=>{
    if(!o.isMesh || o.isSkinnedMesh) return;
    for(let p=o;p;p=p.parent) if(p.name==='Gru') return;
    o.geometry.computeBoundingBox();
    if(o.isInstancedMesh) { o.computeBoundingBox(); part.copy(o.boundingBox); }
    else part.copy(o.geometry.boundingBox);
    bounds.union(part.applyMatrix4(o.matrixWorld));
  });
  return bounds;
}
