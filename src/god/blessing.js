import * as THREE from 'three';
import { V,mesh,ring,smooth } from './common.js';

// Local light and additive geometry, not a full-screen bloom pass: the growing
// ant keeps a clear silhouette on a phone and the rest of the scene stays sharp.
export class AntBlessing {
  constructor(game){
    this.g=game;this.root=new THREE.Group();this.root.name='antDivineGrowth';game.scene.add(this.root);
    this.strength={value:0};
    const radial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{strength:this.strength},
      vertexShader:'varying vec2 q;void main(){q=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 q;uniform float strength;void main(){float r=length(q);float rim=exp(-pow((r-.65)*7.,2.))*.5;float glow=pow(max(0.,1.-r),2.);gl_FragColor=vec4(1.,.76,.23,(glow*.4+rim)*strength);}' });
    this.aura=mesh(this.root,new THREE.PlaneGeometry(1,1),radial);
    this.floor=mesh(this.root,new THREE.PlaneGeometry(1,1),radial);this.floor.rotation.x=-Math.PI/2;
    this.circles=[ring(this.root,1,0xffed9c,.018),ring(this.root,1,0xffd27c,.009)];
    const beamMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{strength:this.strength},
      vertexShader:'varying vec2 q;void main(){q=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 q;uniform float strength;void main(){float side=pow(max(0.,sin(q.x*3.14159)),2.);float fade=sin(q.y*3.14159);gl_FragColor=vec4(1.,.85,.45,strength*side*fade*.12);}' });
    this.beams=Array.from({length:5},(_,i)=>{const m=mesh(this.root,new THREE.PlaneGeometry(.45,8),beamMaterial);m.position.set(Math.sin(i*2.4)*.9,3.4,Math.cos(i*2.4)*.9);return m;});
    const positions=new Float32Array(28*3),geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.sparkles=new THREE.Points(geo,new THREE.PointsMaterial({color:0xffefb4,size:.075,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));this.sparkles.frustumCulled=false;this.root.add(this.sparkles);
    // Keep the light registered from scene compilation onward. Hiding its
    // parent would change Three's light count and recompile every world shader
    // on the first growth frame, while the already-started choir kept playing.
    this.light=new THREE.PointLight(0xffd88a,0,9,1.4);this.light.name='antBlessingLight';game.scene.add(this.light);this.reset();
  }
  reset(){this.elapsed=0;this.active=false;this.root.visible=false;this.strength.value=0;this.light.intensity=0;}
  start(){this.elapsed=0;this.active=true;this.root.visible=true;}
  update(dt,position,scale){
    if(!this.active)return;this.elapsed+=dt;const t=this.elapsed,k=smooth(t,0,.2)*(1-smooth(t,1.65,2.6));
    this.root.position.copy(position);this.strength.value=k;this.light.intensity=k*8;this.light.position.copy(position).add(V(0,1.4,0));
    const radius=.6+scale*.065;
    this.aura.position.set(0,scale*.025+.12,0);this.aura.quaternion.copy(this.g.camera.quaternion);this.aura.scale.setScalar(radius*2.8);
    this.floor.position.y=.04;this.floor.scale.setScalar(radius*2.8);
    this.circles.forEach((c,i)=>{c.position.y=.045+i*.004;c.scale.setScalar(radius*(1+i*.18)+Math.sin(t*2+i)*.06);c.material.opacity=k*(i?.35:.6);});
    this.beams.forEach((b,i)=>{b.quaternion.copy(this.g.camera.quaternion);b.position.x=Math.sin(i*2.4)*radius*.65;b.position.z=Math.cos(i*2.4)*radius*.65;});
    const points=this.sparkles.geometry.attributes.position;
    for(let i=0;i<points.count;i++){const a=i*2.4+t*.4,r=radius*(.55+(i%5)*.08),y=((i*.137+t*.6)%1)*3.8;points.setXYZ(i,Math.cos(a)*r,y,Math.sin(a)*r);}
    points.needsUpdate=true;this.sparkles.material.opacity=k*.85;
    if(t>=2.6)this.reset();
  }
}
