import * as THREE from 'three';
import { makeFish } from '../fish/bucket.js';

// The existing bucket fish, drawn as two instanced meshes (body + animated tail).
// A whole storm therefore costs two draw calls instead of hundreds on a phone.
export function fishBatch(scene,count){
  const original=makeFish(0x526d79);original.root.updateMatrixWorld(true);
  function combine(tail){
    const positions=[],normals=[],colors=[],inverse=original.tail.matrixWorld.clone().invert();
    original.root.traverse(o=>{
      if(!o.isMesh||(o.parent===original.tail)!==tail)return;
      const geometry=o.geometry.clone(),matrix=tail?inverse.clone().multiply(o.matrixWorld):o.matrixWorld;
      geometry.applyMatrix4(matrix);const g=geometry.index?geometry.toNonIndexed():geometry,p=g.attributes.position,n=g.attributes.normal,c=o.material.color;
      for(let i=0;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));normals.push(n.getX(i),n.getY(i),n.getZ(i));colors.push(c.r,c.g,c.b);}
      if(g!==geometry)g.dispose();geometry.dispose();
    });
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:tail?.6:.4,metalness:.2,side:THREE.DoubleSide});
    const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.castShadow=true;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);return mesh;
  }
  const body=combine(false),tails=combine(true),hidden=new THREE.Matrix4().makeScale(0,0,0);
  const fish=Array.from({length:count},()=>{const root=new THREE.Group(),tail=new THREE.Group();tail.position.copy(original.tail.position);root.add(tail);return{root,tail};});
  return {fish,sync(){fish.forEach((f,i)=>{f.root.updateMatrixWorld(true);body.setMatrixAt(i,f.root.visible?f.root.matrixWorld:hidden);tails.setMatrixAt(i,f.root.visible?f.tail.matrixWorld:hidden);});body.instanceMatrix.needsUpdate=true;tails.instanceMatrix.needsUpdate=true;}};
}
