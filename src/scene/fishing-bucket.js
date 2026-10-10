import * as THREE from 'three';
import { Bucket } from '../fish/bucket.js';
import { BucketSpill } from '../fish/spill.js';
import { BUCKET_LOCAL } from '../driver/layout.js';

// The same pail in the human perspectives, staged relative to the parked pickup.
export function addFishingBucket(game, { fishScale = 0.65 } = {}) {
  const home = game.truck.sim.home ?? { x:0, z:0, yaw:0 }, up = new THREE.Vector3(0,1,0);
  const position = new THREE.Vector3(...BUCKET_LOCAL).applyAxisAngle(up,home.yaw).add(new THREE.Vector3(home.x,0,home.z));
  game.bucket = new Bucket(game.scene,position,{ fishScale });
  const yaw = home.yaw + Math.atan2(BUCKET_LOCAL[0]+0.44,BUCKET_LOCAL[2]-1.22);
  game.bucket.handle.rotation.y = yaw+0.2;
  game.bucket.school.rotation.y = yaw;
  game.bucketSpill = new BucketSpill(game,{ followCamera:false });

  // Keep grass out of the pail and the small patch where its water lands.
  const landing = position.clone().add(new THREE.Vector3(0,0,2).applyAxisAngle(up,home.yaw));
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), grass = game.world.grass;
  for (let i=0; i<grass.count; i++) {
    grass.getMatrixAt(i,matrix); p.setFromMatrixPosition(matrix);
    if (Math.hypot(p.x-position.x,p.z-position.z)<0.52 || Math.hypot(p.x-landing.x,p.z-landing.z)<0.85) {
      matrix.elements[13]=-2; grass.setMatrixAt(i,matrix);
    }
  }
  grass.instanceMatrix.needsUpdate=true;
}
