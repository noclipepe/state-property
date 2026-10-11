import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
page.on('pageerror', e => console.error(e));
await page.goto('http://localhost:8080/fisherman.html?autostart=skip');
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
const dimensions = await page.evaluate(async () => {
  const THREE = await import('/vendor/three/three.module.js');
  const g = window.__game, box = new THREE.Box3(), part = new THREE.Box3();
  // Physical exterior only; exclude the projected contact shadow and the occupant.
  g.truck.tilt.updateWorldMatrix(true, true);
  g.truck.tilt.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    for (let p=o; p; p=p.parent) if (p === g.grandpa.group) return;
    o.geometry.computeBoundingBox();
    part.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(part);
  });
  const size = box.getSize(new THREE.Vector3());
  return { length:size.x, width:size.z, height:size.y, min:box.min.toArray(), max:box.max.toArray(), camera: g.camera.position.toArray(), fov:g.camera.fov };
});
fs.mkdirSync('check-out/gru', { recursive:true });
fs.writeFileSync('check-out/gru/pickup-measurements.json', JSON.stringify(dimensions,null,2));
await page.screenshot({ path: 'check-out/gru/original-baseline.png' });
console.log(JSON.stringify(dimensions,null,2));
await browser.close();
