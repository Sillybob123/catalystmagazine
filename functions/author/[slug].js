// GET /author/<slug> — a writer's page: who they are and every story they've
// published, rendered on the server so search engines read it without
// running JavaScript.
//
// It exists for name searches ("Yair Ben-Dor"): one indexable page that is
// about the person, links to all their stories, and is what each article's
// byline and Person JSON-LD point at. The slug is the byline name in
// kebab-case (titleToSlug). Bios come from the Person entries in /about's
// JSON-LD, so the team is described in one place.

import { listAllArticles, titleToSlug, bylineNames, getSiteUrl, resolveOgImage, getFallbackImage } from "../_utils/article-meta.js";
import { resizedImageUrl } from "../_utils/article-ssr.js";

const SITE_NAME = "The Catalyst Magazine";

export const onRequestGet = async ({ request, env, params }) => {
  const slug = String(params.slug || "").toLowerCase();
  const siteUrl = getSiteUrl(request, env);
  const origin = new URL(request.url).origin;

  const [articles, editions, people] = await Promise.all([
    listAllArticles().catch(() => []),
    loadEditions(origin),
    loadPeople(origin),
  ]);

  const stories = articles
    .filter((a) => bylineNames(a.author).some((n) => titleToSlug(n) === slug))
    .sort((x, y) => isoDay(y.publishedAt || y.date).localeCompare(isoDay(x.publishedAt || x.date)));
  if (!stories.length) {
    // Firestore unreachable (empty list) shouldn't look like a missing writer.
    const status = articles.length ? 404 : 503;
    return new Response(notFoundPage(siteUrl), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
  }
  // The canonical form of the slug, so /author/Yair-Ben-Dor and friends converge.
  if (params.slug !== slug) {
    return new Response(null, { status: 301, headers: { Location: `${siteUrl}/author/${slug}`, "Cache-Control": "public, max-age=3600" } });
  }

  const name = bylineNames(stories[0].author).find((n) => titleToSlug(n) === slug);
  // The approved bio (team_bios, updated from the Suite) wins over the
  // About page's structured data, which only changes when the page does.
  const about = people.find((p) => titleToSlug(p.name) === slug) || null;
  const live = await loadLiveBio(slug);
  const person = about || live ? {
    ...(about || {}),
    ...(live?.bio ? { description: live.bio } : {}),
    ...(live?.role ? { jobTitle: live.role } : {}),
  } : null;
  const canonical = `${siteUrl}/author/${slug}`;
  const items = stories.map((a) => ({
    ...a,
    url: `${siteUrl}${a.category === "book-review" ? "/book-review/" : "/article/"}${encodeURIComponent(a.slug || titleToSlug(a.title))}`,
    edition: editionFor(editions, a),
  }));

  const html = renderPage({ name, person, items, canonical, siteUrl });
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=600" },
  });
};

async function loadEditions(origin) {
  try {
    const res = await fetch(`${origin}/edition-art/editions.json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!res.ok) return [];
    return Object.entries((await res.json()) || {}).map(([id, e]) => ({ id, ...e }));
  } catch {
    return [];
  }
}

// team_bios/{slug}: the bio an admin approved (public read).
async function loadLiveBio(slug) {
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/catalystwriters-5ce43/databases/(default)/documents/team_bios/${encodeURIComponent(slug)}`, { cf: { cacheTtl: 120 } });
    if (!res.ok) return null;
    const f = (await res.json()).fields || {};
    return { bio: f.bio?.stringValue || "", role: f.role?.stringValue || "" };
  } catch {
    return null;
  }
}

// Person entries from the About page's JSON-LD (name, jobTitle, description…).
async function loadPeople(origin) {
  try {
    const res = await fetch(`${origin}/about`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) return [];
    const html = await res.text();
    const out = [];
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const data = JSON.parse(m[1]);
        for (const node of data["@graph"] || [data]) if (node && node["@type"] === "Person" && node.name) out.push(node);
      } catch { /* skip a block that doesn't parse */ }
    }
    return out;
  } catch {
    return [];
  }
}

// Same rule as the article page: listed in an edition, else inside its dates.
function editionFor(editions, a) {
  const slug = a.slug || titleToSlug(a.title);
  const bySlug = editions.find((e) => Array.isArray(e.stories) && e.stories.some((x) => x.slug === slug));
  if (bySlug) return bySlug;
  const day = isoDay(a.publishedAt || a.date);
  if (!day) return null;
  return editions.find((e) => e.start && e.end && !e.upcoming && day >= e.start && day < e.end) || null;
}

function isoDay(s) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

function categoryLabel(cat) {
  const map = { feature: "Feature", profile: "Profile", interview: "Interview", "op-ed": "Op-Ed", oped: "Op-Ed", editorial: "Editorial", news: "News", "book-review": "Book review" };
  return map[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : "Feature");
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function jsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function renderPage({ name, person, items, canonical, siteUrl }) {
  const role = person?.jobTitle || "Writer";
  const bio = person?.description || "";
  const n = items.length;
  const countLine = `${n} ${n === 1 ? "story" : "stories"} for The Catalyst`;
  const recent = items.slice(0, 3).map((a) => a.title).join("; ");
  const description = truncate(`${name}, ${role} at The Catalyst Magazine. ${countLine}${recent ? `, including ${recent}` : ""}.`, 160);
  const title = `${name} | ${SITE_NAME}`;
  const image = resolveOgImage(items.find((a) => a.image)?.image, siteUrl) || getFallbackImage(siteUrl);
  const personId = `${canonical}#person`;

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": canonical,
        url: canonical,
        name: title,
        description,
        inLanguage: "en-US",
        isPartOf: { "@type": "WebSite", "@id": `${siteUrl}/#website`, name: SITE_NAME, url: `${siteUrl}/` },
        mainEntity: { "@id": personId },
        ...(items[0]?.publishedAt ? { dateModified: new Date(items[0].publishedAt).toISOString() } : {}),
      },
      {
        "@type": "Person",
        "@id": personId,
        name,
        url: canonical,
        jobTitle: role,
        ...(bio ? { description: bio } : {}),
        ...(person?.alumniOf ? { alumniOf: person.alumniOf } : {}),
        ...(person?.knowsAbout ? { knowsAbout: person.knowsAbout } : {}),
        worksFor: { "@type": "Organization", "@id": `${siteUrl}/#organization`, name: SITE_NAME, url: `${siteUrl}/` },
        ...(person?.["@id"] ? { sameAs: [person["@id"]] } : {}),
      },
      {
        "@type": "ItemList",
        name: `Stories by ${name}`,
        numberOfItems: n,
        itemListElement: items.map((a, i) => ({ "@type": "ListItem", position: i + 1, url: a.url, name: a.title })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${siteUrl}/` },
          { "@type": "ListItem", position: 2, name: "Articles", item: `${siteUrl}/articles` },
          { "@type": "ListItem", position: 3, name, item: canonical },
        ],
      },
    ],
  };

  const cards = items.map((a, i) => {
    const img = a.rawImage ? resizedImageUrl(a.rawImage, 720, 80) : "";
    const iso = a.publishedAt ? new Date(a.publishedAt) : null;
    const when = a.date ? (iso && !isNaN(iso) ? `<time datetime="${esc(iso.toISOString().slice(0, 10))}">${esc(a.date)}</time>` : esc(a.date)) : "";
    const ed = a.edition ? `<a class="au-ed" href="${esc(a.edition.page)}">${esc(a.edition.label)} Edition</a>` : "";
    return `
            <li class="au-story">
                <a class="au-story-link" href="${esc(a.url)}">
                    <span class="au-story-img">${img ? `<img src="${esc(img)}" alt="" width="720" height="480" ${i < 3 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : ""}</span>
                    <span class="au-story-kicker">${esc(categoryLabel(a.category))}</span>
                    <span class="au-story-title">${esc(a.title)}</span>
                    ${a.deck || a.excerpt ? `<span class="au-story-dek">${esc(truncate(a.deck || a.excerpt, 190))}</span>` : ""}
                </a>
                <p class="au-story-meta">By ${esc(a.author)}${when ? ` &middot; ${when}` : ""}${ed ? ` &middot; ${ed}` : ""}</p>
            </li>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Google Tag Manager -->
    <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','GTM-TV2SBHW5');</script>
    <!-- End Google Tag Manager -->
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="author" content="${esc(name)}">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
    <link rel="canonical" href="${esc(canonical)}">
    <meta property="og:type" content="profile">
    <meta property="og:url" content="${esc(canonical)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="${esc(image)}">
    <meta property="og:site_name" content="${SITE_NAME}">
    <meta property="og:locale" content="en_US">
    <meta property="profile:first_name" content="${esc(name.split(" ")[0])}">
    <meta property="profile:last_name" content="${esc(name.split(" ").slice(1).join(" "))}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${esc(image)}">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="manifest" href="/site.webmanifest">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://wsrv.nl" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Source+Serif+Pro:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/styles.css?v=20260925-review">
    <script type="application/ld+json">${jsonLd(ld)}</script>
    <style>
      :root {
        --paper: #f8f7f3; --paper-2: #f1efe8; --paper-3: #e7e4da;
        --ink: #0f172a; --ink-2: #334155; --muted: #5b6678; --faint: #94a3b8;
        --hair: rgba(15, 23, 42, 0.14); --hair-2: rgba(15, 23, 42, 0.07);
        --sans: 'Poppins', system-ui, -apple-system, sans-serif;
        --serif: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
        --gutter: clamp(18px, 4.5vw, 64px);
      }
      body[data-page="author"] { margin: 0; background: var(--paper); color: var(--ink); font: 400 16px/1.6 var(--serif); -webkit-font-smoothing: antialiased; overflow-x: clip; }
      html:has(body[data-page="author"]) { background: var(--paper); }
      body[data-page="author"] main *, body[data-page="author"] main *::before, body[data-page="author"] main *::after { box-sizing: border-box; }
      body[data-page="author"] #site-footer .footer { margin-top: 0; }
      .au-wrap { max-width: 1180px; margin: 0 auto; padding: 0 var(--gutter); }
      .au-hero { padding: calc(96px + clamp(28px, 6vh, 72px)) 0 clamp(32px, 5vh, 56px); border-bottom: 1px solid var(--hair); }
      .au-hero-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: clamp(24px, 5vw, 72px); align-items: end; }
      .au-kicker { display: inline-flex; align-items: center; gap: 10px; margin: 0; font: 600 12px/1.2 var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
      .au-kicker::before { content: ""; width: 22px; height: 1px; background: currentColor; }
      .au-hero h1 { margin: 18px 0 0; font: 700 clamp(42px, 6vw, 88px)/1 var(--sans); letter-spacing: -0.045em; text-wrap: balance; }
      .au-role { margin: 16px 0 0; font: italic 400 clamp(19px, 1.7vw, 24px)/1.35 var(--serif); color: var(--ink-2); }
      .au-bio { margin: 0; font: 400 clamp(16px, 1.2vw, 18px)/1.65 var(--serif); color: var(--ink-2); }
      .au-facts { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 18px 0 0; padding: 0; list-style: none; font: 500 13px/1.4 var(--sans); color: var(--muted); }
      .au-facts b { color: var(--ink); font-weight: 600; }
      .au-facts a { color: var(--ink); text-underline-offset: 3px; }
      .au-list-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: clamp(32px, 5vh, 52px) 0 20px; }
      .au-list-head h2 { margin: 0; font: 600 clamp(22px, 2vw, 28px)/1.2 var(--sans); letter-spacing: -0.02em; }
      .au-list-head span { font: 500 13px var(--sans); color: var(--muted); }
      .au-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(28px, 3vw, 44px) clamp(20px, 2.4vw, 36px); margin: 0; padding: 0 0 clamp(56px, 9vh, 104px); list-style: none; }
      .au-story { display: grid; align-content: start; gap: 8px; min-width: 0; }
      .au-story-link { display: grid; gap: 8px; color: var(--ink); text-decoration: none; border-radius: 6px; }
      .au-story-link:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
      .au-story-img { display: block; aspect-ratio: 3 / 2; overflow: hidden; border-radius: 4px; background: var(--paper-3); }
      .au-story-img img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .6s cubic-bezier(.22,1,.36,1); }
      .au-story-link:hover .au-story-img img { transform: scale(1.03); }
      .au-story-kicker { margin-top: 6px; font: 600 11.5px/1.2 var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
      .au-story-title { font: 600 clamp(18px, 1.45vw, 21px)/1.28 var(--sans); letter-spacing: -0.015em; text-wrap: balance; }
      .au-story-link:hover .au-story-title { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }
      .au-story-dek { font: 400 15.5px/1.55 var(--serif); color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .au-story-meta { margin: 0; font: 500 12.5px/1.5 var(--sans); color: var(--muted); }
      .au-ed { display: inline-block; padding: 10px 0; margin: -10px 0; color: var(--ink-2); text-underline-offset: 3px; }
      .au-ed:hover { color: var(--ink); }
      .au-ed:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 3px; }
      @media (max-width: 960px) { .au-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .au-hero-grid { grid-template-columns: minmax(0, 1fr); align-items: start; } }
      @media (max-width: 600px) { .au-grid { grid-template-columns: minmax(0, 1fr); } }
      @media (prefers-reduced-motion: reduce) { .au-story-img img { transition: none; } }
    </style>
</head>
<body data-page="author">
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TV2SBHW5"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

    <div id="site-header"></div>

    <main>
        <section class="au-hero" aria-labelledby="au-name">
            <div class="au-wrap au-hero-grid">
                <div>
                    <p class="au-kicker">The Catalyst &middot; Writer</p>
                    <h1 id="au-name">${esc(name)}</h1>
                    <p class="au-role">${esc(role)}, The Catalyst Magazine</p>
                    <ul class="au-facts">
                        <li><b>${n}</b> ${n === 1 ? "story" : "stories"}</li>
                        ${items[items.length - 1]?.date ? `<li>Writing since <b>${esc(new Date(items[items.length - 1].publishedAt || items[items.length - 1].date).toLocaleDateString("en-US", { month: "long", year: "numeric" }))}</b></li>` : ""}
                        <li><a href="/about">Meet the team</a></li>
                    </ul>
                </div>
                ${bio ? `<p class="au-bio">${esc(bio)}</p>` : ""}
            </div>
        </section>

        <section class="au-wrap" aria-labelledby="au-stories">
            <div class="au-list-head">
                <h2 id="au-stories">Stories by ${esc(name)}</h2>
                <span>Newest first</span>
            </div>
            <ul class="au-grid">${cards}
            </ul>
        </section>
    </main>

    <div id="site-footer"></div>

    <script defer src="/js/layout.js?v=20261012-popup"></script>
</body>
</html>`;
}

function truncate(str, max) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function notFoundPage(siteUrl) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex, follow"><title>Writer not found | ${SITE_NAME}</title><link rel="stylesheet" href="/css/styles.css?v=20260925-review"></head><body style="margin:0;background:#f8f7f3;color:#0f172a;font-family:Poppins,system-ui,sans-serif"><div id="site-header"></div><main style="max-width:720px;margin:0 auto;padding:160px 24px 120px"><h1>We couldn&rsquo;t find that writer.</h1><p><a href="${siteUrl}/articles" style="color:#0f172a">Browse every story</a></p></main><div id="site-footer"></div><script defer src="/js/layout.js?v=20261012-popup"></script></body></html>`;
}
