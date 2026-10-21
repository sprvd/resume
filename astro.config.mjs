import { defineConfig } from 'astro/config';
import devPdf from './integrations/dev-pdf.mjs';

export default defineConfig({
  site: 'https://sprvd.github.io',
  base: process.env.BASE_PATH ?? '/resume/',
  trailingSlash: 'always',
  integrations: [devPdf()],
});
