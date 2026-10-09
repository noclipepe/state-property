// Screenshot helper for development: node tools/shot.mjs <url-path> <out.png> [w] [h] [waitMs] [actionsJSON]
// Set MOBILE=1 for phone emulation.
import { chromium } from 'playwright';

const [, , urlPath, out, w = '540', h = '960', wait = '0', actions = '[]'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
// MOBILE=1: phone emulation (touch, coarse pointer, 2x pixels)
const page = process.env.MOBILE
  ? await (await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
  : await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()}`));
await page.goto((process.env.BASE || "http://localhost:8080/") + urlPath);
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }); } catch { logs.push('[shot] timeout waiting for __ready'); }
for (const a of JSON.parse(actions)) {
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(a.eval)));
  if (a.click) await page.mouse.click(a.click[0], a.click[1]);
  if (a.key) await page.keyboard.press(a.key);
  if (a.down) await page.keyboard.down(a.down);
  if (a.up) await page.keyboard.up(a.up);
  if (a.shot) await page.screenshot({ path: a.shot });
}
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log([...new Set(logs)].filter((l) => !/X4122|deprecated|PCFSoftShadowMap/.test(l)).join('\n').slice(0, 6000));
await browser.close();
