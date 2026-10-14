import * as THREE from 'three';
import { fishBatch } from './fish-batch.js';
import { V,UP,mesh,ring,smooth,mix } from './common.js';

export class DivineWeather {
  constructor(game){
    this.g=game;const scene=game.scene;
    this.opening=new THREE.Group();scene.add(this.opening);
    this.cloudMaterial=new THREE.MeshStandardMaterial({color:0xfff5de,roughness:1,transparent:true,opacity:0,depthWrite:false});
    this.stormMaterial=this.cloudMaterial.clone();this.arrivalMaterial=this.cloudMaterial.clone();
    this.clouds=[];this.arrivalClouds=[];this.edgeClouds=[];const cloudGeometry=new THREE.SphereGeometry(1,12,8);
    const cloud=(parent,material)=>{const group=new THREE.Group();parent.add(group);
      for(const [x,y,z,sx,sy,sz] of [[-1.45,-.2,0,1.5,.85,1.1],[-.3,.35,.15,1.45,1.2,1.25],[1.1,0,0,1.6,.9,1.1],[-.25,-.15,-.9,1.7,.65,1.2],[.15,-.15,.85,1.65,.75,1.2]]){
        const m=mesh(group,cloudGeometry,material,V(x,y,z));m.scale.set(sx,sy,sz);
      }return group;};
    for(let i=0;i<12;i++){const c=cloud(this.opening,this.cloudMaterial),a=i/12*Math.PI*2;c.userData.angle=a;c.rotation.y=-a-Math.PI/2;c.position.set(Math.cos(a)*7,Math.sin(i)*.7,Math.sin(a)*6);this.clouds.push(c);}
    // A second, staggered bank builds a broad canopy during the arrival. It
    // dissolves as the camera turns down, keeping the playable clearing open.
    for(let i=0;i<16;i++){const c=cloud(this.opening,this.arrivalMaterial),a=(i+.5)/16*Math.PI*2;c.userData.angle=a;c.userData.radius=11.5+(i%2)*3;c.userData.height=1.3+(i%3)*1.3;c.rotation.y=-a-Math.PI/2;c.scale.setScalar(1.25+(i%3)*.15);this.arrivalClouds.push(c);}
    for(let i=0;i<4;i++)this.edgeClouds.push(cloud(scene,this.stormMaterial));
    const glowMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
      uniforms:{strength:{value:0}},vertexShader:'varying vec2 uvG;void main(){uvG=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 uvG;uniform float strength;void main(){float d=length(uvG-.5)*2.;float a=pow(max(0.,1.-d),1.8);gl_FragColor=vec4(1.,.76,.3,a*strength);}' });
    this.glow=mesh(this.opening,new THREE.PlaneGeometry(15,15),glowMat);
    this.halo=mesh(this.opening,new THREE.TorusGeometry(2.5,.09,8,64),new THREE.MeshBasicMaterial({color:0xffe9ae,transparent:true,opacity:0,depthWrite:false}));
    this.beams=new THREE.Group();scene.add(this.beams);this.beamMaterial=new THREE.MeshBasicMaterial({color:0xffdf8c,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending});
    for(let i=0;i<3;i++){const b=mesh(this.beams,new THREE.ConeGeometry(1.4+i*.4,25,24,1,true),this.beamMaterial);b.position.set(i*2-2,0,i-1);}
    this.gold=new THREE.PointLight(0xffdc89,0,65,1);scene.add(this.gold);
    this.flash=new THREE.DirectionalLight(0xddeaff,0);this.flash.position.set(3,18,6);scene.add(this.flash);
    this.shadow=mesh(scene,new THREE.PlaneGeometry(24,18),new THREE.ShaderMaterial({transparent:true,depthWrite:false,
      uniforms:{strength:{value:0}},vertexShader:'varying vec2 uvG;void main(){uvG=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 uvG;uniform float strength;void main(){float d=length((uvG-.5)*2.);gl_FragColor=vec4(.08,.12,.19,max(0.,1.-d)*strength);}' }));this.shadow.rotation.x=-Math.PI/2;
    this.batch=fishBatch(scene,36);this.fish=this.batch.fish.map((f,i)=>{f.root.scale.setScalar(6.5+(i%3)*.8);return {...f,v:V(),state:'off',age:0,slot:i};});
    this.splashes=Array.from({length:12},()=>{const m=ring(scene,.2,0xe0e9d7,.045);return{mesh:m,life:0};});
    this.reset();
  }
  reset(){this.state='clear';this.elapsed=0;this.spawned=0;this.firstAt=null;this.burstAt=null;this.nextFish=3.1;this.intensity=0;this.divine=0;
    this.fish.forEach(f=>{f.state='off';f.root.visible=false;f.roof=null;});this.batch.sync();this.splashes.forEach(s=>{s.life=0;s.mesh.visible=false;});this.applyLight(0);this.g.audio.setWind(0);}
  layout(camera,finalPosition){
    this.opening.position.copy(finalPosition).add(V(0,3,-1));this.gold.position.copy(this.opening.position);
    this.beams.children.forEach((beam,i)=>{const end=V(9+i*2,.05,5.5+i),d=this.opening.position.clone().sub(end);beam.position.copy(end).addScaledVector(d,.5);beam.scale.y=d.length()/25;beam.quaternion.setFromUnitVectors(UP,d.normalize());});
    // Edge wisps are fixed in world space after framing, above the action, not a
    // full-screen overlay. Their centres stay outside the interactive safe area.
    this.edgeClouds.forEach((c,i)=>{const p=V(i%2?1.18:-1.18,i<2?.85:-.08,.5).unproject(camera);const ray=p.sub(camera.position).normalize();c.position.copy(camera.position).addScaledVector(ray,17);c.userData.rest=c.position.clone();c.userData.away=V(i%2?1:-1,.15,0).applyQuaternion(camera.quaternion).multiplyScalar(4);c.scale.setScalar(i<2?1.2:.75);});
  }
  activate(){if(this.state!=='clear')return false;this.state='storm';this.elapsed=0;this.spawned=0;this.firstAt=null;this.burstAt=null;this.nextFish=3.1;this.g.audio.divine('storm');this.g.notice('A change in the weather.',2.2);return true;}
  spawn(first=false){
    let f=this.fish.find(f=>f.state==='off');if(!f)f=this.fish.filter(f=>f.state!=='eating').reduce((a,b)=>a.age>b.age?a:b);
    const c=this.g.truck.root.position,i=this.spawned;
    // The first fish is unmistakably alone and heads for the pickup roof.
    let x=first?c.x:c.x+(Math.random()-.5)*11,z=first?c.z:3+Math.random()*7;
    if(!first&&i%3===0){x=7+Math.random()*8;z=4+Math.random()*5;}
    f.root.position.set(x,first?c.y+7:9+Math.random()*3,z);f.root.rotation.set(.15,Math.random()*Math.PI*2,-.55);
    f.root.scale.setScalar(6.5+(f.slot%3)*.8);
    f.v.set(first?0:(Math.random()-.5)*1.2,0,first?0:(Math.random()-.5)*.7);f.age=0;f.state='fall';f.roof=null;f.bounces=0;f.root.visible=true;
    this.spawned++;
  }
  splash(p){const s=this.splashes.find(s=>s.life<=0)||this.splashes[0];s.life=.55;s.mesh.position.copy(p);s.mesh.visible=true;this.g.audio.effect('splash');}
  updateFish(dt,time){
    for(const f of this.fish){
      if(f.state==='off'||f.state==='eating')continue;f.age+=dt;f.tail.rotation.y=Math.sin(time*13+f.slot)*.45;
      if(f.age>17){f.state='off';f.root.visible=false;continue;}
      if(f.state==='fall'){
        const previous=f.root.position.y;f.v.y-=12*dt;f.root.position.addScaledVector(f.v,dt);f.root.rotation.z+=dt*.65;
        const p=f.root.position,roof=this.g.vehicle.roofAt(p.x,p.z),bed=this.g.lake.height(p.x,p.z),wet=this.g.lake.wet(p.x,p.z);
        const surface=roof&&previous>=roof.y-.05?roof.y:wet?this.g.lake.level:bed;
        if(p.y<=surface+.12&&f.v.y<0){
          p.y=surface+.12;
          if(wet&&!roof){f.state='swim';f.root.rotation.x=0;f.root.rotation.z=0;this.splash(V(p.x,this.g.lake.level+.03,p.z));}
          else if(f.bounces<2&&Math.abs(f.v.y)>1.5){f.v.y=Math.abs(f.v.y)*.32;f.v.x+=(f.slot%2?.5:-.5);f.v.z+=.35;f.bounces++;this.g.audio.effect('fish');}
          else {f.state='flop';f.landed=time;if(roof){f.roof=this.g.truck.body.worldToLocal(p.clone());}}
        }
      } else if(f.state==='swim'){
        const p=f.root.position;
        if(this.g.lake.wet(p.x,p.z)){p.y=this.g.lake.level-.06;f.root.rotation.z=Math.sin(time*2+f.slot)*.08;}
        else {f.state='flop';f.landed=time;}
      } else {
        const flop=Math.max(0,1-(time-f.landed)/3),p=f.root.position;
        if(f.roof)p.copy(this.g.truck.body.localToWorld(f.roof.clone()));else p.y=this.g.lake.height(p.x,p.z)+.12;
        p.y+=Math.abs(Math.sin(time*12+f.slot))*.13*flop;f.root.rotation.x=Math.PI/2+Math.sin(time*15+f.slot)*.24*flop;f.root.rotation.z=Math.sin(time*12+f.slot)*.12*flop;
      }
    }
    for(const s of this.splashes){s.life=Math.max(0,s.life-dt);s.mesh.visible=s.life>0;s.mesh.scale.setScalar(1+(1-s.life/.55)*5);s.mesh.material.opacity=s.life/.55*.7;}
    this.batch.sync();
  }
  applyLight(time){
    const g=this.g,k=this.intensity,d=this.divine;
    g.world.sun.intensity=mix(3.1+d*.35,1.05,k);g.world.sun.color.set(0xfff1d8).lerp(new THREE.Color(0xffdd9d),d*.4).lerp(new THREE.Color(0xbacbe2),k);
    g.world.hemi.intensity=mix(1.05,1.22,k);g.scene.environmentIntensity=mix(.55,.28,k);this.gold.intensity=d*(1-k)*13;
    this.cloudMaterial.opacity=d*.94;this.cloudMaterial.color.set(0xfff5de).lerp(new THREE.Color(0x485568),k);
    this.arrivalMaterial.opacity=this.g.mode==='intro'?d*.96*(1-smooth(this.g.introTime,3.5,4.3)):0;
    this.arrivalClouds.forEach(c=>{c.visible=this.arrivalMaterial.opacity>.001;});
    this.stormMaterial.opacity=k*.94;this.stormMaterial.color.set(0xe3dfd2).lerp(new THREE.Color(0x526071),k);
    this.glow.material.uniforms.strength.value=d*(1-k)*1.25;this.halo.material.opacity=d*(1-k)*.6;this.beamMaterial.opacity=d*(1-k)*.027;
    this.shadow.material.uniforms.strength.value=.08*d+.28*k;this.shadow.position.set(3+Math.sin(time*.15)*7,.024,6.5);
    this.flash.intensity=this.state==='storm'&&this.elapsed>1.42&&this.elapsed<1.55?(g.reducedMotion?.45:2.8):0;
    g.lake.wind.value=k;this.g.audio.setWind(k);
  }
  update(dt,time,divine){
    this.divine=divine;
    if(this.state==='storm'){
      const prev=this.elapsed;this.elapsed+=dt;const t=this.elapsed;this.intensity=smooth(t,0,1.4)*(1-smooth(t,5.8,7.8));
      if(prev<1.5&&t>=1.5)this.g.audio.effect('thunder');
      if(this.firstAt===null&&t>=1.8){this.firstAt=t;this.spawn(true);this.g.notice('…a fish?',1.3);}
      // One fish lands at ~2.7 s. The first burst waits another half second.
      while(t>=this.nextFish&&this.nextFish<5.1){if(this.burstAt===null){this.burstAt=t;this.g.audio.divine('fish-rain');this.g.notice('FORECAST: FISH.',3);}this.spawn();this.nextFish+=.075;}
      if(t>=7.8){this.state='clear';this.intensity=0;this.g.notice('The forecast has cleared. Their argument has not.',3);}
    }
    this.clouds.forEach((c,i)=>{const a=c.userData.angle+time*.018,r=7+(1-divine)*4;c.position.set(Math.cos(a)*r,Math.sin(i+time*.4)*.3,Math.sin(a)*r*.85);});
    this.arrivalClouds.forEach(c=>{const a=c.userData.angle-time*.012,r=c.userData.radius+(1-divine)*6;c.position.set(Math.cos(a)*r,c.userData.height+Math.sin(time*.3+a)*.4,Math.sin(a)*r*.85);});
    this.edgeClouds.forEach(c=>{if(c.userData.rest)c.position.copy(c.userData.rest).addScaledVector(c.userData.away,1-this.intensity);});
    this.glow.quaternion.copy(this.g.camera.quaternion);this.halo.quaternion.copy(this.g.camera.quaternion);
    this.updateFish(dt,time);this.applyLight(time);
  }
}
