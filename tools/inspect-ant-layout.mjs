import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
  await page.goto('http://localhost:8095/fish.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(() => __game.pause());
  fs.mkdirSync('check-out/ant', { recursive: true });
  console.log(await page.evaluate(async () => {
    const T = await import('/vendor/three/three.module.js'), g = __game;
    return { fisher: g.fisher.pos.toArray(), yaw: g.fisher.yaw,
      feet: ['L', 'R'].map(s => g.truck.root.worldToLocal(g.fisher.B['foot' + s].getWorldPosition(new T.Vector3())).toArray()),
      wheels: g.truck.wheels.map(w => w.pivot.position.toArray()) };
  }));
  await page.evaluate(async () => {
    const T = await import('/vendor/three/three.module.js'), g = __game;
    g.ui.showPause(false); document.getElementById('hud').hidden = true;
    g.camera.position.copy(g.truck.root.localToWorld(new T.Vector3(-4.2, 2.4, 4.8)));
    g.camera.lookAt(g.truck.root.localToWorld(new T.Vector3(0, 0.5, 1)));
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: 'check-out/ant/layout-before.png' });
} finally { await browser.close(); }
