// Handles GET /article/<slug> — slug is the article title in kebab-case.
//
// Responsibilities:
//   1. Look up the article whose slug matches the URL segment.
//   2. Serve the static article.html shell (via next()) so the browser
//      gets the page content.
//   3. Use HTMLRewriter to inject correct OG / Twitter / JSON-LD meta so
//      that link-preview crawlers (which don't run JS) see the right data.
//
// Slug lookup strategy:
//   a) Scan all JSON posts (posts/article<N>.json) for a title whose slug
//      matches — these are numbered articles migrated to Firestore.
//   b) Query Firestore `stories` collection for a published doc where the
//      stored `slug` field matches, OR whose title slugifies to the same
//      value.
//   c) Fall back to serving the bare article.html shell (client JS will
//      redirect to /articles if nothing is found).

import { findArticleBySlug, listAllArticles, titleToSlug, titleToLegacySlug, resolveOgImage, getSiteUrl, getFallbackImage, buildArticleDescription } from "../_utils/article-meta.js";
import { renderArticleSsr } from "../_utils/article-ssr.js";

const SITE_NAME = "The Catalyst Magazine";

// Old Wix addresses whose article was renamed when it moved here, so no
// slug rule can find it. /post/<slug> 301s to /article/<slug> (_redirects),
// then this sends it on to the article as it's named now.
const RENAMED = {
  "the-road-from-academia-to-forensic-applications-of-chemistry": "from-fluorine-to-forensics-the-road-from-academia-to-forensic-chemistry",
  "transition-metals-the-capacity-of-the-d-block-to-color-our-world": "chromatic-chemistry-transition-metals-and-natures-hidden-color-palette",
  "paradoxes-in-science-where-models-go-to-break": "the-fascinating-role-of-paradoxes-in-science",
  "sitting-down-with-the-editor-in-chief-of-science-magazine-to-talk-about-the-future-of-scientific-co": "the-role-of-science-communication-in-todays-discourse",
  "elucidating-the-brain-s-language-circuitry-with-dr-michael-ullman": "the-declarativeprocedural-model-understanding-language-and-memory",
  "reframing-health-as-a-national-security-issue": "from-battling-a-rare-bioweapon-pathogen-to-pioneering-global-health-security",
};

// Old Wix posts that were never moved here (template pages, newsletter
// notes and a few retired pieces). They go to the Articles page rather
// than a dead end, so their links still land somewhere useful.
const RETIRED = new Set([
  "template-product-review", "newsletter-1",
  "stay-informed-and-inspired-with-the-catalyst-newsletter",
  "stay-informed-latest-stem-breakthroughs-and-wellness-tips",
  "empowering-college-students-the-catalyst-newsletter-highlights",
  "unveiling-the-future-the-groundbreaking-new-scientific-innovation-that-s-changing-everything",
  "how-to-manage-your-time-in-stem", "how-to-study-effectively-in-stem",
  "who-will-lead-the-next-generation-of-computer-chips",
  "science-meets-stoicism-how-ancient-wisdom-fuels-modern-stem",
  "can-google-s-ai-diagnose-you-with-a-sneeze-inside-the-future-of-health-acoustic-representations",
  "from-discoveries-to-therapies-the-race-to-cure-epilepsy",
  "designing-a-sustainable-future-with-sun-wind-and-water",
  "the-electric-romance-of-electricity-and-magnetism",
  "urban-forests-growing-green-in-d-c",
]);

const permanent = (location) => new Response(null, {
  status: 301,
  headers: { Location: location, "Cache-Control": "public, max-age=3600, s-maxage=86400" },
});

// Slugs compared without hyphens: Wix wrote "huang-s"/"d-c" where we write
// "huangs"/"dc", and cut long slugs at 100 characters.
const squash = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const onRequestGet = async ({ request, env, params, next }) => {
  const slug = params.slug || "";
  if (!slug) return next();

  // Try direct slug field match first (fast — one Firestore query).
  // Fall back to title-derived slug scan only if needed. Match against the
  // canonical (NFKD-folded) slug AND a legacy form so historic URLs that
  // dropped non-ASCII letters (e.g. "g-del-…" for "Gödel…") still resolve.
  const wanted = slug.toLowerCase();
  if (RENAMED[wanted]) return permanent(`${getSiteUrl(request, env)}/article/${RENAMED[wanted]}`);
  if (RETIRED.has(wanted)) return permanent(`${getSiteUrl(request, env)}/articles`);
  let article = await findArticleBySlug(wanted).catch(() => null);
  // Set when the full list loaded but nothing matched — a real 404, as
  // opposed to Firestore being briefly unreachable (empty list).
  let definitelyMissing = false;
  if (!article) {
    const articles = await listAllArticles().catch(() => []);
    article =
      articles.find((a) => titleToSlug(a.title) === wanted) ||
      articles.find((a) => titleToLegacySlug(a.title) === wanted) ||
      // Prefix fallback: handles truncated slugs that Slack/Twitter clip at
      // ~100 chars (e.g. "from-simple-questions-…-innovato" missing the
      // trailing "-s-journey"). Only kicks in for long-ish URL slugs to
      // avoid matching short slugs to a longer article's prefix. Requires
      // the URL slug to be at least 40 chars to keep this conservative.
      (wanted.length >= 40 ? articles.find((a) => {
        const full = titleToSlug(a.title);
        return full && full.length > wanted.length && full.startsWith(wanted);
      }) : null) ||
      // Same words, different punctuation (old Wix slugs). Long slugs only,
      // so short ones can't match the start of a different article.
      (squash(wanted).length >= 24 ? articles.find((a) => {
        const w = squash(wanted);
        const have = squash(a.slug || titleToSlug(a.title));
        return have && (have === w || (w.length >= 40 && have.startsWith(w)) || (have.length >= 40 && w.startsWith(have)));
      }) : null) ||
      null;
    // listAllArticles caps at 200; past that, an older story could simply
    // be outside the window, so only trust a miss on a complete list.
    definitelyMissing = !article && articles.length > 0 && articles.length < 200;
  }

  const siteUrl = getSiteUrl(request, env);

  // Book reviews moved to their own URL space (/book-review/<slug>) so the
  // category is visible in the URL. Old /article/<slug> links keep working
  // — we 301 them to the canonical book-review URL so SEO + bookmarks
  // converge on the new path.
  if (article && String(article.category || "").toLowerCase() === "book-review") {
    const canonicalSlug = article.slug || titleToSlug(article.title) || slug;
    const target = `${siteUrl}/book-review/${encodeURIComponent(canonicalSlug)}`;
    return new Response(null, {
      status: 301,
      headers: {
        Location: target,
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    });
  }

  // Fetch article.html shell by absolute URL to avoid Cloudflare Pages'
  // automatic 308 redirect that fires when next() resolves article.html.
  const origin = new URL(request.url).origin;
  const origin_response = await fetch(`${origin}/article`);
  if (!origin_response.ok) return origin_response;

  // Unknown slug: keep the shell (the client shows its not-found state) but
  // answer 404 + noindex so Google doesn't index an empty page as a story.
  if (!article) {
    if (!definitelyMissing) return origin_response;
    const notFound = new HTMLRewriter()
      .on('meta[name="robots"]', { element: (el) => el.setAttribute("content", "noindex, follow") })
      .transform(origin_response);
    const h = new Headers(notFound.headers);
    h.set("Content-Type", "text/html; charset=utf-8");
    h.set("Cache-Control", "public, max-age=60, s-maxage=300");
    return new Response(notFound.body, { status: 404, headers: h });
  }

  // Canonical = the article's own slug (from the DB), NOT the URL slug Google
  // crawled. If a bot fetches a truncated/mangled URL like
  // /article/from-simple-questions-to-...-innovato, we must declare the FULL
  // slug as canonical — otherwise Google sees the truncated URL claim itself
  // as canonical and reports "Duplicate, Google chose different canonical
  // than user." Falls back to the URL slug only if we somehow have no title.
  const canonicalSlug = article.slug || titleToSlug(article.title) || slug;
  const canonical = `${siteUrl}/article/${encodeURIComponent(canonicalSlug)}`;

  // If the URL slug doesn't match the canonical, 301 to the canonical URL.
  // This handles truncated slugs (Slack/Twitter cut at ~100 chars), legacy
  // slug variants, and any other non-canonical form so all link equity
  // converges on one URL per article.
  if (canonicalSlug && canonicalSlug !== slug) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: canonical,
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    });
  }
  const title = `${article.title} | ${SITE_NAME}`;
  const description = buildArticleDescription(article, 160);
  const image = resolveOgImage(article.image, siteUrl) || getFallbackImage(siteUrl);
  const author = article.author || SITE_NAME;
  const published = toIsoDate(article.publishedAt || article.date);
  const modified = toIsoDate(article.updatedAt) || published;
  const section = formatCategory(article.category);
  const tags = Array.isArray(article.tags) ? article.tags : [];

  const jsonLd = buildArticleJsonLd({ title: article.title, description, image, author, published, modified, section, tags, canonical, siteUrl });
  const bodyHtml = renderArticleSsr(article, section);

  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(escapeHtml(title)) })
    .on('meta[name="description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute("content", title) })
    .on('meta[property="og:description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[property="og:image"]', { element: (el) => el.setAttribute("content", image) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute("content", canonical) })
    .on('meta[property="og:type"]', { element: (el) => el.setAttribute("content", "article") })
    .on('meta[name="twitter:title"]', { element: (el) => el.setAttribute("content", title) })
    .on('meta[name="twitter:description"]', { element: (el) => el.setAttribute("content", description) })
    .on('meta[name="twitter:image"]', { element: (el) => el.setAttribute("content", image) })
    .on('meta[name="twitter:url"]', { element: (el) => el.setAttribute("content", canonical) })
    .on('meta[property="og:image:alt"]', { element: (el) => el.setAttribute("content", article.title) })
    .on('meta[name="twitter:image:alt"]', { element: (el) => el.setAttribute("content", article.title) })
    .on('meta[property="og:image:width"]', { element: (el) => el.remove() })
    .on('meta[property="og:image:height"]', { element: (el) => el.remove() })
    .on('meta[name="robots"]', { element: (el) => el.setAttribute("content", "index, follow, max-image-preview:large, max-snippet:-1") })
    // The story itself, so crawlers that don't run JS still read it.
    .on("#article-detail", {
      element(el) {
        el.setAttribute("data-ssr", "1");
        el.setInnerContent(bodyHtml, { html: true });
      },
    })
    .on("head", {
      element(el) {
        el.append(`<link rel="canonical" href="${escapeAttr(canonical)}">`, { html: true });
        el.append(`<meta property="og:image:secure_url" content="${escapeAttr(image)}">`, { html: true });
        el.append(`<meta property="og:image:width" content="1200">`, { html: true });
        el.append(`<meta property="og:image:height" content="630">`, { html: true });
        el.append(`<meta property="article:author" content="${escapeAttr(author)}">`, { html: true });
        if (published) {
          el.append(`<meta property="article:published_time" content="${escapeAttr(published)}">`, { html: true });
        }
        if (modified) {
          el.append(`<meta property="article:modified_time" content="${escapeAttr(modified)}">`, { html: true });
        }
        if (section) {
          el.append(`<meta property="article:section" content="${escapeAttr(section)}">`, { html: true });
        }
        for (const tag of tags) {
          el.append(`<meta property="article:tag" content="${escapeAttr(tag)}">`, { html: true });
        }
        el.append(`<meta name="author" content="${escapeAttr(author)}">`, { html: true });
        // Same id js/main.js upserts, so the page ends up with one block.
        el.append(`<script type="application/ld+json" id="catalyst-article-jsonld">${jsonLd}</script>`, { html: true });
        // Embed the article ID so client JS can load without a slug→id lookup.
        el.append(`<meta name="catalyst-article-id" content="${escapeAttr(String(article.id))}">`, { html: true });
      },
    });

  const response = rewriter.transform(origin_response);
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  headers.set("X-Article-Id", String(article.id));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

function truncate(str, max) {
  const s = (str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function toIsoDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d) ? "" : d.toISOString();
}

function formatCategory(cat) {
  if (!cat) return "Feature";
  const map = { feature: "Feature", profile: "Profile", interview: "Interview", "op-ed": "Op-Ed", oped: "Op-Ed", editorial: "Editorial", news: "News" };
  return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

function buildArticleJsonLd({ title, description, image, author, published, modified, section, tags, canonical, siteUrl }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: title,
    description,
    image: [image],
    author: [{ "@type": "Person", name: author }],
    publisher: { "@type": "Organization", "@id": `${siteUrl}/#organization`, name: SITE_NAME, url: `${siteUrl}/`, logo: { "@type": "ImageObject", url: `${siteUrl}/NewLogoShape.png` } },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    url: canonical,
    inLanguage: "en-US",
    articleSection: section,
    isAccessibleForFree: true,
  };
  if (tags && tags.length) data.keywords = tags.join(", ");
  if (published) { data.datePublished = published; data.dateModified = modified || published; }
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
