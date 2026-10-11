// Renders the stills used by the public site from the actual games:
//   assets/brand/card-fisherman.jpg (720x450) series-menu card: the fisherman POV start view
//   assets/brand/card-fisherman-gru.jpg (720x450) Gru at his vehicle's window
//   assets/brand/card-driver.jpg    (720x450) series-menu card + driver loading screen: in the cab
//   assets/brand/card-fish.jpg      (720x450) the actual underwater Fish POV opening
//   assets/brand/preview.jpg   (1200x750) outside view: the white pickup, grandpa at the window and
//                              the fisherman, from the fixed ?shot camera (used by the social card)
//   assets/brand/og-image.jpg  (1200x630) the social preview card (dev/og-card.html)
// Needs the dev server on :8080 (npm start). Usage: node tools/capture-previews.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../assets/brand/', import.meta.url));
const SHOT = '-3.3,1.9,4.7,-0.35,1.25,0.9'; // camera + target in truck coordinates (see DriverGame.#shotCam)
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function fishermanCards() {
  const context = await browser.newContext({ viewport: { width: 720, height: 1280 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  for (const skin of ['original', 'gru']) {
    await page.goto(`http://localhost:8080/fisherman.html?skin=${skin}&autostart=skip&q=high`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
    await page.evaluate(() => {
      document.getElementById('hud').style.display = 'none';
      if (__game.skin === 'gru') __game.player.setPose({ x: -0.95, z: 2.65, yaw: -0.37, pitch: -0.24 });
    });
    await page.waitForTimeout(1500);
    const name = skin === 'gru' ? 'card-fisherman-gru.jpg' : 'card-fisherman.jpg';
    await page.screenshot({ path: OUT + name, type: 'jpeg', quality: 82, clip: { x: 0, y: skin === 'gru' ? 300 : 250, width: 720, height: 450 } });
  }
  await context.close();
}
await fishermanCards();
if (process.argv.includes('--fisherman-skins')) {
  await browser.close();
  console.log('Wrote both static Fisherman skin previews.');
  process.exit(0);
}

const game = await browser.newPage({ viewport: { width: 1200, height: 750 } });
await game.goto(`http://localhost:8080/driver.html?shot=${SHOT}&q=high`);
await game.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await game.waitForTimeout(1500); // let the animators settle into the idle pose
await game.screenshot({ path: OUT + 'preview.jpg', type: 'jpeg', quality: 84 });

const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await card.goto('http://localhost:8080/dev/og-card.html');
await card.evaluate(() => document.fonts.ready);
await card.waitForTimeout(300);
await card.screenshot({ path: OUT + 'og-image.jpg', type: 'jpeg', quality: 86 });

// series-menu cards: each game as you see it, interface hidden
const phone = (w, h) => browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true }).then((c) => c.newPage());
const drive = await phone(720, 450);
await drive.goto('http://localhost:8080/driver.html?q=high');
await drive.waitForFunction(() => window.__game?.state === 'choose', null, { timeout: 90000 });
await drive.evaluate(() => { document.getElementById('hud').hidden = true; });
await drive.waitForTimeout(400);
await drive.screenshot({ path: OUT + 'card-driver.jpg', type: 'jpeg', quality: 82 });

// Fish POV: the same underwater opening the player sees, with the interface hidden.
const low = await browser.newPage({ viewport: { width: 1200, height: 750 } });
await low.setViewportSize({ width: 720, height: 450 });
await low.goto('http://localhost:8080/fish.html?shot&q=high');
await low.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await low.click('#view');
await low.waitForTimeout(650);
await low.evaluate(() => { document.getElementById('hud').hidden = true; });
await low.screenshot({ path: OUT + 'card-fish.jpg', type: 'jpeg', quality: 88 });
await browser.close();
console.log('wrote previews, cards and the social card to', OUT);
