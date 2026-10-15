// The ending under the pond: a murky basin, the surface seen from below (a bright Snell's window
// overhead, a dark mirror beyond it), rising bubbles and a full-screen water pass in the spirit of
// the Fish POV (gentle warp, green tint, distance murk measured only along the underwater path).
import * as THREE from 'three';
import { V } from '../god/common.js';
import { POND } from './perch.js';

export class Underwater {
  constructor(renderer, scene, ground) {
    this.renderer = renderer;
    // From below, the lawn is a muddy ceiling around the pond's opening (the pond itself stays open).
    const gm = ground.material, hook = gm.onBeforeCompile, key = gm.customProgramCacheKey();
    gm.side = THREE.DoubleSide;
    gm.onBeforeCompile = (s) => {
      hook(s);
      s.fragmentShader = s.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (cameraPosition.y < 0.0) { vec2 pq = (vWPos.xz - vec2(${POND.x.toFixed(2)}, ${POND.z.toFixed(2)})) / vec2(${POND.rx.toFixed(3)}, ${POND.rz.toFixed(3)}); if (dot(pq, pq) < 1.0) discard; }`);
    };
    gm.customProgramCacheKey = () => key + '-witness-underside'; gm.needsUpdate = true;
    this.time = { value: 0 };
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    const basin = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a4529, roughness: 1, side: THREE.BackSide }));
    basin.scale.set(POND.rx * 1.03, 2.1, POND.rz * 1.03); basin.position.set(POND.x, POND.y, POND.z);
    this.group.add(basin);
    const surface = new THREE.Mesh(new THREE.CircleGeometry(4.6, 72), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: this.time },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform float uTime;
        void main(){
          vec3 v = normalize(vW - cameraPosition);
          float n = sin(vW.x * 7.0 + uTime * 1.7) * sin(vW.z * 6.0 - uTime * 1.3) + 0.5 * sin((vW.x + vW.z) * 13.0 + uTime * 2.4);
          float c = v.y + n * 0.025;
          float window = smoothstep(0.6, 0.7, c);             // Snell's window: about 48 degrees from straight up
          float rim = smoothstep(0.54, 0.64, c) * (1.0 - smoothstep(0.66, 0.76, c));
          vec3 mirror = vec3(0.07, 0.12, 0.09) * (0.85 + 0.25 * n);
          vec3 col = mix(mirror, vec3(0.86, 1.0, 0.96), window) + rim * vec3(0.55, 0.75, 0.65);
          gl_FragColor = vec4(col, mix(0.97, 0.12 + 0.05 * n, window));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    surface.rotation.x = Math.PI / 2; surface.scale.set(1.3, 1, 1); surface.position.set(POND.x, POND.y - 0.005, POND.z);
    surface.renderOrder = 5;
    this.group.add(surface);
    // bubbles
    this.bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({
      color: 0xdffcf4, emissive: 0x2c4a44, roughness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }), 46);
    this.bubbles.frustumCulled = false; this.group.add(this.bubbles);
    this.seeds = Array.from({ length: 46 }, () => ({ p: V(), v: 0, r: 0, ph: Math.random() * 6, alive: false }));
    // the water pass
    this.target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    this.uniforms = { tScene: { value: this.target.texture }, tDepth: { value: this.target.depthTexture }, uTime: this.time,
      uInverse: { value: new THREE.Matrix4() }, uCam: { value: V() }, uFlash: { value: 0 }, uSurface: { value: POND.y } };
    this.pass = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false, uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform sampler2D tScene, tDepth; uniform mat4 uInverse; uniform vec3 uCam; uniform float uTime, uFlash, uSurface;
        void main(){
          vec2 warp = vec2(sin(vUv.y * 29.0 + uTime * 1.3), cos(vUv.x * 25.0 - uTime * 1.1)) * 0.0045;
          vec2 uv = clamp(vUv + warp, vec2(0.002), vec2(0.998));
          float depth = texture2D(tDepth, uv).x;
          vec4 p = uInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec3 w = p.xyz / p.w, ray = w - uCam; float dist = length(ray); vec3 dir = ray / max(dist, 1e-4);
          // murk accumulates only along the part of the ray that is under water
          float path = (w.y > uSurface || depth >= 1.0) ? (uSurface - uCam.y) / max(dir.y, 0.06) : dist;
          float murk = (1.0 - exp(-path * 0.32)) * ((w.y > uSurface || depth >= 1.0) ? 0.7 : 1.0);
          vec3 col = texture2D(tScene, uv).rgb * vec3(0.78, 0.98, 0.88);
          vec3 deep = mix(vec3(0.04, 0.09, 0.07), vec3(0.14, 0.25, 0.19), smoothstep(-0.4, 0.8, dir.y));
          col = mix(col, deep, clamp(murk, 0.0, 0.94));
          // soft light shafts from the surface
          float shaft = pow(max(0.0, sin(vUv.x * 9.0 + vUv.y * 3.0 + uTime * 0.35)), 6.0) * smoothstep(0.2, 1.0, vUv.y);
          col += vec3(0.05, 0.09, 0.07) * shaft;
          col *= 1.0 - 0.38 * smoothstep(0.32, 0.86, distance(vUv, vec2(0.5)));
          col = mix(col, vec3(0.92, 1.0, 0.98), uFlash);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.passScene = new THREE.Scene(); this.passScene.add(this.pass);
    this.passCamera = new THREE.Camera();
    this.active = false;
  }

  resize(w, h) { this.target.setSize(w, h); }

  enable(on, camera) {
    this.active = on; this.group.visible = on; this.flash = on ? 1 : 0; this.age = 0;
    for (const s of this.seeds) s.alive = false;
    if (on) for (let i = 0; i < 34; i++) this.#spawn(camera, true);
  }

  #spawn(camera, burst) {
    const s = this.seeds.find((q) => !q.alive); if (!s) return;
    const f = camera.getWorldDirection(V()), r = V(1, 0, 0).applyQuaternion(camera.quaternion);
    s.p.copy(camera.position).addScaledVector(f, 0.35 + Math.random() * (burst ? 0.9 : 1.6))
      .addScaledVector(r, (Math.random() - 0.5) * (burst ? 0.7 : 1.4)).add(V(0, -0.25 - Math.random() * 0.3, 0));
    s.v = 0.35 + Math.random() * 0.4; s.r = burst ? 0.006 + Math.random() * 0.02 : 0.004 + Math.random() * 0.01; s.alive = true;
  }

  update(dt, camera) {
    if (!this.active) return;
    this.age += dt; this.time.value += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    if (Math.random() < dt * (this.age < 1.5 ? 10 : 2.5)) this.#spawn(camera, false);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V();
    this.seeds.forEach((b, i) => {
      if (b.alive) {
        b.p.y += b.v * dt; b.ph += dt * 6;
        b.p.x += Math.sin(b.ph) * 0.06 * dt; b.p.z += Math.cos(b.ph * 0.8) * 0.06 * dt;
        if (b.p.y > POND.y - 0.01) b.alive = false;
      }
      m.compose(b.p, q, s.setScalar(b.alive ? b.r : 0)); this.bubbles.setMatrixAt(i, m);
    });
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  render(scene, camera) {
    const r = this.renderer;
    camera.updateMatrixWorld();
    this.uniforms.uInverse.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uFlash.value = this.flash * this.flash;
    r.setRenderTarget(this.target); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.passScene, this.passCamera);
  }
}
