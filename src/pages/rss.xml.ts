import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE, BASE } from '../consts';
import { allEntries } from '../lib/content';

export async function GET(context: APIContext) {
  const entries = await allEntries();

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: new URL(`${BASE}/`, context.site ?? 'https://example.com'),
    items: entries.map((entry) => ({
      title: entry.title,
      description: entry.description,
      pubDate: entry.date,
      link: entry.href,
      categories: entry.tags,
    })),
    customData: `<language>${SITE.lang}</language>`,
  });
}
