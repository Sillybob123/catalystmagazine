// Crawlable story index for /articles and /book-reviews.
//
// Both pages build their story lists in the browser (js/articles.js,
// js/book-reviews.js), so their raw HTML has no links to the stories. This
// adds a <noscript> list of every published story — invisible to readers
// with JavaScript, followed by crawlers that don't run it — just before the
// footer. Anything going wrong leaves the page exactly as it was.

import { listAllArticles, buildArticlePath } from "./article-meta.js";

const CACHE_SECONDS = 300;

// Published stories, cached at the edge so the listing pages don't wait on
// Firestore for every visitor.
async function cachedStories(origin, waitUntil) {
  const key = new Request(`${origin}/__story-index-v1`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit.json();
  }
  const stories = (await listAllArticles().catch(() => [])).map((a) => ({
    title: a.title,
    author: a.author,
    date: a.date,
    category: a.category,
    path: buildArticlePath(a),
  }));
  if (cache && stories.length) {
    const res = new Response(JSON.stringify(stories), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
    });
    const put = cache.put(key, res).catch(() => {});
    if (waitUntil) waitUntil(put);
  }
  return stories;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function withStoryIndex(context, { reviews, heading }) {
  const response = await context.next();
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("text/html")) return response;

  let stories = [];
  try {
    const origin = new URL(context.request.url).origin;
    stories = await cachedStories(origin, context.waitUntil?.bind(context));
  } catch {
    return response;
  }
  const isReview = (s) => String(s.category || "").toLowerCase() === "book-review";
  const list = stories.filter((s) => (reviews ? isReview(s) : !isReview(s)) && s.path);
  if (!list.length) return response;

  const items = list
    .map((s) => `<li><a href="${esc(s.path)}">${esc(s.title)}</a>${s.author ? ` by ${esc(s.author)}` : ""}${s.date ? `, ${esc(s.date)}` : ""}</li>`)
    .join("");
  const block = `<noscript><nav aria-label="${esc(heading)}"><h2>${esc(heading)}</h2><ul>${items}</ul></nav></noscript>`;

  const out = new HTMLRewriter()
    .on("#site-footer", { element: (el) => el.before(block, { html: true }) })
    .transform(response);
  const headers = new Headers(out.headers);
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  return new Response(out.body, { status: out.status, headers });
}
