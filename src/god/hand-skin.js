import * as THREE from 'three';
import { V,mesh,mix } from './common.js';

// Continuous elliptical skin, with topology reused as the finger bends.
export class HandSkin {
  constructor(parent,material,{rings=32,sides=20,palm=false,nails=null}={}){
    this.rings=rings;this.sides=sides;this.palm=palm;this.curve=new THREE.CatmullRomCurve3();
    const geo=new THREE.BufferGeometry(),count=(rings+1)*(sides+1),indices=[[],[],[]];
    geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage));
    const colors=new Float32Array(count*3),base=new THREE.Color(0xdab49c),pink=new THREE.Color(0xc99584);
    for(let i=0;i<=rings;i++)for(let j=0;j<=sides;j++){
      const t=i/rings,a=j/sides*Math.PI*2,k=i*(sides+1)+j;
      const joint=palm?0:Math.exp(-(((t-.34)/.045)**2))+Math.exp(-(((t-.66)/.04)**2));
      const c=base.clone().lerp(pink,.14+joint*.19+Math.max(0,-Math.sin(a))*.13).multiplyScalar(1+.013*Math.sin(i*4.8+j*12.7));c.toArray(colors,k*3);
      if(i<rings&&j<sides){
        const u=(i+.5)/rings,v=(j+.5)/sides*Math.PI*2;
        const isNail=nails&&((u-.81)/.115)**2+((v-Math.PI/2)/.75)**2<1,group=isNail?(u>.885?2:1):0;
        indices[group].push(k,k+sides+1,k+1,k+1,k+sides+1,k+sides+2);
      }
    }
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.setIndex(indices.flat());
    if(nails){let offset=0;indices.forEach((group,i)=>{geo.addGroup(offset,group.length,i);offset+=group.length;});}
    this.mesh=mesh(parent,geo,nails?[material,...nails]:material);this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
    this.center=V();this.tangent=V();this.normal=V();this.side=V();
  }
  profile(values,t){const f=t*(values.length-1),i=Math.min(values.length-2,Math.floor(f)),cap=!this.palm&&t>.9?Math.sqrt(Math.max(.0001,1-((t-.9)/.1)**2)):1;return mix(values[i],values[i+1],f-i)*cap;}
  frame(t,up){
    this.curve.getPoint(t,this.center);this.curve.getTangent(t,this.tangent).normalize();
    this.normal.copy(up).addScaledVector(this.tangent,-up.dot(this.tangent)).normalize();
    if(this.normal.lengthSq()<.01)this.normal.set(0,1,0).addScaledVector(this.tangent,-this.tangent.y).normalize();
    this.side.crossVectors(this.tangent,this.normal).normalize();
  }
  set(points,widths,depths,up){
    this.curve.points=points;this.widths=widths;this.depths=depths;const pos=this.mesh.geometry.attributes.position;
    for(let i=0;i<=this.rings;i++){
      const t=i/this.rings;this.frame(t,up);const w=this.profile(widths,t),h=this.profile(depths,t);
      for(let j=0;j<=this.sides;j++){
        const a=j/this.sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a),ridge=this.palm?.045*Math.max(0,s)**6*(1+Math.cos(c*13))*.5*Math.sin(t*Math.PI):0;
        const x=c*w,y=s*h+ridge,p=this.center,u=this.side,v=this.normal;pos.setXYZ(i*(this.sides+1)+j,p.x+u.x*x+v.x*y,p.y+u.y*x+v.y*y,p.z+u.z*x+v.z*y);
      }
    }
    pos.needsUpdate=true;this.mesh.geometry.computeVertexNormals();
  }
}
