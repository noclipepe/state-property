import * as THREE from 'three';

// The baked lenses/grille sit inside the hood's SDF surface. Small, solid bolt-ons
// bring them in front of that surface without changing the pickup's silhouette.
export function addTruckFront(truck) {
  const root = new THREE.Group(); root.name = 'pickup-front'; truck.body.add(root);
  const materials = [
    new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.82, metalness:.05 }),
    new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.36, metalness:.45 }),
    new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.24, metalness:.08, emissive:0xc3c0aa, emissiveIntensity:.10 }),
  ];
  const batches = materials.map(() => []), x = truck.dims.frontX;
  const box = (material, color, size, position) => {
    const geo = new THREE.BoxGeometry(...size).toNonIndexed(); geo.translate(...position);
    const rgb = new THREE.Color(color), colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i=0; i<colors.length; i+=3) { colors[i]=rgb.r; colors[i+1]=rgb.g; colors[i+2]=rgb.b; }
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3)); batches[material].push(geo);
  };
  // Dark recess, restrained silver surround and three horizontal grille slats.
  box(0,0x252b2d,[.036,.35,1.89],[x-.073,.902,0]);
  for (const y of [.727,1.077]) box(1,0xa5acad,[.035,.018,1.89],[x-.098,y,0]);
  for (const z of [-.944,.944]) box(1,0xa5acad,[.035,.35,.018],[x-.098,.902,z]);
  for (const y of [.79,.88,.97]) box(1,0x778185,[.035,.022,1.09],[x-.100,y,0]);
  for (const z of [-.37,0,.37]) box(0,0x485154,[.024,.26,.016],[x-.096,.902,z]);
  box(1,0xaeb6b7,[.041,.065,.10],[x-.116,.88,0]);
  for (const s of [-1,1]) {
    // Rectangular sealed-beam headlight and amber parking light; opaque lenses.
    const z=s*.753;
    box(1,0xc2c7c4,[.032,.210,.342],[x-.104,.962,z]);
    box(2,0xf1f0d9,[.024,.168,.300],[x-.132,.962,z]);
    for (let j=-3;j<=3;j++) box(2,0xcbd2c8,[.004,.154,.006],[x-.146,.962,z+j*.036]);
    box(2,0xe7a044,[.022,.056,.30],[x-.126,.802,z]);
  }
  // Keep the original bevelled bumper, adding an impact strip and rubber end caps.
  box(0,0x313637,[.020,.055,1.86],[x-.145,.50,0]);
  for (const s of [-1,1]) box(0,0x34393a,[.19,.19,.066],[x-.047,.50,s*.981]);
  for (let i=0;i<batches.length;i++) {
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position','normal','uv','color']) {
      const size=batches[i][0].attributes[name].itemSize;
      const values=new Float32Array(batches[i].reduce((n,g)=>n+g.attributes[name].array.length,0));
      let offset=0;for (const g of batches[i]) { values.set(g.attributes[name].array,offset);offset+=g.attributes[name].array.length; }
      geometry.setAttribute(name,new THREE.BufferAttribute(values,size));
    }
    geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,materials[i]);mesh.name=['front-recess-and-bumper-trim','front-grille-and-bezels','front-headlights'][i];
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);batches[i].forEach(g=>g.dispose());
  }
  return root;
}
