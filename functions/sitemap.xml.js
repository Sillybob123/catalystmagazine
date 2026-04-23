// GET /sitemap.xml
// Dynamically built from the committed JSON posts + published Firestore
// stories. Cached at the edge for an hour — fresh enough for new publishes,
// cheap enough to survive Googlebot hitting it regularly.

import { listAllArticles, titleToSlug, SITE_URL, getSiteUrl } from "./_utils/article-meta.js";

const STATIC_PAGES = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/articles", priority: "0.9", changefreq: "daily" },
  { path: "/about", priority: "0.7", changefreq: "monthly" },
  { path: "/collaborate", priority: "0.6", changefreq: "monthly" },
  { path: "/contact", priority: "0.6", changefreq: "monthly" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly" },
];

export const onRequestGet = async ({ request, env }) => {
  const siteUrl = getSiteUrl(request, env) || SITE_URL;
  const today = new Date().toISOString().slice(0, 10);

  const articles = await listAllArticles().catch(() => []);

  const urls = [];

  // Freshest article lastmod doubles as the homepage/articles lastmod
  // so Google re-checks those pages whenever a new article is published.
  const mostRecent = articles
    .map((a) => toIsoDate(a.publishedAt || a.date))
    .filter(Boolean)
    .sort()
    .pop() || today;

  for (const page of STATIC_PAGES) {
    const pageMod = (page.path === "/" || page.path === "/articles") ? mostRecent : today;
    urls.push(
      `<url><loc>${siteUrl}${page.path}</loc><lastmod>${pageMod}</lastmod><changefreq>${page.changefreq}</changefreq><priority>${page.priority}</priority></url>`
    );
  }

  for (const a of articles) {
    const slug = a.slug || titleToSlug(a.title);
    if (!slug) continue;
    const loc = `${siteUrl}/article/${encodeURIComponent(slug)}`;
    const lastmod = toIsoDate(a.publishedAt || a.date) || today;
    const image = a.image ? `<image:image><image:loc>${escapeXml(a.image)}</image:loc><image:title>${escapeXml(a.title)}</image:title></image:image>` : "";
    urls.push(
      `<url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>${image}</url>`
    );
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join("\n")}
</urlset>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Short TTL so a newly published article shows up in the sitemap
      // within minutes even without a manual cache purge.
      "Cache-Control": "public, max-age=60, s-maxage=120",
    },
  });
};

function toIsoDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
