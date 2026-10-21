// Prints the built pages (dist/) to dist/resume_{en,ru}.pdf through headless Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const base = (process.env.BASE_PATH ?? '/resume/').replace(/\/?$/, '/');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const pages = [
  ['', 'resume_en.pdf'],
  ['ru/', 'resume_ru.pdf'],
];

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith(base)) return res.writeHead(404).end();
  let rel = normalize(decodeURIComponent(pathname.slice(base.length)));
  if (rel.startsWith('..')) return res.writeHead(403).end();
  if (rel === '.' || pathname.endsWith('/')) rel = join(rel, 'index.html');
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const browser = await chromium.launch();
try {
  for (const [route, file] of pages) {
    const page = await browser.newPage();
    const res = await page.goto(`http://127.0.0.1:${port}${base}${route}?noscene`, { waitUntil: 'networkidle' });
    if (!res?.ok()) throw new Error(`failed to load ${route || '/'}: HTTP ${res?.status()}`);
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: join(root, file), preferCSSPageSize: true, printBackground: false });
    console.log(`wrote dist/${file}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
