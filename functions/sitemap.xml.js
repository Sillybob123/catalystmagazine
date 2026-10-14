// GET /sitemap.xml
// Built from the published Firestore stories, the published editions
// (edition-art/editions.json) and the indexable static pages below. Shadows
// the static sitemap.xml in the repo root, which is only a fallback.
//
// <lastmod> must be a real content date: Google ignores it site-wide once it
// sees it changing on every fetch. Static pages carry the date they last
// changed (bump it when a page is meaningfully rewritten); the home page,
// /articles, /editions and the current edition follow the newest story.

import { listAllArticles, titleToSlug, bylineNames, SITE_URL, getSiteUrl } from "./_utils/article-meta.js";

// lastmod "latest" = date of the newest published story.
const STATIC_PAGES = [
  { path: "/", priority: "1.0", changefreq: "daily", lastmod: "latest" },
  { path: "/articles", priority: "0.9", changefreq: "daily", lastmod: "latest" },
  { path: "/editions", priority: "0.8", changefreq: "monthly", lastmod: "latest" },
  { path: "/book-reviews", priority: "0.8", changefreq: "weekly", lastmod: "latest-review" },
  { path: "/about", priority: "0.7", changefreq: "monthly", lastmod: "2026-10-10" },
  { path: "/collaborate", priority: "0.6", changefreq: "monthly", lastmod: "2026-09-30" },
  { path: "/sponsors", priority: "0.6", changefreq: "monthly", lastmod: "2026-09-25" },
  { path: "/brain-teaser", priority: "0.5", changefreq: "weekly", lastmod: "2026-10-01" },
  { path: "/contact", priority: "0.5", changefreq: "yearly", lastmod: "2026-09-25" },
  { path: "/privacy", priority: "0.3", changefreq: "yearly", lastmod: "2026-09-25" },
  { path: "/terms", priority: "0.3", changefreq: "yearly", lastmod: "2026-09-25" },
];

export const onRequestGet = async ({ request, env }) => {
  const siteUrl = getSiteUrl(request, env) || SITE_URL;
  const today = new Date().toISOString().slice(0, 10);

  const origin = new URL(request.url).origin;
  const [articles, editions] = await Promise.all([
    listAllArticles().catch(() => []),
    loadEditions(origin),
  ]);

  const urls = [];

  // Freshest story date doubles as the lastmod of the pages that list
  // stories, so Google re-checks them whenever something is published.
  const newest = (list) => list
    .map((a) => toIsoDate(a.publishedAt || a.date))
    .filter(Boolean)
    .sort()
    .pop() || "";
  const isReview = (a) => String(a.category || "").toLowerCase() === "book-review";
  const latest = newest(articles.filter((a) => !isReview(a))) || today;
  const latestReview = newest(articles.filter(isReview)) || latest;

  for (const page of STATIC_PAGES) {
    const pageMod = page.lastmod === "latest" ? latest
      : page.lastmod === "latest-review" ? latestReview
      : page.lastmod;
    urls.push(
      `<url><loc>${siteUrl}${page.path}</loc><lastmod>${pageMod}</lastmod><changefreq>${page.changefreq}</changefreq><priority>${page.priority}</priority></url>`
    );
  }

  // Published editions. Upcoming/hidden ones (edition-winter, edition-spring)
  // aren't in editions.json and are noindex, so they stay out.
  for (const ed of editions) {
    if (!ed.page || !ed.page.startsWith("/")) continue;
    const image = ed.cover ? `<image:image><image:loc>${escapeXml(siteUrl + ed.cover)}</image:loc><image:title>${escapeXml(`The Catalyst, ${ed.label}: ${ed.title}`)}</image:title></image:image>` : "";
    urls.push(
      `<url><loc>${escapeXml(siteUrl + ed.page)}</loc><lastmod>${ed.current ? latest : EDITION_PAGES_UPDATED}</lastmod><changefreq>${ed.current ? "weekly" : "yearly"}</changefreq><priority>${ed.current ? "0.8" : "0.6"}</priority>${image}</url>`
    );
  }

  for (const a of articles) {
    const slug = a.slug || titleToSlug(a.title);
    if (!slug) continue;
    // Book reviews live under /book-review/<slug> so the sitemap reflects
    // their new canonical URL space.
    const isBookReview = String(a.category || "").toLowerCase() === "book-review";
    const loc = isBookReview
      ? `${siteUrl}/book-review/${encodeURIComponent(slug)}`
      : `${siteUrl}/article/${encodeURIComponent(slug)}`;
    const lastmod = toIsoDate(a.updatedAt) || toIsoDate(a.publishedAt || a.date) || today;
    const image = a.image ? `<image:image><image:loc>${escapeXml(a.image)}</image:loc><image:title>${escapeXml(a.title)}</image:title></image:image>` : "";
    urls.push(
      `<url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>${image}</url>`
    );
  }

  // Writer pages (/author/<slug>): one per byline with at least one story
  // that isn't a book review, dated by that writer's newest story.
  const writers = new Map();
  for (const a of articles) {
    if (isReview(a)) continue;
    const day = toIsoDate(a.publishedAt || a.date);
    for (const name of bylineNames(a.author)) {
      const slug = titleToSlug(name);
      if (slug && (!writers.has(slug) || day > writers.get(slug))) writers.set(slug, day);
    }
  }
  for (const [slug, day] of writers) {
    urls.push(
      `<url><loc>${escapeXml(`${siteUrl}/author/${slug}`)}</loc><lastmod>${day || latest}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`
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

// When the past-edition pages last changed (they're rebuilt together).
const EDITION_PAGES_UPDATED = "2026-09-30";

async function loadEditions(origin) {
  try {
    const res = await fetch(`${origin}/edition-art/editions.json`);
    if (!res.ok) return [];
    const data = await res.json();
    return Object.values(data || {}).filter((e) => e && typeof e === "object");
  } catch {
    return [];
  }
}

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
