// Shader patches shared by all scene materials: baked vertex AO, skin wrap lighting,
// procedural plaid fabric and dappled tree-canopy sunlight.
import * as THREE from 'three';

export const globalUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
  // up to 4 canopy shadows: xz center, radius, crown height
  uCanopy: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  uCanopyStrength: { value: 0.45 },
  // trample map: flattened grass / tyre tracks, xz area centre + half size
  uTrample: { value: null },
  uTrampleArea: { value: new THREE.Vector4(-0.5, 1.0, 12, 12) },
};

// CPU-painted texture of tyre tracks (R = flattened amount)
export class TrampleMap {
  constructor(size = 256) {
    this.size = size;
    this.data = new Uint8Array(size * size * 4);
    this.tex = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    globalUniforms.uTrample.value = this.tex;
    this.dirty = false;
  }
  clear() { this.data.fill(0); this.tex.needsUpdate = true; }
  // paint a soft disc at world (x, z)
  stamp(x, z, radius, amount) {
    const A = globalUniforms.uTrampleArea.value, n = this.size;
    const u = ((x - A.x) / (2 * A.z) + 0.5) * n, v = ((z - A.y) / (2 * A.w) + 0.5) * n;
    const r = (radius / (2 * A.z)) * n;
    const x0 = Math.max(0, Math.floor(u - r - 1)), x1 = Math.min(n - 1, Math.ceil(u + r + 1));
    const y0 = Math.max(0, Math.floor(v - r - 1)), y1 = Math.min(n - 1, Math.ceil(v + r + 1));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i + 0.5 - u, j + 0.5 - v) / r;
      if (d >= 1) continue;
      const k = (j * n + i) * 4;
      const add = amount * (1 - d * d) * 255;
      this.data[k] = Math.min(255, this.data[k] + add);
      this.data[k + 3] = 255;
    }
    this.dirty = true;
  }
  update() { if (this.dirty) { this.tex.needsUpdate = true; this.dirty = false; } }
}

const NOISE_GLSL = /* glsl */`
float pp_hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float pp_hash3(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float pp_noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(pp_hash(i),pp_hash(i+vec2(1,0)),u.x), mix(pp_hash(i+vec2(0,1)),pp_hash(i+vec2(1,1)),u.x), u.y); }
float pp_noise3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(pp_hash3(i+vec3(0,0,0)),pp_hash3(i+vec3(1,0,0)),f.x), mix(pp_hash3(i+vec3(0,1,0)),pp_hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(pp_hash3(i+vec3(0,0,1)),pp_hash3(i+vec3(1,0,1)),f.x), mix(pp_hash3(i+vec3(0,1,1)),pp_hash3(i+vec3(1,1,1)),f.x),f.y), f.z); }
float pp_fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*pp_noise(p); p*=2.03; a*=.5; } return s; }
`;

export const TRAMPLE_GLSL = /* glsl */`
uniform sampler2D uTrample;
uniform vec4 uTrampleArea;
float trampleAt(vec2 xz){
  vec2 uv = (xz - uTrampleArea.xy) / (2.0 * uTrampleArea.zw) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uTrample, uv).r;
}
`;

const CANOPY_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec4 uCanopy[4];
uniform float uCanopyStrength;
uniform float uTime;
float canopyShade(vec3 wp){
  float shade = 1.0;
  for(int i=0;i<4;i++){
    vec4 c = uCanopy[i];
    if(c.z <= 0.0) continue;
    // project the point along the sun ray up to the crown height
    float t = max(c.w - wp.y, 0.0) / max(uSunDir.y, 0.15);
    vec2 q = wp.xz + uSunDir.xz * t;
    float r = length(q - c.xy) / c.z;
    if (r > 1.25) continue;
    vec2 sway = vec2(sin(uTime*0.7+q.y*0.3), cos(uTime*0.55+q.x*0.3))*0.06;
    float leaves = pp_fbm((q + sway) * 0.85 + float(i)*7.0);
    float holes = smoothstep(0.32, 0.66, leaves);
    float cover = 1.0 - smoothstep(0.75, 1.2, r);
    shade = min(shade, mix(1.0, holes, cover * uCanopyStrength));
  }
  return shade;
}
`;

/**
 * opts: {vertexAO, srgbVertex, sss, plaid, canopy=true, hair, receiveCanopy}
 */
export function patchMaterial(material, opts = {}) {
  const o = { canopy: true, ...opts };
  material.userData.patch = o;
  // program cache key: option flags + baked constants; custom hooks make the program unique
  const key = JSON.stringify(Object.keys(o).filter((k) => o[k] && typeof o[k] !== 'function' && k !== 'uniforms').sort().map((k) => [k, o[k]]))
    + (o.fragmentHook || o.vertexHook ? '|' + material.uuid : '');
  material.customProgramCacheKey = () => 'pp:' + key;
  const extraUniforms = o.uniforms || {};
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms, extraUniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    // world position varying
    vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vOPos;\n' + (o.plaid ? 'attribute float matId;\nvarying float vMatId;\nvarying vec2 vFab;\n' : ''));
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 wp_ = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
        #endif
        vWPos = (modelMatrix * wp_).xyz; vOPos = position; }
      ${o.plaid ? 'vMatId = matId; vFab = uv;' : ''}`);
    fs = fs.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vOPos;\n' + NOISE_GLSL + CANOPY_GLSL +
      (o.plaid ? 'varying float vMatId;\nvarying vec2 vFab;\n' + PLAID_GLSL : '') + (o.sss ? 'uniform float uSSS;\n' : ''));
    if (o.sss) shader.uniforms.uSSS = { value: typeof o.sss === 'number' ? o.sss : 0.5 };

    if (o.plaid) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        if (vMatId > 0.5 && vMatId < 1.5) {
          diffuseColor.rgb = plaidColor(vFab);
        }`);
      fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (vMatId > 0.5 && vMatId < 1.5) roughnessFactor = 0.86;
        else if (vMatId > 7.5) roughnessFactor = 0.35;`);
    }
    // vertex colors: sRGB -> linear, alpha = baked AO
    if (o.vertexAO) {
      fs = fs.replace('#include <color_fragment>', `
        #if defined( USE_COLOR_ALPHA )
          float bakedAO = vColor.a;
          diffuseColor.rgb *= ${o.srgbVertex === false ? 'vColor.rgb' : 'pow(vColor.rgb, vec3(2.2))'};
        #else
          float bakedAO = 1.0;
        #endif`);
      fs = fs.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float ao_ = mix(1.0, bakedAO, ${Number(o.aoStrength ?? 1).toFixed(3)});
          reflectedLight.indirectDiffuse *= ao_;
          reflectedLight.indirectSpecular *= ao_ * ao_;
          reflectedLight.directDiffuse *= mix(1.0, ao_, 0.35);
          reflectedLight.directSpecular *= ao_; }`);
    }
    if (o.skin) {
      // pores / fine bumps & slight specular breakup
      fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float n1 = pp_noise3(vOPos * 2200.0), n2 = pp_noise3(vOPos * 700.0 + 3.1);
          vec3 bump = vec3(n1 - 0.5, n2 - 0.5, (n1 + n2) * 0.5 - 0.5);
          normal = normalize(normal + bump * ${Number(o.poreStrength ?? 0.1).toFixed(3)}); }`);
      fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (pp_noise3(vOPos * 900.0) - 0.5) * 0.18, 0.25, 1.0);`);
    }
    if (o.hairEdge) {
      fs = fs.replace('#include <alphatest_fragment>', `
        { float strand = pp_noise3(vOPos * vec3(2600.0, 700.0, 2600.0)) * 0.7 + pp_noise3(vOPos * 600.0) * 0.3;
          if (bakedAO < strand * 0.85 + 0.12) discard; bakedAO = 1.0; }`);
    }
    if (o.hair) {
      fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float s1 = pp_noise3(vOPos * vec3(5200.0, 900.0, 5200.0));
          float s2 = pp_noise3(vOPos * vec3(2600.0, 600.0, 2600.0) + 9.0);
          normal = normalize(normal + vec3(s1 - 0.5, 0.0, s2 - 0.5) * 0.9);
          diffuseColor.rgb *= 0.82 + 0.3 * s1; }`);
    }
    if (o.sss) {
      fs = fs.replace('#include <lights_physical_pars_fragment>', ShaderChunkPatched());
    }
    if (o.canopy) {
      fs = fs.replace('getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= canopyShade(vWPos);');
    }
    if (o.fragmentHook) fs = o.fragmentHook(fs);
    if (o.vertexHook) vs = o.vertexHook(vs);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    material.userData.shader = shader;
  };
  return material;
}

function ShaderChunkPatched() {
  return THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'vec3 irradiance = dotNL * directLight.color;',
    `float wrapNL_ = saturate((dot(geometryNormal, directLight.direction) + 0.45) / 1.45);
     vec3 irradiance = mix(vec3(dotNL), wrapNL_ * vec3(1.0, 0.62, 0.52) + dotNL * vec3(0.0, 0.38, 0.48), uSSS) * directLight.color;`);
}

// Blue / teal / navy plaid inspired by the reference shirt.
const PLAID_GLSL = /* glsl */`
vec3 plaidStripe(float x){
  // repeat of ~6.5cm
  float t = fract(x / 0.065);
  vec3 blue  = vec3(0.090, 0.200, 0.560);
  vec3 navy  = vec3(0.030, 0.055, 0.200);
  vec3 teal  = vec3(0.060, 0.420, 0.390);
  vec3 green = vec3(0.040, 0.260, 0.190);
  vec3 red   = vec3(0.420, 0.060, 0.080);
  vec3 light = vec3(0.420, 0.520, 0.700);
  vec3 c = blue;
  c = mix(c, navy,  step(0.00, t) * (1.0 - step(0.16, t)));
  c = mix(c, teal,  step(0.16, t) * (1.0 - step(0.30, t)));
  c = mix(c, green, step(0.30, t) * (1.0 - step(0.34, t)));
  c = mix(c, navy,  step(0.52, t) * (1.0 - step(0.58, t)));
  c = mix(c, red,   step(0.66, t) * (1.0 - step(0.675, t)));
  c = mix(c, light, step(0.80, t) * (1.0 - step(0.812, t)));
  c = mix(c, navy,  step(0.90, t) * (1.0 - step(0.93, t)));
  return c;
}
vec3 plaidColor(vec2 uv){
  vec3 warp = plaidStripe(uv.x + 0.013);
  vec3 weft = plaidStripe(uv.y * 1.0 + 0.031);
  // twill: diagonal alternating threads; filtered to avoid aliasing
  float tw = 0.5 + 0.18 * sin((uv.x + uv.y) * 2600.0);
  float fw = fwidth((uv.x + uv.y) * 2600.0);
  tw = mix(tw, 0.5, clamp(fw * 0.6, 0.0, 1.0));
  vec3 c = mix(warp, weft, tw);
  // darker where both stripes are dark, fabric fibre noise
  c *= 0.9 + 0.2 * pp_noise(uv * 900.0);
  return c * 1.1;
}
`;
