import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 部署形态：GitHub Pages 项目页 —— https://<user>.github.io/blog/
// 换自定义域名时只改 SITE / 把 BASE_PATH 置空即可，正文里所有链接走 src/consts.ts 的 url()。
const SITE = process.env.SITE ?? 'https://heathacosta259519-dot.github.io';
const BASE = process.env.BASE_PATH ?? '/blog';

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
      wrap: true,
    },
  },
  devToolbar: { enabled: false },
});
