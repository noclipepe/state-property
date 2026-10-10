import * as THREE from 'three';
import { Grandpa } from './grandpa.js';
import { loadPack } from '../util/pack.js';

export async function loadGru(progress) {
  const pack = await loadPack(new URL('../../assets/meshes/gru', import.meta.url).href, progress);
  const gru = new Grandpa(pack, {
    name: 'Gru', plaid: false,
    matFor: { torso:'cloth', armL:'skin', armR:'skin', head:'skin', brows:'hair' },
    iris: ['vec3(0.10,0.13,0.12)', 'vec3(0.29,0.34,0.28)'],
    lidColor: [0.72,0.49,0.40],
    eyeOpen:0.16,
  });
  const cloth = new THREE.MeshStandardMaterial({ color:0x777a7c, roughness:0.97 });
  cloth.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 scarfP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nscarfP=position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 scarfP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float stripe = smoothstep(0.46,0.50,fract(scarfP.y*27.0));
        diffuseColor.rgb *= mix(vec3(0.18,0.20,0.23),vec3(0.91,0.93,0.94),stripe);
        diffuseColor.rgb *= 0.94+0.06*sin(scarfP.x*1600.0)*sin(scarfP.y*1600.0);`);
  };
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.074,0.031,12,36),cloth);
  loop.rotation.x=Math.PI/2; loop.position.set(0,0.005,0.009); loop.scale.set(1.12,1,1.15);
  gru.bones.neck.add(loop);
  for (const [x,y,z,a] of [[0.047,0.088,0.148,-0.14],[-0.028,0.049,0.151,0.10]]) {
    const tail=new THREE.Mesh(new THREE.BoxGeometry(0.074,0.28,0.023,3,12,1),cloth);
    const p=tail.geometry.attributes.position;
    for (let i=0;i<p.count;i++) p.setZ(i,p.getZ(i)+0.009*Math.sin(p.getY(i)*28));
    tail.geometry.computeVertexNormals(); tail.position.set(x,y,z); tail.rotation.z=a;
    tail.castShadow=true; gru.bones.chest.add(tail);
    for (let j=0;j<8;j++) {
      const fringe=new THREE.Mesh(new THREE.CylinderGeometry(0.0015,0.001,0.016,4),cloth);
      fringe.position.set((j-3.5)*0.008,-0.146,0); tail.add(fringe);
    }
  }
  return gru;
}
