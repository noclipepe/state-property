// Renders the stills used by the public site from the actual games:
//   assets/brand/card-fisherman.jpg (720x450) series-menu card: the fisherman POV start view
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
const fish = await phone(720, 1280);
await fish.goto('http://localhost:8080/fisherman.html?autostart=skip&q=high');
await fish.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await fish.evaluate(() => { document.getElementById('hud').style.display = 'none'; });
await fish.waitForTimeout(1500);
await fish.screenshot({ path: OUT + 'card-fisherman.jpg', type: 'jpeg', quality: 82, clip: { x: 0, y: 250, width: 720, height: 450 } });
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
