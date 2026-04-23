// Best-effort search-engine notifications fired when a story is published.
//
// 1. IndexNow — push the new URL(s) to participating engines (Bing, Yandex,
//    Seznam, Naver). Google does not honor IndexNow and retired the sitemap
//    /ping endpoint in 2023, so for Google we rely on:
//      - a short-TTL sitemap (so /sitemap.xml reflects the new article in
//        ~60 seconds), plus
//      - a Cloudflare cache purge of /sitemap.xml so crawlers see the update
//        immediately on the next hit.
//
// All calls are best-effort — failures must not block the publish response.

const INDEXNOW_KEY = "910d00e3c612fa66eeee0224b7addff8";
const INDEXNOW_HOST = "www.catalyst-magazine.com";

function absoluteUrl(siteUrl, urlOrPath) {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const path = urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  return `${base}${path}`;
}

// Notify IndexNow-compatible search engines about a newly published / updated URL.
export async function pingIndexNow(siteUrl, urls) {
  const list = (Array.isArray(urls) ? urls : [urls])
    .map((u) => absoluteUrl(siteUrl, u))
    .filter(Boolean);
  if (list.length === 0) return { skipped: true, reason: "no urls" };

  try {
    const res = await fetch("https://api.indexnow.org/IndexNow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: list,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Purge the sitemap (and any extra urls) from the Cloudflare edge cache so
// the next crawler hit bypasses any stale cached copy. Requires:
//   env.CF_ZONE_ID        — the zone that serves catalyst-magazine.com
//   env.CF_API_TOKEN      — token with "Cache Purge" permission on that zone
// Both are optional; when missing we just skip (the 60s sitemap TTL will
// refresh the edge copy quickly anyway).
export async function purgeSitemapCache(env, extraUrls = []) {
  const zoneId = env?.CF_ZONE_ID;
  const token = env?.CF_API_TOKEN;
  if (!zoneId || !token) return { skipped: true, reason: "missing CF_ZONE_ID or CF_API_TOKEN" };

  const files = [
    `https://${INDEXNOW_HOST}/sitemap.xml`,
    `https://${INDEXNOW_HOST}/`,
    `https://${INDEXNOW_HOST}/articles`,
    ...extraUrls,
  ];

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ files }),
      }
    );
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.success !== false, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// One-shot "article just published" notifier. Never throws.
export async function notifyArticlePublished(env, siteUrl, articlePath) {
  const results = {};
  try {
    const articleUrl = absoluteUrl(siteUrl, articlePath);
    const sitemapUrl = absoluteUrl(siteUrl, "/sitemap.xml");
    results.indexNow = await pingIndexNow(siteUrl, [articleUrl, sitemapUrl]);
    results.cachePurge = await purgeSitemapCache(env, [articleUrl]);
  } catch (e) {
    results.error = String(e?.message || e);
  }
  return results;
}
