// functions/_utils/newsletter-template.js
// Gmail-safe HTML newsletter template. Monochrome (black / white / grayscale)
// editorial design inspired by apple.com — no green, no colored accents. Uses
// the Catalyst logo in the masthead. Hand-written table-based layout so it
// renders cleanly in Gmail, Apple Mail, Outlook.

const COLORS = {
  pageBg:   "#f5f5f7", // apple-style soft gray page
  surface:  "#ffffff",
  ink:      "#1d1d1f", // near-black
  inkSoft:  "#424245",
  muted:    "#6e6e73",
  hairline: "#d2d2d7",
  footerBg: "#fafafa",
};

const LOGO_URL = "https://catalyst-magazine.com/WebLogo.png";

export function buildNewsletter({
  subject = "New from The Catalyst",
  preheader = "",
  headline = "New stories from The Catalyst",
  intro = "Here is the latest reporting from our team of student writers.",
  articles = [],
  siteUrl = "https://catalyst-magazine.com",
  unsubscribeUrl = null,
  recipientEmail = null,
  logoUrl = LOGO_URL,
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
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; border:0; display:block; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:${COLORS.pageBg}; }
  a { color:${COLORS.ink}; }
  .read-link:hover { color:${COLORS.inkSoft} !important; }
  @media screen and (max-width:620px) {
    .container { width:100% !important; }
    .px-40 { padding-left:24px !important; padding-right:24px !important; }
    .hero-h1 { font-size:32px !important; line-height:1.1 !important; letter-spacing:-0.03em !important; }
    .card-title { font-size:22px !important; }
    .card-img { height:auto !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${esc(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.pageBg};padding:36px 12px 48px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.surface};border-radius:20px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">

          <!-- Masthead with logo -->
          <tr>
            <td class="px-40" style="padding:40px 40px 8px 40px;text-align:center;background:${COLORS.surface};">
              <a href="${esc(siteUrl)}" style="text-decoration:none;display:inline-block;">
                <img src="${escAttr(logoUrl)}" alt="The Catalyst" width="140" style="width:140px;height:auto;display:block;margin:0 auto;border:0;">
              </a>
              <div style="margin-top:18px;font-size:11px;letter-spacing:0.32em;text-transform:uppercase;color:${COLORS.muted};font-weight:600;">The Catalyst Magazine</div>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px-40" style="padding:22px 40px 0 40px;">
              <div style="height:1px;background:${COLORS.hairline};line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td class="px-40" style="padding:36px 40px 8px 40px;text-align:center;">
              <h1 class="hero-h1" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:700;font-size:40px;line-height:1.08;color:${COLORS.ink};letter-spacing:-0.035em;">${esc(headline)}</h1>
            </td>
          </tr>
          <tr>
            <td class="px-40" style="padding:16px 40px 32px 40px;text-align:center;">
              <p style="margin:0;font-size:16px;line-height:1.55;color:${COLORS.inkSoft};font-weight:400;">${esc(intro)}</p>
            </td>
          </tr>

          <!-- Articles -->
          <tr>
            <td class="px-40" style="padding:0 40px 24px 40px;">
              ${cardHtml}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="px-40" style="padding:24px 40px 44px 40px;text-align:center;">
              <a href="${esc(siteUrl)}/articles.html" style="display:inline-block;background:${COLORS.ink};color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:980px;font-weight:500;font-size:15px;letter-spacing:-0.01em;">Read more on Catalyst</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 40px 36px 40px;background:${COLORS.footerBg};border-top:1px solid ${COLORS.hairline};text-align:center;">
              <div style="margin:0 auto 14px auto;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${COLORS.muted};font-weight:600;">The Catalyst</div>
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">You're receiving this because you subscribed at <a href="${esc(siteUrl)}" style="color:${COLORS.ink};text-decoration:none;font-weight:500;">catalyst-magazine.com</a>.</p>
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

  // Each article sits inside its own bordered, rounded card so stories are
  // visually distinct. Margin-top on cards after the first creates spacing.
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${isFirst ? "0" : "20px"} 0 0 0;border:1px solid ${COLORS.hairline};border-radius:16px;overflow:hidden;background:${COLORS.surface};">
      ${img ? `
      <tr>
        <td style="padding:0;line-height:0;font-size:0;">
          <a href="${esc(href)}" style="text-decoration:none;display:block;">
            <img class="card-img" src="${escAttr(img)}" alt="${escAttr(title)}" width="520" style="width:100%;height:auto;display:block;border:0;">
          </a>
        </td>
      </tr>` : ""}
      <tr>
        <td style="padding:24px 28px 28px 28px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.22em;color:${COLORS.muted};margin-bottom:10px;text-transform:uppercase;">${esc(category)}</div>
          <a href="${esc(href)}" style="text-decoration:none;color:${COLORS.ink};">
            <div class="card-title" style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:24px;font-weight:600;line-height:1.2;color:${COLORS.ink};margin-bottom:10px;letter-spacing:-0.02em;">${esc(title)}</div>
          </a>
          ${byline ? `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:10px;font-weight:400;">${esc(byline)}</div>` : ""}
          ${excerpt ? `<div style="font-size:15px;line-height:1.6;color:${COLORS.inkSoft};margin-bottom:18px;font-weight:400;">${esc(excerpt)}</div>` : ""}
          <a class="read-link" href="${esc(href)}" style="display:inline-block;background:${COLORS.ink};color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:980px;font-weight:500;font-size:14px;letter-spacing:-0.01em;">Read the story &rarr;</a>
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
