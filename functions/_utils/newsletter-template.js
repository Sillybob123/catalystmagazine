// functions/_utils/newsletter-template.js
// Gmail-safe HTML newsletter template, visually aligned with the Catalyst
// brand (see email_fixed_1.html for the design north star). Hand-written
// table-based layout so it renders cleanly in Gmail, Apple Mail, Outlook.

const COLORS = {
  bg: "#f4f4f4",
  surface: "#ffffff",
  ink: "#111827",
  muted: "#4b5563",
  accent: "#0f766e",
  accentSoft: "#14b8a6",
  hairline: "#e5e7eb",
};

export function buildNewsletter({
  subject = "New from The Catalyst",
  preheader = "",
  headline = "New stories from The Catalyst",
  intro = "Here is the latest reporting from our team of student writers.",
  articles = [],
  siteUrl = "https://catalyst-magazine.com",
  unsubscribeUrl = null,
  recipientEmail = null,
}) {
  const cardHtml = articles.map((a, i) => articleCard(a, siteUrl, i === 0)).join("");
  const unsub = unsubscribeUrl
    ? `<a href="${esc(unsubscribeUrl)}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a>`
    : `<a href="${esc(siteUrl)}/unsubscribe?email=${encodeURIComponent(recipientEmail || "")}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a>`;

  return `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; border:0; display:block; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:${COLORS.bg}; }
  a { color:${COLORS.accent}; }
  @media screen and (max-width:620px) {
    .container { width:100% !important; }
    .px-32 { padding-left:20px !important; padding-right:20px !important; }
    .hero-h1 { font-size:28px !important; line-height:1.2 !important; }
    .card-img { height:auto !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${esc(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.bg};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.surface};border-radius:18px;overflow:hidden;">

          <!-- Masthead -->
          <tr>
            <td class="px-32" style="padding:36px 40px 16px 40px;text-align:center;">
              <div style="font-family:'DM Sans',sans-serif;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;margin-bottom:12px;">The Catalyst Magazine</div>
              <div style="height:2px;background:linear-gradient(90deg,transparent,${COLORS.accentSoft},transparent);margin:0 auto 0 auto;width:80%;"></div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td class="px-32" style="padding:24px 40px 8px 40px;text-align:center;">
              <h1 class="hero-h1" style="margin:0;font-family:'DM Sans',sans-serif;font-weight:900;font-size:34px;line-height:1.15;color:${COLORS.ink};letter-spacing:-0.02em;">${esc(headline)}</h1>
            </td>
          </tr>
          <tr>
            <td class="px-32" style="padding:12px 40px 24px 40px;text-align:center;">
              <p style="margin:0;font-size:15px;line-height:1.7;color:${COLORS.muted};">${esc(intro)}</p>
            </td>
          </tr>

          <!-- Articles -->
          <tr>
            <td class="px-32" style="padding:0 40px 8px 40px;">
              ${cardHtml}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="px-32" style="padding:16px 40px 32px 40px;text-align:center;">
              <a href="${esc(siteUrl)}/articles.html" style="display:inline-block;background:${COLORS.ink};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:14px;letter-spacing:0.02em;">Read more on Catalyst</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 36px 40px;background:#fafafa;border-top:1px solid ${COLORS.hairline};text-align:center;">
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">You're receiving this because you subscribed at <a href="${esc(siteUrl)}" style="color:${COLORS.accent};text-decoration:none;">catalyst-magazine.com</a>.</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.muted};">${unsub} &nbsp;&middot;&nbsp; &copy; ${new Date().getFullYear()} The Catalyst Magazine</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function articleCard(a, siteUrl, isFirst) {
  const href = absoluteUrl(siteUrl, a.url || a.slug || "");
  const img = a.coverImage || a.image || "";
  const category = (a.category || "Feature").toUpperCase();
  const title = a.title || "Untitled";
  const excerpt = a.excerpt || a.dek || "";
  const byline = a.author ? `By ${a.author}` : "";

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${isFirst ? "0" : "16px"} 0 16px 0;border:1px solid ${COLORS.hairline};border-radius:14px;overflow:hidden;background:${COLORS.surface};">
      ${img ? `
      <tr>
        <td>
          <a href="${esc(href)}" style="text-decoration:none;">
            <img class="card-img" src="${escAttr(img)}" alt="${escAttr(title)}" width="520" style="width:100%;height:auto;display:block;border:0;">
          </a>
        </td>
      </tr>` : ""}
      <tr>
        <td style="padding:22px 24px 24px 24px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:${COLORS.accent};margin-bottom:8px;">${esc(category)}</div>
          <a href="${esc(href)}" style="text-decoration:none;color:${COLORS.ink};">
            <div style="font-family:'DM Sans',sans-serif;font-size:20px;font-weight:700;line-height:1.3;color:${COLORS.ink};margin-bottom:10px;">${esc(title)}</div>
          </a>
          ${byline ? `<div style="font-size:12px;color:${COLORS.muted};margin-bottom:10px;">${esc(byline)}</div>` : ""}
          ${excerpt ? `<div style="font-size:14px;line-height:1.65;color:${COLORS.muted};margin-bottom:14px;">${esc(excerpt)}</div>` : ""}
          <a href="${esc(href)}" style="color:${COLORS.accent};font-weight:700;font-size:14px;text-decoration:none;">Read the story &rarr;</a>
        </td>
      </tr>
    </table>`;
}

function absoluteUrl(siteUrl, path) {
  if (!path) return siteUrl;
  if (/^https?:/i.test(path)) return path;
  const cleanBase = siteUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return cleanBase + cleanPath;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escAttr(s) { return esc(s); }
