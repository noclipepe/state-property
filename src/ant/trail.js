import * as THREE from 'three';
import { patchMaterial } from '../scene/shading.js';
import { V, UP, toLocal, LEAF, HOME_ANT, ROUTE, GROUND, INTRO, onRoute, routeLength } from './layout.js';
import { segment, breadcrumb } from './ant.js';

export class Trail {
  constructor(parent,world,renderer) {
    this.rocks=[];
    let seed=9317;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    // Bake the fine soil once. Mipmaps/anisotropic filtering keep it stable at ant height,
    // instead of evaluating aliased 450× procedural noise for every ground pixel each frame.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const context=canvas.getContext('2d'),pixels=context.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const i=(y*256+x)*4,n=211+random()*28+5*Math.sin(x*.049)*Math.sin(y*.073);
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=n;pixels.data[i+3]=255;
    }
    context.putImageData(pixels,0,0);
    this.soilTexture=new THREE.CanvasTexture(canvas);this.soilTexture.wrapS=this.soilTexture.wrapT=THREE.RepeatWrapping;
    this.soilTexture.minFilter=THREE.LinearMipmapLinearFilter;this.soilTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const dirt=new THREE.MeshStandardMaterial({color:0xc0a072,map:this.soilTexture,roughness:1,vertexColors:true,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const curve=new THREE.CatmullRomCurve3([ROUTE[0].clone().add(V(-1.22,0,1.22*INTRO.approachSlope)),...ROUTE,HOME_ANT.clone().add(V(.55,0,.1))],false,'centripetal');
    // A regular XZ grid has exactly one surface at every point. The old wide ribbon folded
    // over itself on the rear-wheel bend, producing coplanar triangles and flickering soil.
    const pos=[],col=[],idx=[],uv=[],samples=curve.getPoints(250),nx=192,nz=120;
    for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
      const x=-4.6+ix*.05,z=-.2+iz*.05;
      let distance=Infinity;for(const p of samples)distance=Math.min(distance,Math.hypot(x-p.x,z-p.z));
      const alpha=1-THREE.MathUtils.smoothstep(distance,.39,.58);
      pos.push(x,GROUND-.002,z);uv.push(x*2,z*2);col.push(1,1,1,alpha);
      if(ix<nx&&iz<nz){const a=iz*(nx+1)+ix;idx.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,4));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
    this.ground=new THREE.Mesh(geo,dirt);this.ground.name='ant-soil-grid';this.ground.receiveShadow=true;parent.add(this.ground);
    // Clear a generous camera corridor, keeping the original lawn everywhere else.
    const mat=new THREE.Matrix4();
    for(let i=0;i<world.grass.count;i++) {
      world.grass.getMatrixAt(i,mat);const p=toLocal(V().setFromMatrixPosition(mat));
      if(p.x>-4.8&&p.x<4.6&&p.z>-.1&&p.z<5.2){mat.elements[13]=-2;world.grass.setMatrixAt(i,mat);}
    }
    world.grass.instanceMatrix.needsUpdate=true;
    const stoneGeo=new THREE.IcosahedronGeometry(1,1),stoneMat=new THREE.MeshStandardMaterial({color:0x91897a,roughness:1,flatShading:true});
    for(const [x,z,r] of [[-2.05,2.01,.066],[-1.58,1.23,.043],[-.23,2.10,.071],[.3,1.9,.058],[1.24,1.72,.055],[2.85,1.95,.073]]) {
      const rock=new THREE.Mesh(stoneGeo,stoneMat);rock.position.set(x,GROUND+r*.34,z);rock.scale.set(r,r*.6,r*.86);rock.rotation.y=x*7;rock.castShadow=true;rock.receiveShadow=true;parent.add(rock);this.rocks.push({x,z,r:r*.96});
    }
    // Small, sparse edge details. None occludes the lens or requires a jump.
    const grassMat=new THREE.MeshStandardMaterial({color:0xffffff,side:THREE.DoubleSide,roughness:1});
    const blades=[],bladeColors=[];
    for(let j=0;j<3;j++){
      const a=j*2.1,c=Math.cos(a),s=Math.sin(a);
      for(const [x,y] of [[-.045,0],[.045,0],[.10,.55],[-.045,0],[.10,.55],[.06,1]]){
        blades.push(x*c,y,x*s);const color=new THREE.Color(y>.5?0x779449:0x425829);bladeColors.push(color.r,color.g,color.b);
      }
    }
    const bladeGeo=new THREE.BufferGeometry();bladeGeo.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));bladeGeo.setAttribute('color',new THREE.Float32BufferAttribute(bladeColors,3));bladeGeo.computeVertexNormals();grassMat.vertexColors=true;
    this.smallGrass=new THREE.InstancedMesh(bladeGeo,grassMat,1800);this.smallGrass.receiveShadow=true;
    const instance=new THREE.Object3D();
    for(let i=0;i<this.smallGrass.count;i++){
      const t=random(),p=curve.getPoint(t),d=curve.getTangent(t),side=i%2?1:-1,edge=.29+Math.pow(random(),.65)*.95;
      p.add(V(-d.z,0,d.x).multiplyScalar(side*edge));p.y=GROUND;
      const h=.012+random()*.032;instance.position.copy(p);instance.rotation.y=random()*Math.PI*2;instance.scale.set(h*(.8+random()),h,h);instance.updateMatrix();this.smallGrass.setMatrixAt(i,instance.matrix);
    }
    this.smallGrass.computeBoundingSphere();parent.add(this.smallGrass);
    this.crumbTrail=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.0035,0),new THREE.MeshStandardMaterial({color:0xe8b461,roughness:1}),34);
    for(let i=0;i<34;i++) {
      const p=onRoute(i/33*routeLength);p.y=GROUND+.003;p.z+=Math.sin(i*2.9)*.032;
      instance.position.copy(p);instance.rotation.set(i,0,i*2);instance.scale.setScalar(.8+(i%3)*.15);instance.updateMatrix();this.crumbTrail.setMatrixAt(i,instance.matrix);
    }
    this.crumbTrail.computeBoundingSphere();parent.add(this.crumbTrail);
    this.twig={x:.09,z:1.65,length:.26,r:.013};
    const wood=new THREE.MeshStandardMaterial({color:0x715139,roughness:1});
    segment(parent,V(.045,.016,1.50),V(.14,.021,1.80),.012,wood);
    segment(parent,V(.09,.021,1.65),V(.23,.022,1.72),.006,wood);
    this.makeLeaf(parent);this.makeHill(parent);
    const litterMat=new THREE.MeshStandardMaterial({color:0x997641,roughness:1,side:THREE.DoubleSide});
    for(const [x,z,a] of [[-2.35,1.15,.4],[-.35,2.2,-.7],[1.15,1.9,.9],[2.8,.55,-.3]]) {
      const leaf=new THREE.Mesh(new THREE.SphereGeometry(.075,8,4,0,Math.PI*2,0,Math.PI/2),litterMat);
      leaf.scale.set(1.6,.13,.52);leaf.position.set(x,GROUND,z);leaf.rotation.y=a;leaf.receiveShadow=true;parent.add(leaf);
    }
  }
  makeLeaf(parent) {
    this.leaf=new THREE.Group();this.leaf.position.copy(LEAF);parent.add(this.leaf);
    const pos=[],uv=[],idx=[];
    for(let i=0;i<=18;i++)for(let j=0;j<=14;j++) {
      const u=i/18,v=j/14,side=v*2-1,arch=Math.sin(Math.PI*u);
      pos.push((u-.5)*.65,GROUND+.080+(.075-.135*side*side+.02*side)*arch+.008*Math.sin(u*17)*Math.abs(side)*arch,side*.245*Math.pow(arch,.65)*(1+.065*Math.sin(u*19)));
      uv.push(u,v);if(i<18&&j<14){const k=i*15+j;idx.push(k,k+1,k+15,k+1,k+16,k+15);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
    const mat=new THREE.MeshStandardMaterial({color:0x839044,side:THREE.DoubleSide,roughness:.9,transparent:true});this.leafMaterial=mat;
    patchMaterial(mat,{fragmentHook:fs=>fs.replace('#include <color_fragment>',`#include <color_fragment>
      float vein=abs(fract(vOPos.x*15.0 - abs(vOPos.z)*12.0)-.5);
      diffuseColor.rgb*=.82+.18*smoothstep(.01,.065,vein);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.34,.23,.075),smoothstep(.25,.34,abs(vOPos.x))*.55);
      diffuseColor.rgb*=.92+.12*pp_noise(vOPos.xz*55.0);`)});
    const leaf=new THREE.Mesh(geo,mat);leaf.castShadow=true;leaf.receiveShadow=true;this.leaf.add(leaf);
    const veinMat=new THREE.MeshStandardMaterial({color:0xa2aa59,roughness:1,transparent:true});this.leafVeinMaterial=veinMat;
    for(let i=0;i<12;i++){const u=i/12,v=(i+1)/12;segment(this.leaf,V((u-.5)*.65,GROUND+.083+.075*Math.sin(Math.PI*u),0),V((v-.5)*.65,GROUND+.083+.075*Math.sin(Math.PI*v),0),.002,veinMat);}
  }
  updateCamera(camera){
    const p=toLocal(camera.position);
    const near=Math.abs(p.x-LEAF.x)<.7&&Math.abs(p.z-LEAF.z)<.65&&p.y<.4;
    this.leafMaterial.opacity=near?.23:1;this.leafMaterial.depthWrite=!near;
    this.leafVeinMaterial.opacity=near?.08:1;this.leafVeinMaterial.depthWrite=!near;
  }
  makeHill(parent) {
    this.hill=new THREE.Group();this.hill.position.copy(HOME_ANT);parent.add(this.hill);
    const dirt=new THREE.MeshStandardMaterial({color:0x997148,roughness:1,flatShading:true});
    const mound=new THREE.Mesh(new THREE.SphereGeometry(.22,24,12,0,Math.PI*2,0,Math.PI/2),dirt);mound.scale.y=.66;mound.position.y=GROUND;mound.receiveShadow=true;mound.castShadow=true;this.hill.add(mound);
    const hole=new THREE.Mesh(new THREE.CircleGeometry(.065,24),new THREE.MeshBasicMaterial({color:0x22160d}));
    hole.rotation.y=-Math.PI/2;hole.position.set(-.201,.040,0);hole.scale.y=.62;this.hill.add(hole);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.064,.009,6,24),dirt);rim.rotation.y=-Math.PI/2;rim.position.copy(hole.position);rim.scale.y=.68;this.hill.add(rim);
    for(let i=0;i<22;i++) {const a=i*2.4,m=new THREE.Mesh(new THREE.IcosahedronGeometry(.016,0),dirt);m.position.set(Math.cos(a)*(.22+(i%3)*.008),GROUND+.008,Math.sin(a)*.22);this.hill.add(m);}
    this.delivered=breadcrumb();this.delivered.position.set(-.25,.027,0);this.delivered.visible=false;this.hill.add(this.delivered);
  }
  height(p) {
    // One continuous rounded step over the twig; no platforming or seam collisions.
    const t=THREE.MathUtils.clamp((p.z-1.50)/.30,0,1),x=.045+t*.095;
    return p.z>1.48&&p.z<1.82?Math.max(0,1-Math.abs(p.x-x)/.05)*.023:0;
  }
}
