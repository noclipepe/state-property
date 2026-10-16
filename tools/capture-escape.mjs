// FISH ESCAPE card image for the series menu: the fish mid-hop at the edge of a road, a box truck
// with STATE PROPERTY on it rolling past.
//   node tools/capture-escape.mjs [baseUrl]      -> assets/brand/card-escape.jpg (640x400)
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://localhost:8095/').replace(/\/?$/, '/');
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(BASE + 'escape.html?seed=21&q=high');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.addStyleTag({ content: '#hud,#bars{visibility:hidden}' });
  // the grass row in front of a box-truck lane
  const lane = await page.evaluate(() => {
    const g = __game; g.begin(); g.teleport(1, 0);
    for (let r = 5; r < 400; r++) {
      g.course.update(r);
      const row = g.course.row(r), below = g.course.row(r - 1);
      if (row?.lane?.vehicle === 'truck' && row.part === 0 && below?.type === 'grass' && !below.fence && g.course.open(r - 1, 0)) { g.teleport(r - 1, 0); return r; }
    }
    return null;
  });
  if (lane === null) throw new Error('no truck lane found');
  // wait for a truck to come by just beside the fish, then one hop and freeze at the top of it
  await page.waitForFunction((r) => {
    const g = __game, L = g.course.row(r).lane; g.stall = 0;
    return L.movers.some((m) => Math.abs(g.course.moverX(m, L, g.time) - L.dir * 3.9) < 0.15);
  }, lane, { polling: 16, timeout: 30000 });
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(70);
  await page.evaluate(() => {
    // a closer, lower framing than gameplay so the fish and the truck read at card size
    const g = __game; g.paused = true;
    const f = g.fish.pivot.getWorldPosition(g.camera.position.clone()), back = g.courseRoot.localToWorld(g.fish.pivot.position.clone().add({ x: 0.5, y: 2.3, z: 3.0 }));
    const look = g.courseRoot.localToWorld(g.fish.pivot.position.clone().add({ x: 0, y: 0.25, z: -1.1 }));
    g.camera.position.copy(back); g.camera.lookAt(look.x, look.y, look.z); g.camera.fov = 50; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: 'assets/brand/card-escape.jpg', type: 'jpeg', quality: 86, scale: 'css' });
  console.log('wrote assets/brand/card-escape.jpg');
} finally { await browser.close(); }
