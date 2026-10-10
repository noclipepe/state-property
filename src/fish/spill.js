import * as THREE from 'three';
import { WATER, RIM } from './bucket.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const UP = V(0,1,0);
const smooth = THREE.MathUtils.smoothstep;

// A finite, contact-triggered spill. No fluid solver or detached animation timers.
export class BucketSpill {
  constructor(game, { followCamera = true } = {}) {
    this.game = game;
    this.followCamera = followCamera;
    this.group = new THREE.Group(); game.scene.add(this.group);
    const geometry = new THREE.PlaneGeometry(1,1,1,12);
    this.sheet = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xb1e1d8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    this.sheet.frustumCulled = false; this.group.add(this.sheet);
    this.puddle = new THREE.Mesh(new THREE.CircleGeometry(1,48), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vP; uniform float uTime;
        void main(){ float r=length(vP); float a=atan(vP.y,vP.x);
          float edge=1.0-smoothstep(0.78,0.97,r+sin(a*7.0)*0.03);
          float rings=pow(max(0.0,sin(r*39.0-uTime*5.0)),18.0);
          gl_FragColor=vec4(mix(vec3(0.12,0.24,0.2),vec3(0.76,0.91,0.86),rings*0.4),edge*0.36);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.puddle.rotation.x = -Math.PI/2; this.group.add(this.puddle);
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.012,8,5), new THREE.MeshBasicMaterial({color:0xc6ece7,transparent:true,opacity:0.65}), 32);
    this.drops.frustumCulled = false; this.group.add(this.drops);
    this.dummy = new THREE.Object3D(); this.temp = V(); this.axis = V();
    this.reset();
  }

  reset() {
    this.active = false; this.t = 0; this.contacts = 0; this.lastFlop = -1; this.poured = false;
    this.group.visible = false; this.flightStart = null;
    for (const f of this.game.bucket.fish) this.game.bucket.school.add(f.root);
  }

  checkContact() {
    if (this.active) return;
    if (this.followCamera ? !['drag','settle'].includes(this.game.hook.phase) : this.game.truck.sim.speed < 0.05) return;
    const g=this.game, D=g.truck.dims, p=g.truck.root.worldToLocal(g.bucket.home.clone());
    const near = V(THREE.MathUtils.clamp(p.x,D.frontX,D.rearX),0,THREE.MathUtils.clamp(p.z,-D.halfW,D.halfW));
    const normal = p.clone().setY(0).sub(near);
    if (normal.length() > 0.34) return;
    if (normal.lengthSq()<0.001) normal.set(0,0,1);
    normal.normalize().transformDirection(g.truck.root.matrixWorld);
    this.begin(normal);
  }

  begin(direction) {
    if (this.active) return;
    const g=this.game, b=g.bucket;
    this.active = true; this.contacts++; this.group.visible = true;
    this.dir = direction.clone().setY(0).normalize(); this.side = this.dir.clone().cross(UP);
    this.axis.crossVectors(UP,this.dir).normalize();
    this.eyeLocal = g.camera.position.clone().sub(b.home);
    this.startYaw=g.yaw ?? 0; this.startPitch=g.pitch; this.startWet=g.wet;
    this.land = b.home.clone().addScaledVector(this.dir,2.25).addScaledVector(this.side,0.58).setY(0.065);
    const look = b.home.clone().addScaledVector(this.dir,0.65).sub(this.land);
    this.landYaw = this.startYaw + Math.atan2(Math.sin(Math.atan2(-look.x,-look.z)-this.startYaw),Math.cos(Math.atan2(-look.x,-look.z)-this.startYaw));
    this.fishStarts = b.fish.map(f => f.root.getWorldPosition(V()));
    for (const f of b.fish) this.group.attach(f.root);
    b.spilled = true; b.dust.visible=false; b.crown.visible=false;
    for (const p of [...b.bubbles,...b.drops]) p.mesh.visible=false;
    if (this.followCamera) { g.input.reset(); g.jump=null; g.swimVelocity.set(0,0,0); }
    if (g.audio.bucketHit) g.audio.bucketHit();
    else { g.audio.thud(0.22,150); g.audio.ping(780,0.06); }
    this.puddle.position.copy(b.home).addScaledVector(this.dir,1.55).setY(0.009);
    g.world.trample.stamp(this.puddle.position.x,this.puddle.position.z,1.1,1);
  }

  update(dt) {
    if (!this.active) return;
    const g=this.game,b=g.bucket;
    this.t += dt; const t=this.t;
    // The rim falls away from the truck; its base slides out of the truck's path.
    const tilt=smooth(t,0,0.85), slide=smooth(t,0.12,1.2);
    const angle=tilt*1.53, sin=Math.sin(angle), cos=Math.cos(angle);
    b.root.quaternion.setFromAxisAngle(this.axis,angle);
    b.root.position.copy(b.home).addScaledVector(this.dir,slide*0.82);
    b.root.position.y = 0.002+Math.max(0,0.225*sin-0.02*cos,0.235*sin-0.035*cos,0.336*sin-RIM*cos);
    b.surface.visible=t<0.28;
    b.filled.value=1-smooth(t,0.2,0.9);
    b.handle.rotation.x = Math.sin(Math.min(t,1.4)*7)*0.12*Math.exp(-t);
    const grow=smooth(t,0.25,1.55);
    this.puddle.scale.set(0.02+grow*1.1,0.02+grow*0.8,1);
    this.puddle.material.uniforms.uTime.value=t;
    this.sheet.visible=t>0.19&&t<1.3;
    if (this.sheet.visible) {
      b.root.updateMatrixWorld(true);
      const mouth=V(0,WATER,0).applyMatrix4(b.root.matrixWorld).addScaledVector(this.dir,0.16);
      const attr=this.sheet.geometry.attributes.position;
      for(let i=0;i<attr.count;i++) {
        const u=Math.floor(i/2)/12, s=(i%2 ? 1 : -1);
        this.temp.copy(mouth).lerp(this.puddle.position,u).addScaledVector(this.side,s*(0.11+u*0.18)*(1+Math.sin(u*19-t*14)*0.07));
        this.temp.y=Math.max(0.014,this.temp.y-Math.sin(u*Math.PI)*0.15);
        attr.setXYZ(i,this.temp.x,this.temp.y,this.temp.z);
      }
      attr.needsUpdate=true; this.sheet.material.opacity=0.62*(1-smooth(t,0.85,1.3));
    }
    this.drops.visible=t<2;
    if(this.drops.visible) {
      for(let i=0;i<32;i++) {
        const age=t-0.2-i*0.013;
        this.dummy.position.copy(b.home).addScaledVector(this.dir,0.2+Math.max(age,0)*(0.65+(i%5)*0.13)).addScaledVector(this.side,Math.sin(i*2.4)*Math.max(age,0)*0.38);
        this.dummy.position.y=0.38+age*(0.55+(i%4)*0.11)-age*age*1.8;
        this.dummy.scale.setScalar(age<0||this.dummy.position.y<0.014 ? 0 : 0.7+(i%3)*0.35);
        this.dummy.updateMatrix(); this.drops.setMatrixAt(i,this.dummy.matrix);
      }
      this.drops.instanceMatrix.needsUpdate=true;
    }
    if(t>=0.2&&!this.poured) {
      this.poured=true;
      if (g.audio.splash) g.audio.splash(2);
      else g.audio.whoosh(0.7,0.24);
      if (this.followCamera) g.splashAt=b.time.value;
    }
    const airborne=smooth(t,0.35,1.4);
    for(let i=0;i<b.fish.length;i++) {
      const f=b.fish[i], spacing=0.08*Math.max(1,b.fishScale/0.65);
      const end=this.land.clone().lerp(b.home.clone().addScaledVector(this.dir,0.82),0.28+i*0.04).addScaledVector(this.side,i ? -spacing : spacing).setY(Math.max(0.025,b.fishScale*0.019));
      f.root.position.copy(this.fishStarts[i]).lerp(end,airborne);
      f.root.position.y += Math.sin(airborne*Math.PI)*0.18;
      const flop=this.flop(t-1.4-i*0.08);
      f.root.position.y += flop*0.045;
      f.root.rotation.order='YXZ'; f.root.rotation.set(1.4+flop*0.4,this.landYaw+i*0.3,flop*0.22);
      f.tail.rotation.y=Math.sin(t*24+i)*0.45*(1-smooth(t,3.2,4.2));
    }
    if (this.followCamera) this.camera();
    if(t>=1.4) {
      const beat=Math.floor((t-1.4)/0.62);
      if(beat!==this.lastFlop&&beat<4) {
        this.lastFlop=beat;
        if (g.audio.flop) g.audio.flop(beat===0 ? 1 : 0.65);
        else g.audio.thud(beat===0 ? 0.07 : 0.04,190);
      }
    }
  }

  flop(t) { return t>=0&&t<2.48 ? Math.pow(Math.max(0,Math.sin(t/0.62*Math.PI)),4)*(1-t/3.4) : 0; }

  camera() {
    const g=this.game,b=g.bucket,t=this.t, flight=smooth(t,0.38,1.4);
    if(t<0.38) g.camera.position.copy(this.eyeLocal).applyQuaternion(b.root.quaternion).add(b.root.position);
    else {
      this.flightStart ??= g.camera.position.clone();
      g.camera.position.copy(this.flightStart).lerp(this.land,flight);
      g.camera.position.y += Math.sin(flight*Math.PI)*0.24 + this.flop(t-1.4)*0.075;
    }
    const turn=smooth(t,0.1,1.25), twitch=this.flop(t-1.4);
    g.camera.rotation.set(THREE.MathUtils.lerp(this.startPitch,0.17,turn)-Math.sin(flight*Math.PI)*0.65+twitch*0.07,THREE.MathUtils.lerp(this.startYaw,this.landYaw,turn),Math.sin(smooth(t,0,1.4)*Math.PI)*0.4-0.17*turn+twitch*0.1);
    g.height=g.camera.position.y; g.wet=this.startWet*(1-smooth(t,0.2,0.64)); g.audio.setDepth(g.wet);
  }
}
