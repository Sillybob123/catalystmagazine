// GET /author/<slug> — a writer's page: who they are and every story they've
// published, rendered on the server so search engines read it without
// running JavaScript.
//
// It exists for name searches ("Yair Ben-Dor"): one indexable page that is
// about the person, links to all their stories, and is what each article's
// byline and Person JSON-LD point at. The slug is the byline name in
// kebab-case (titleToSlug). Bio, title and hexagon portrait come from
// team_bios (managed in the Suite under Team bios), falling back to the
// Person entries in /about's JSON-LD.

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

  const html = renderPage({ name, person, portrait: live?.image || "", items, canonical, siteUrl });
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
    return { bio: f.bio?.stringValue || "", role: f.role?.stringValue || "", image: f.image?.stringValue || "", hidden: f.hidden?.booleanValue === true };
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

function renderPage({ name, person, portrait, items, canonical, siteUrl }) {
  const role = person?.jobTitle || "Writer";
  const bio = person?.description || "";
  const first = name.split(/\s+/)[0];
  const n = items.length;
  const countLine = `${n} ${n === 1 ? "story" : "stories"} for The Catalyst`;
  const recent = items.slice(0, 3).map((a) => a.title).join("; ");
  const description = truncate(`${name}, ${role} at The Catalyst Magazine. ${countLine}${recent ? `, including ${recent}` : ""}.`, 160);
  const title = `${name} | ${SITE_NAME}`;
  const portraitUrl = portrait ? (portrait.startsWith("/") ? `${siteUrl}${portrait}` : portrait) : "";
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
        ...(portraitUrl ? { image: portraitUrl } : {}),
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

  // What the hero's facts line says
  const oldest = items[items.length - 1];
  const since = oldest ? new Date(oldest.publishedAt || oldest.date) : null;
  const editions = [...new Map(items.filter((a) => a.edition).map((a) => [a.edition.id, a.edition])).values()];
  const reviews = items.filter((a) => a.category === "book-review");
  const stories = items.filter((a) => a.category !== "book-review");
  const lead = stories[0] || null;
  const rest = stories.slice(1);

  const when = (a) => {
    const iso = a.publishedAt ? new Date(a.publishedAt) : null;
    return a.date ? (iso && !isNaN(iso) ? `<time datetime="${esc(iso.toISOString().slice(0, 10))}">${esc(a.date)}</time>` : esc(a.date)) : "";
  };
  const coBy = (a) => (bylineNames(a.author).length > 1 ? `<span class="au-co">With ${esc(bylineNames(a.author).filter((x) => titleToSlug(x) !== titleToSlug(name)).join(" and "))}</span>` : "");
  const img = (a, w, eager) => {
    const src = a.rawImage ? resizedImageUrl(a.rawImage, w, 80) : "";
    return src ? `<img src="${esc(src)}" alt="" width="${w}" height="${Math.round(w * 2 / 3)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : "";
  };
  const card = (a) => `
          <li class="au-card">
            <a href="${esc(a.url)}">
              <span class="au-card-img">${img(a, 720, false)}</span>
              <span class="au-card-kicker">${esc(categoryLabel(a.category))}${a.edition ? ` <i aria-hidden="true">·</i> ${esc(a.edition.label)}` : ""}</span>
              <span class="au-card-title">${esc(a.title)}</span>
              ${a.deck || a.excerpt ? `<span class="au-card-dek">${esc(truncate(a.deck || a.excerpt, 150))}</span>` : ""}
              <span class="au-card-meta">${when(a)}${coBy(a)}</span>
            </a>
          </li>`;

  const portraitHtml = portrait
    ? `<img src="${esc(portrait)}" alt="Portrait of ${esc(name)}" width="600" height="705" decoding="async" fetchpriority="high">`
    : `<span class="au-initials" aria-hidden="true">${esc(name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;

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
    <meta property="profile:first_name" content="${esc(first)}">
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
        --hair: rgba(15, 23, 42, 0.14); --hair-2: rgba(15, 23, 42, 0.08);
        --sans: 'Poppins', system-ui, -apple-system, sans-serif;
        --serif: 'Source Serif Pro', Georgia, 'Times New Roman', serif;
        --gutter: clamp(18px, 4.5vw, 64px);
        --ease: cubic-bezier(0.22, 1, 0.36, 1);
      }
      body[data-page="author"] { margin: 0; background: var(--paper); color: var(--ink); font: 400 16px/1.6 var(--serif); -webkit-font-smoothing: antialiased; overflow-x: clip; }
      html:has(body[data-page="author"]) { background: var(--paper); }
      body[data-page="author"] main *, body[data-page="author"] main *::before, body[data-page="author"] main *::after { box-sizing: border-box; }
      body[data-page="author"] #site-footer .footer { margin-top: 0; }
      .au-wrap { max-width: 1180px; margin: 0 auto; padding: 0 var(--gutter); }
      .au-kicker { display: inline-flex; align-items: center; gap: 10px; margin: 0; font: 600 12px/1.2 var(--sans); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
      .au-kicker::before { content: ""; width: 22px; height: 1px; background: currentColor; }
      a:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; border-radius: 4px; }

      /* hero: the portrait, then who they are */
      .au-hero { padding: calc(96px + clamp(32px, 6vh, 72px)) 0 clamp(44px, 6vh, 72px); }
      .au-hero-grid { display: grid; grid-template-columns: clamp(200px, 24vw, 300px) minmax(0, 1fr); gap: clamp(28px, 5vw, 72px); align-items: start; }
      .au-portrait { padding-top: 8px; }
      .au-portrait { margin: 0; }
      .au-portrait img { display: block; width: 100%; height: auto; }
      .au-initials { display: grid; place-items: center; width: 92%; aspect-ratio: 1; margin: 4%; clip-path: polygon(50% 2%, 92% 26%, 92% 74%, 50% 98%, 8% 74%, 8% 26%); background: var(--ink); color: var(--paper); font: 600 clamp(40px, 5vw, 64px)/1 var(--sans); }
      .au-hero h1 { margin: 16px 0 0; font: 700 clamp(40px, 5.4vw, 76px)/1.02 var(--sans); letter-spacing: -0.04em; text-wrap: balance; }
      .au-role { margin: 12px 0 0; font: italic 400 clamp(18px, 1.5vw, 21px)/1.4 var(--serif); color: var(--ink-2); }
      .au-bio { margin: 22px 0 0; max-width: 64ch; font: 400 clamp(16.5px, 1.2vw, 18px)/1.7 var(--serif); color: var(--ink-2); }
      .au-facts { display: flex; flex-wrap: wrap; gap: 0; margin: 26px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--hair); }
      .au-facts li { display: grid; gap: 2px; padding: 14px 28px 0 0; margin-right: 28px; border-right: 1px solid var(--hair-2); }
      .au-facts li:last-child { border-right: 0; margin-right: 0; }
      .au-facts b { font: 600 22px/1.1 var(--sans); letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
      .au-facts span { font: 500 12px/1.3 var(--sans); letter-spacing: .04em; color: var(--muted); }
      .au-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
      .au-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 20px; border: 1px solid var(--ink); border-radius: 999px; font: 600 14px/1 var(--sans); color: var(--ink); text-decoration: none; transition: background .2s, color .2s; }
      .au-btn:hover { background: var(--ink); color: var(--paper); }
      .au-btn.is-quiet { border-color: var(--hair); }
      .au-btn.is-quiet:hover { border-color: var(--ink); }

      /* sections */
      .au-sec { padding: clamp(40px, 6vh, 64px) 0 0; }
      .au-sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding-bottom: 14px; margin-bottom: 28px; border-bottom: 1px solid var(--ink); }
      .au-sec-head h2 { margin: 0; font: 600 clamp(22px, 2vw, 28px)/1.15 var(--sans); letter-spacing: -0.02em; }
      .au-sec-head span { font: 500 13px var(--sans); color: var(--muted); }

      /* latest story, large */
      .au-lead a { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 56px); align-items: center; color: var(--ink); text-decoration: none; }
      .au-lead-img { display: block; aspect-ratio: 3 / 2; overflow: hidden; border-radius: 6px; background: var(--paper-3); }
      .au-lead-img img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .8s var(--ease); }
      .au-lead a:hover .au-lead-img img { transform: scale(1.025); }
      .au-lead-kicker, .au-card-kicker { font: 600 11.5px/1.3 var(--sans); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
      .au-lead-kicker i, .au-card-kicker i { font-style: normal; margin: 0 4px; }
      .au-lead-title { display: block; margin: 12px 0 0; font: 700 clamp(26px, 2.8vw, 40px)/1.12 var(--sans); letter-spacing: -0.03em; text-wrap: balance; }
      .au-lead a:hover .au-lead-title { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 5px; }
      .au-lead-dek { display: block; margin: 14px 0 0; font: 400 17px/1.6 var(--serif); color: var(--ink-2); }
      .au-lead-meta, .au-card-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 16px; font: 500 13px/1.4 var(--sans); color: var(--muted); }
      .au-read { display: inline-flex; align-items: center; gap: 6px; margin-top: 20px; font: 600 14px var(--sans); color: var(--ink); }
      .au-co::before { content: "· "; }

      /* the rest */
      .au-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(32px, 4vw, 48px) clamp(20px, 2.4vw, 32px); margin: 0; padding: 0; list-style: none; }
      .au-card a { display: grid; gap: 8px; color: var(--ink); text-decoration: none; }
      .au-card-img { display: block; aspect-ratio: 3 / 2; overflow: hidden; border-radius: 5px; background: var(--paper-3); margin-bottom: 6px; }
      .au-card-img img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .7s var(--ease); }
      .au-card a:hover .au-card-img img { transform: scale(1.03); }
      .au-card-title { font: 600 clamp(17px, 1.35vw, 20px)/1.3 var(--sans); letter-spacing: -0.015em; text-wrap: balance; }
      .au-card a:hover .au-card-title { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 4px; }
      .au-card-dek { font: 400 15px/1.55 var(--serif); color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .au-card-meta { margin-top: 2px; font-size: 12.5px; }
      .au-grid.is-reviews { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .au-grid.is-reviews .au-card-img { aspect-ratio: 3 / 4; }

      .au-end { margin: clamp(56px, 9vh, 96px) 0 clamp(56px, 9vh, 96px); padding: clamp(28px, 4vw, 40px); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 18px; background: var(--paper-2); border-radius: 18px; }
      .au-end p { margin: 0; font: 600 clamp(18px, 1.6vw, 22px)/1.3 var(--sans); letter-spacing: -0.015em; }
      .au-end p span { display: block; margin-top: 4px; font: 400 15px/1.5 var(--serif); letter-spacing: 0; color: var(--ink-2); }

      @media (max-width: 960px) {
        .au-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .au-grid.is-reviews { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .au-lead a { grid-template-columns: minmax(0, 1fr); }
      }
      @media (max-width: 720px) {
        .au-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 20px; }
        .au-portrait { width: min(200px, 56vw); }
        .au-facts li { padding-right: 18px; margin-right: 18px; }
      }
      @media (max-width: 560px) {
        .au-grid { grid-template-columns: minmax(0, 1fr); }
        .au-grid.is-reviews { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (prefers-reduced-motion: reduce) { .au-lead-img img, .au-card-img img, .au-btn { transition: none; } }
    </style>
</head>
<body data-page="author">
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TV2SBHW5"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>

    <div id="site-header"></div>

    <main>
        <section class="au-hero" aria-labelledby="au-name">
            <div class="au-wrap au-hero-grid">
                <figure class="au-portrait">${portraitHtml}</figure>
                <div>
                    <p class="au-kicker">The Catalyst &middot; ${esc(role.split(",")[0])}</p>
                    <h1 id="au-name">${esc(name)}</h1>
                    <p class="au-role">${esc(role)}</p>
                    ${bio ? `<p class="au-bio">${esc(bio)}</p>` : ""}
                    <ul class="au-facts">
                        <li><b>${n}</b><span>${n === 1 ? "Story" : "Stories"}</span></li>
                        ${editions.length ? `<li><b>${editions.length}</b><span>${editions.length === 1 ? "Edition" : "Editions"}</span></li>` : ""}
                        ${since && !isNaN(since) ? `<li><b>${esc(since.toLocaleDateString("en-US", { month: "short", year: "numeric" }))}</b><span>Writing since</span></li>` : ""}
                    </ul>
                    <div class="au-links">
                        ${lead ? `<a class="au-btn" href="#au-stories">Read ${esc(first)}&rsquo;s stories</a>` : ""}
                        <a class="au-btn is-quiet" href="/about#team">Meet the team</a>
                    </div>
                </div>
            </div>
        </section>

        <div class="au-wrap" id="au-stories">
            ${lead ? `
            <section class="au-sec" aria-labelledby="au-latest">
                <div class="au-sec-head"><h2 id="au-latest">Latest story</h2>${lead.edition ? `<span>${esc(lead.edition.label)} Edition</span>` : ""}</div>
                <div class="au-lead">
                    <a href="${esc(lead.url)}">
                        <span class="au-lead-img">${img(lead, 1100, true)}</span>
                        <span>
                            <span class="au-lead-kicker">${esc(categoryLabel(lead.category))}${lead.edition ? ` <i aria-hidden="true">·</i> ${esc(lead.edition.label)}` : ""}</span>
                            <span class="au-lead-title">${esc(lead.title)}</span>
                            ${lead.deck || lead.excerpt ? `<span class="au-lead-dek">${esc(truncate(lead.deck || lead.excerpt, 240))}</span>` : ""}
                            <span class="au-lead-meta">${when(lead)}${coBy(lead)}</span>
                            <span class="au-read">Read the story <span aria-hidden="true">&rarr;</span></span>
                        </span>
                    </a>
                </div>
            </section>` : ""}

            ${rest.length ? `
            <section class="au-sec" aria-labelledby="au-more">
                <div class="au-sec-head"><h2 id="au-more">More by ${esc(first)}</h2><span>${rest.length} ${rest.length === 1 ? "story" : "stories"}, newest first</span></div>
                <ul class="au-grid">${rest.map(card).join("")}
                </ul>
            </section>` : ""}

            ${reviews.length ? `
            <section class="au-sec" aria-labelledby="au-reviews">
                <div class="au-sec-head"><h2 id="au-reviews">Book reviews</h2><span>${reviews.length}</span></div>
                <ul class="au-grid is-reviews">${reviews.map(card).join("")}
                </ul>
            </section>` : ""}

            <aside class="au-end">
                <p>Keep reading The Catalyst<span>Science journalism from students across Washington, D.C.</span></p>
                <div class="au-links" style="margin-top:0">
                    <a class="au-btn" href="/articles">Every story</a>
                    <a class="au-btn is-quiet" href="/editions">The editions</a>
                </div>
            </aside>
        </div>
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
