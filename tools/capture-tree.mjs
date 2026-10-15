// Witness POV card image for the series menu: the view from the branch, binoculars lowered.
//   node tools/capture-tree.mjs [baseUrl]      -> assets/brand/card-tree.jpg (640x400)
import { chromium } from 'playwright';

const BASE = (process.argv[2] || 'http://localhost:8095/').replace(/\/?$/, '/');
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(BASE + 'tree.html?q=high');
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.click('#btn-enter');
  await page.addStyleTag({ content: '#hud{visibility:hidden}' });
  // a touch more of the argument and less of the lap
  await page.evaluate(() => { const g = __game; g.aimAngles.pitch = g.aimHome.pitch + 0.06; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'assets/brand/card-tree.jpg', type: 'jpeg', quality: 86, scale: 'css' });
  console.log('wrote assets/brand/card-tree.jpg');
} finally { await browser.close(); }
