// Dev only: serves /resume_{en,ru}.pdf by printing the live page, so the download button works under `astro dev`.
import { chromium } from 'playwright';

export default function devPdf() {
  let browser;
  let base = '/';
  return {
    name: 'dev-pdf',
    hooks: {
      'astro:config:setup': ({ config }) => {
        base = config.base.replace(/\/?$/, '/');
      },
      'astro:server:setup': ({ server }) => {
        server.middlewares.use(async (req, res, next) => {
          const m = /resume_(en|ru)\.pdf$/.exec(req.url.split('?')[0]);
          if (!m) return next();
          try {
            browser ??= await chromium.launch();
            const root = new URL(server.resolvedUrls.local[0]).origin + base;
            const page = await browser.newPage();
            const nav = await page.goto(`${root}${m[1] === 'ru' ? 'ru/' : ''}?noscene`, { waitUntil: 'networkidle' });
            if (!nav?.ok()) throw new Error(`${page.url()} returned HTTP ${nav?.status()}`);
            await page.evaluate(() => document.fonts.ready);
            const pdf = await page.pdf({ preferCSSPageSize: true });
            await page.close();
            res.setHeader('content-type', 'application/pdf');
            res.end(pdf);
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
        server.httpServer?.on('close', () => browser?.close());
      },
    },
  };
}
