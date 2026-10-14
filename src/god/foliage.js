// Camera cutaway: retain the original trees, positions and shadows. Only fragments
// between the elevated camera and the playable clearing fade out. Ground-level
// views and the environment outside that clearing still show the complete trees.
export function setupFoliageCutaway(trees) {
  const strength={value:0};
  for(const material of new Set([trees.leaves,trees.trunks,trees.branches,trees.cores].map(o=>o.material))){
    const hook=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=shader=>{
      hook(shader);shader.uniforms.uGodCutaway=strength;
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGodWorld;')
        .replace('#include <project_vertex>','#include <project_vertex>\nvGodWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vGodWorld;uniform float uGodCutaway;')
        .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
          if(cameraPosition.y>5. && vGodWorld.y<cameraPosition.y-.1){
            vec3 ray=vGodWorld-cameraPosition;
            float t=-cameraPosition.y/ray.y;
            vec2 groundHit=(cameraPosition+ray*t).xz;
            float mask=1.-smoothstep(.85,1.,length((groundHit-vec2(4.5,6.5))/vec2(14.,7.5)));
            float noise=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
            if(t>1. && noise<uGodCutaway*mask)discard;
          }`);
    };
    material.customProgramCacheKey=()=>key+'-god-cutaway';material.needsUpdate=true;
  }
  return strength;
}
