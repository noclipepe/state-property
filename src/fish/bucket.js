import * as THREE from 'three';

export const WATER = 0.47;
export const RIM = 0.49;
export const REST = 0.445;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A small, open pail. Only its surface and a few pooled particles animate.
export class Bucket {
  constructor(scene, position, { fishScale = 0.65 } = {}) {
    this.root = new THREE.Group();
    this.home = position.clone();
    this.fishScale = fishScale;
    this.root.position.copy(position);
    scene.add(this.root);
    this.time = { value: 0 };
    this.impact = { value: -10 };
    this.filled = { value: 1 };
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8baba, roughness: 0.3, metalness: 0.78, side: THREE.DoubleSide });
    steel.onBeforeCompile = (s) => {
      s.uniforms.uFishTime = this.time;
      s.uniforms.uFilled = this.filled;
      s.vertexShader = 'varying vec3 vBucket;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBucket = position;');
      s.fragmentShader = 'varying vec3 vBucket; uniform float uFishTime; uniform float uFilled;\n' + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float angle = atan(vBucket.z, vBucket.x);
        float brush = sin(vBucket.y * 4300.0 + sin(angle * 43.0)) * 0.025;
        float zinc = sin(angle * 81.0 + vBucket.y * 470.0) * sin(angle * 143.0 - vBucket.y * 330.0);
        diffuseColor.rgb *= 0.94 + brush + zinc * 0.055;
      `);
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 p = vBucket * 29.0;
        float c = sin(p.x + sin(p.z + uFishTime * 0.8)) * sin(p.y + p.z * 0.6 - uFishTime);
        float caustic = pow(max(0.0, 1.0 - abs(c) * 7.0), 3.0);
        totalEmissiveRadiance += vec3(0.08, 0.1, 0.085) * caustic * uFilled * (1.0 - smoothstep(0.45, 0.48, vBucket.y));
      `);
    };
    const points = [[0,0.02],[0.225,0.02],[0.235,0.035],[0.33,0.47],[0.33,RIM],[0.319,RIM],[0.316,0.47],[0.223,0.045],[0,0.045]].map(([x,y]) => new THREE.Vector2(x,y));
    const wall = new THREE.Mesh(new THREE.LatheGeometry(points, 64), steel);
    wall.castShadow = true; wall.receiveShadow = true;
    this.root.add(wall);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd2d3d4, metalness: 0.9, roughness: 0.2 });
    const ring = (radius, y, tube, mat = rimMat) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 64), mat);
      m.rotation.x = Math.PI / 2; m.position.y = y; this.root.add(m); return m;
    };
    ring(0.325, RIM, 0.011);
    ring(0.231, 0.06, 0.008);
    ring(0.252, 0.19, 0.006);
    ring(0.286, 0.345, 0.006);
    // The thin wire bail is raised, with small pivots on either side of the rim.
    this.handle = new THREE.Group();
    this.root.add(this.handle);
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x7d8584, metalness: 0.85, roughness: 0.3 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.005, 8, 48, Math.PI), wireMat);
    arch.position.y = RIM + 0.022; arch.rotation.x = -0.65;
    this.handle.add(arch);
    const grip = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.008, 8, 14, 0.32), new THREE.MeshStandardMaterial({ color: 0x454b48, roughness: 0.65 }));
    const gripMount = new THREE.Group();
    gripMount.position.copy(arch.position); gripMount.rotation.copy(arch.rotation);
    grip.rotation.z = Math.PI / 2 - 0.16; gripMount.add(grip); this.handle.add(gripMount);
    for (const side of [-1, 1]) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.015,0.095,0.039), wireMat);
      lug.position.set(side * 0.326, RIM - 0.022, 0); this.handle.add(lug);
      const eyelet = new THREE.Mesh(new THREE.TorusGeometry(0.012,0.0035,6,16), rimMat);
      eyelet.rotation.y = Math.PI / 2; eyelet.position.set(side * 0.336, RIM + 0.022, 0); this.handle.add(eyelet);
      const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), rimMat);
      pivot.position.set(side * 0.328, RIM - 0.025, 0); pivot.scale.set(0.4, 1, 1);
      this.handle.add(pivot);
    }
    const fill = new THREE.PointLight(0xf0f3e9, 0.42, 1.2, 1);
    fill.position.y = 0.43; this.root.add(fill);

    const waterMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: this.time, uImpact: this.impact },
      vertexShader: `varying vec2 vP; uniform float uTime; uniform float uImpact;
        void main() {
          vP = position.xy;
          vec3 p = position;
          float age = max(0.0, uTime - uImpact);
          p.z += sin(p.x * 23.0 + uTime * 1.7) * sin(p.y * 19.0 - uTime) * 0.003;
          p.z += sin(length(p.xy) * 40.0 - age * 12.0) * exp(-age * 2.0) * 0.013;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `varying vec2 vP; uniform float uTime; uniform float uImpact;
        void main() {
          float ripple = sin(vP.x * 23.0 + uTime * 1.7 + sin(vP.y * 26.0 - uTime));
          float light = pow(max(0.0, ripple), 18.0);
          float age = max(0.0, uTime - uImpact);
          float ring = pow(max(0.0, cos(length(vP) * 48.0 - age * 13.0)), 12.0) * exp(-age * 1.5);
          float edge = smoothstep(0.28, 0.314, length(vP));
          gl_FragColor = vec4(mix(vec3(0.55,0.79,0.72), vec3(1.0,0.98,0.81), light), 0.035 + light * 0.24 + ring * 0.32 + edge * 0.18);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.surface = new THREE.Mesh(new THREE.CircleGeometry(0.315, 64), waterMaterial);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.y = WATER;
    this.surface.renderOrder = 3;
    this.root.add(this.surface);

    const bubbleMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 p = modelViewMatrix * vec4(position,1.0); vV = -p.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * p; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0 - abs(dot(normalize(vN),normalize(vV))),2.0); gl_FragColor = vec4(0.82,1.0,0.96,0.025 + rim * 0.6); }',
    });
    const bubbleGeo = new THREE.SphereGeometry(1, 10, 7);
    this.bubbles = Array.from({ length: 10 }, (_, i) => {
      const mesh = new THREE.Mesh(bubbleGeo, bubbleMaterial);
      this.root.add(mesh); mesh.visible = false;
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.22, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(-0.3, 0.55, 0.55); mesh.add(shine);
      return { mesh, speed: 0.12 + i * 0.008, phase: i * 2.4 };
    });
    const dust = [];
    for (let i = 0; i < 35; i++) {
      const a = i * 2.399, r = 0.21 * Math.sqrt((i + 1) / 35);
      dust.push(Math.cos(a) * r, 0.07 + (i * 0.137 % 0.36), Math.sin(a) * r);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xe5edbc, size: 0.003, transparent: true, opacity: 0.4, depthWrite: false }));
    this.root.add(this.dust);
    this.drops = Array.from({ length: 26 }, (_, i) => {
      const mesh = new THREE.Mesh(bubbleGeo, bubbleMaterial);
      mesh.scale.setScalar(0.007 + (i % 3) * 0.002); mesh.visible = false;
      this.root.add(mesh);
      return { mesh, v: V(0,0,0), life: 0 };
    });
    const crownVertices = [], crownIndices = [];
    for (let i = 0; i <= 32; i++) {
      const a = i / 32 * Math.PI * 2;
      crownVertices.push(Math.cos(a)*0.035,0,Math.sin(a)*0.035, Math.cos(a)*0.105,0.08 + Math.pow(Math.sin(a*7),2)*0.065,Math.sin(a)*0.105);
      if (i < 32) { const j=i*2; crownIndices.push(j,j+1,j+2,j+1,j+3,j+2); }
    }
    const crownGeo = new THREE.BufferGeometry();
    crownGeo.setAttribute('position',new THREE.Float32BufferAttribute(crownVertices,3)); crownGeo.setIndex(crownIndices);
    this.crown = new THREE.Mesh(crownGeo, new THREE.MeshBasicMaterial({ color: 0xc8f3ed, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.root.add(this.crown);
    this.school = new THREE.Group();
    this.root.add(this.school);
    this.fish = [makeFish(0x879b68), makeFish(0x778f97)];
    for (const fish of this.fish) { fish.root.scale.setScalar(fishScale); this.school.add(fish.root); }
    this.reset();
  }

  reset() {
    this.root.scale.setScalar(1);
    this.root.position.copy(this.home); this.root.quaternion.identity(); this.spilled = false;
    this.filled.value = 1;
    this.handle.rotation.x = 0;
    this.surface.visible = true; this.dust.visible = true; this.crown.visible = false;
    this.time.value = 0; this.impact.value = -10; this.next = 0;
    for (const b of this.bubbles) b.mesh.visible = false;
    for (const d of this.drops) { d.mesh.visible = false; d.life = 0; }
    for (let i = 0; i < 4; i++) this.bubble(0.1 + i * 0.08);
    this.updateFish();
  }

  bubble(y = 0.25) {
    const b = this.bubbles[this.next++ % this.bubbles.length], a = b.phase;
    b.mesh.position.set(Math.sin(a) * 0.18, y, Math.cos(a) * 0.18);
    b.mesh.scale.setScalar(0.011 + (this.next % 3) * 0.004);
    b.mesh.visible = true;
  }

  splash(strength = 1, offset = V(0,0,0)) {
    this.impact.value = this.time.value;
    this.splashStrength = strength;
    this.crown.position.set(offset.x,WATER,offset.z); this.crown.visible = true;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i], a = i * 2.399;
      d.mesh.position.set(offset.x + Math.cos(a) * 0.04, WATER, offset.z + Math.sin(a) * 0.04);
      d.v.set(Math.cos(a) * 0.16, (0.65 + (i % 4) * 0.16) * strength, Math.sin(a) * 0.16);
      d.life = 1.2; d.mesh.visible = true;
    }
    this.bubble(WATER - 0.07); this.bubble(WATER - 0.15);
  }

  updateFish() {
    for (let i = 0; i < this.fish.length; i++) {
      const fish = this.fish[i], t = this.time.value, side = i ? 1 : -1;
      // Larger fish swim in separate lanes near the centre, clear of the tapered walls.
      const large = this.fishScale > 1;
      fish.root.position.set(side * (0.045 + Math.sin(t * 0.65 + i) * 0.015), (large ? 0.335 : 0.387) + i * 0.03 + Math.sin(t * 1.2 + i * 2) * 0.008, (large ? side * 0.115 : -0.245) + Math.sin(t * 0.45 + i * 3) * 0.008);
      fish.root.rotation.set(Math.sin(t * 1.4 + i) * 0.07, (i ? Math.PI : 0) + Math.sin(t * 0.65 + i) * 0.35, Math.sin(t * 1.1 + i) * 0.06);
      fish.tail.rotation.y = Math.sin(t * 7 + i * 2) * 0.3;
    }
  }

  update(dt) {
    this.time.value += dt;
    if (this.spilled) return;
    this.updateFish();
    const age = this.time.value - this.impact.value;
    this.crown.visible = age < 0.48;
    if (this.crown.visible) {
      this.crown.scale.set(0.65+age*2, Math.sin(age/0.48*Math.PI)*this.splashStrength, 0.65+age*2);
      this.crown.material.opacity = 0.65 * (1-age/0.48);
    }
    this.dust.rotation.y = Math.sin(this.time.value * 0.13) * 0.12;
    for (const b of this.bubbles) if (b.mesh.visible) {
      b.mesh.position.y += dt * b.speed;
      b.mesh.position.x += Math.sin(this.time.value * 2 + b.phase) * dt * 0.009;
      if (b.mesh.position.y > WATER) b.mesh.visible = false;
    }
    for (const d of this.drops) if (d.life > 0) {
      d.life -= dt; d.v.y -= dt * 3.8; d.mesh.position.addScaledVector(d.v, dt);
      if (d.mesh.position.y < WATER || d.life <= 0) { d.life = 0; d.mesh.visible = false; }
    }
  }
}

// Two small silver fish share the bucket. The player's own body stays out of view.
function makeFish(backColor) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd4d7bb, roughness: 0.38, metalness: 0.25 });
  const backMat = new THREE.MeshStandardMaterial({ color: backColor, roughness: 0.48, metalness: 0.15 });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x9b9c75, side: THREE.DoubleSide, roughness: 0.65 });
  const sphere = new THREE.SphereGeometry(1, 16, 10);
  const body = new THREE.Mesh(sphere, bodyMat);
  body.scale.set(0.061, 0.022, 0.017); root.add(body);
  const back = new THREE.Mesh(sphere, backMat);
  back.scale.set(0.053, 0.012, 0.016); back.position.set(-0.005, 0.014, 0); root.add(back);
  const fin = (vertices) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geo.computeVertexNormals();
    return new THREE.Mesh(geo, finMat);
  };
  root.add(fin([-0.03,0.019,0, -0.026,0.043,0, 0.016,0.02,0]));
  const tail = new THREE.Group(); tail.position.x = -0.05; root.add(tail);
  tail.add(fin([0,0,0, -0.035,0.029,0, -0.029,0,0, 0,0,0, -0.029,0,0, -0.035,-0.029,0]));
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xe6dba4, roughness: 0.35 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111914, roughness: 0.18 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(sphere, eyeMat); eye.scale.set(0.009,0.009,0.004);
    eye.position.set(0.037,0.006,side * 0.014); root.add(eye);
    const pupil = new THREE.Mesh(sphere,pupilMat); pupil.scale.set(0.0045,0.0045,0.002);
    pupil.position.set(0.039,0.007,side * 0.017); root.add(pupil);
    root.add(fin([0.005,-0.005,side*0.014, -0.027,-0.019,side*0.036, -0.016,-0.012,side*0.012]));
  }
  return { root, tail };
}

// A single lightweight screen pass: refract the view through the surface, retain crisp walls.
export class WaterView {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.info.autoReset = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.uniforms = {
      tScene: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
      uTime: { value: 0 }, uWet: { value: 1 }, uWater: { value: WATER }, uSplash: { value: 0 },
      uInverse: { value: new THREE.Matrix4() },
    };
    this.material = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tDepth;
        uniform float uTime, uWet, uWater, uSplash; uniform mat4 uInverse;
        void main() {
          float depth = texture2D(tDepth, vUv).x;
          vec4 p = uInverse * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          float through = smoothstep(uWater, uWater + 0.12, p.y / p.w);
          vec2 warp = vec2(sin(vUv.y * 34.0 + uTime * 1.4), cos(vUv.x * 29.0 - uTime * 1.2));
          float drop = 0.0;
          for (int i = 0; i < 5; i++) {
            float f = float(i);
            vec2 center = vec2(0.12 + fract(f*0.37)*0.8, 0.18 + fract(f*0.23)*0.62);
            float d = length((vUv-center) * vec2(1.0,0.7));
            drop += (1.0-smoothstep(0.024,0.034,d)) * smoothstep(0.01,0.027,d);
          }
          vec2 uv = clamp(vUv + warp * (0.0032 * uWet * through + uSplash * (0.006 + drop*0.008)), vec2(0.002), vec2(0.998));
          vec3 color = texture2D(tScene, uv).rgb;
          color *= mix(vec3(1.0), vec3(0.90,1.0,0.98), uWet);
          color += vec3(0.005,0.018,0.014) * uWet;
          color = mix(color,vec3(0.8,0.96,0.96),clamp(drop*uSplash*0.28,0.0,0.35));
          float vignette = smoothstep(0.3, 0.8, distance(vUv, vec2(0.5)));
          color *= 1.0 - vignette * uWet * 0.12;
          gl_FragColor = vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), this.material));
    this.camera = new THREE.Camera();
  }
  resize(w, h) { this.target.setSize(w, h); }
  render(scene, camera, time, wet, splash = 0) {
    this.renderer.info.reset();
    this.uniforms.uTime.value = time; this.uniforms.uWet.value = wet; this.uniforms.uSplash.value = splash;
    camera.updateMatrixWorld();
    this.uniforms.uInverse.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
