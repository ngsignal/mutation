// Writes sitemap.xml next to the pre-rendered pages: one URL per `<page>/index.html`, except the
// redirects to a moved page (a `<meta http-equiv="refresh">`, from a route's `redirectTo`).
// Usage: node scripts/sitemap.mjs <browser output folder> <site URL ending with "/">
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [outputDir, siteUrl] = process.argv.slice(2);
if (!outputDir || !siteUrl?.endsWith('/')) {
  console.error('Usage: node scripts/sitemap.mjs <output folder> <site URL ending with "/">');
  process.exit(1);
}

const pages = readdirSync(outputDir, { recursive: true })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => file === 'index.html' || file.endsWith('/index.html'))
  .filter((file) => !readFileSync(join(outputDir, file), 'utf8').includes('http-equiv="refresh"'))
  .map((file) => file.slice(0, -'index.html'.length))
  .sort();

const urls = pages.map((page) => `  <url><loc>${siteUrl}${page}</loc></url>`).join('\n');
writeFileSync(
  join(outputDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
);
console.log(`sitemap.xml: ${pages.length} pages`);
