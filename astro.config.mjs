import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// On GitHub Pages the deploy workflow sets SITE_URL and BASE_PATH
// automatically from the repository owner/name (see .github/workflows/deploy.yml).
// Locally both are unset, so the site serves from "/".
const site = process.env.SITE_URL || 'http://localhost:4321';
const base = process.env.BASE_PATH || '/';

// The root page (src/pages/index.astro) is a client-side redirect to the
// visitor's language, not real content, so it's excluded from the sitemap.
const rootUrl = new URL(base, site).toString().replace(/\/$/, '');

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  // Fetch same-site pages on hover/tap-start so moving between pages feels instant.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => page.replace(/\/$/, '') !== rootUrl,
    }),
  ],
});
