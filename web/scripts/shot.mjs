// Dev helper: [CLIP='x,y,w,h'] [CLICK='selector'] [HIDE='css'] node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { chromium } from 'playwright';

const [url, out, w = '1280', h = '800', wait = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DSF ?? 1) });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(+wait);
if (process.env.CLICK) { await page.click(process.env.CLICK); await page.waitForTimeout(800); }
if (process.env.HIDE) await page.addStyleTag({ content: process.env.HIDE });
const clip = process.env.CLIP && Object.fromEntries(process.env.CLIP.split(',').map((v, i) => [['x', 'y', 'width', 'height'][i], +v]));
await page.screenshot({ path: out, clip });
await browser.close();
