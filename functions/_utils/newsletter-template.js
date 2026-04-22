// functions/_utils/newsletter-template.js
// Gmail-safe HTML newsletter template. Monochrome (black / white / grayscale)
// editorial design inspired by apple.com — no green, no colored accents. Uses
// the Catalyst logo in the masthead. Hand-written table-based layout so it
// renders cleanly in Gmail, Apple Mail, Outlook.

import { buildArticleUrl } from "./article-meta.js";

const COLORS = {
  pageBg:   "#f5f5f7", // apple-style soft gray page
  surface:  "#ffffff",
  ink:      "#1d1d1f", // near-black
  inkSoft:  "#424245",
  muted:    "#6e6e73",
  hairline: "#d2d2d7",
  footerBg: "#fafafa",
};

// Served from Cloudflare Pages. We use the .pages.dev host (not the apex
// www.catalyst-magazine.com) because the apex still points at Wix during
// migration and returns HTTP 400 for our root-level image assets. JPEG
// (not WebP) so Outlook on Windows renders correctly.
const LOGO_URL = "https://catalystmagazine.pages.dev/WebLogo.jpg";

export function buildNewsletter({
  subject = "New from The Catalyst",
  preheader = "",
  headline = "New Stories From The Catalyst",
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
    : `<a href="${esc(siteUrl)}/api/unsubscribe?email=${encodeURIComponent(recipientEmail || "")}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a>`;

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

          <!-- Masthead with logo (white panel behind transparent PNG so it
               never shows as a dark box in Gmail/Outlook dark mode) -->
          <tr>
            <td class="px-40" style="padding:24px 40px 20px 40px;text-align:center;background:${COLORS.surface};">
              <a href="${esc(siteUrl)}" style="text-decoration:none;display:inline-block;background:#ffffff;border-radius:14px;padding:18px 28px;">
                <img src="${escAttr(logoUrl)}" alt="The Catalyst" width="440" style="width:440px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;background:#ffffff;">
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px-40" style="padding:10px 40px 0 40px;">
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
              <a href="${esc(siteUrl)}/articles" style="display:inline-block;background:${COLORS.ink};color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:980px;font-weight:500;font-size:15px;letter-spacing:-0.01em;">Read more on Catalyst</a>
            </td>
          </tr>

          <!-- Footer (CAN-SPAM: opt-in reminder, physical address, unsubscribe) -->
          <tr>
            <td style="padding:32px 40px 40px 40px;background:${COLORS.footerBg};border-top:1px solid ${COLORS.hairline};text-align:center;">
              <div style="margin:0 auto 16px auto;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${COLORS.muted};font-weight:600;">The Catalyst</div>
              <p style="margin:0 0 14px 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">This email was sent to you because you opted in to receive communications.</p>
              <p style="margin:0 0 14px 0;font-size:12px;line-height:1.6;color:${COLORS.inkSoft};font-weight:500;">
                The Catalyst Magazine<br>
                2212 Washington Cir NW, Washington, DC 20037
              </p>
              <p style="margin:0 0 12px 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
                ${unsub}
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="${esc(siteUrl)}/privacy.html" style="color:${COLORS.muted};text-decoration:underline;">Privacy Policy</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="${esc(siteUrl)}/contact.html" style="color:${COLORS.muted};text-decoration:underline;">Contact Us</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.muted};">&copy; ${new Date().getFullYear()} The Catalyst Magazine. All rights reserved.</p>
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
  const href = buildArticleUrl(a, siteUrl);
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

// ─── Inbox-optimized "letter" template ───────────────────────────────────────
// Plain single-column, no banner images, text links only, personal greeting.
// Designed to look like a human wrote it — avoids every "Promotions" trigger:
//  • No multi-column layout, no colored buttons, no social icons
//  • Only 3 links per article (title + "read" text link + one CTA at the end)
//  • Personal "Hi [FirstName]" opener signals a 1-to-1 message to Gmail's AI
//  • Ends with a reply invitation — the single strongest Primary-inbox signal

export function buildInboxNewsletter({
  subject = "New from The Catalyst",
  preheader = "",
  headline = "New Stories From The Catalyst",
  intro = "",
  articles = [],
  siteUrl = "https://catalyst-magazine.com",
  unsubscribeUrl = null,
  recipientEmail = null,
  recipientFirstName = null,
}) {
  const greeting = recipientFirstName
    ? `Hi ${esc(recipientFirstName)},`
    : "Hi there,";

  const defaultIntro = intro ||
    `I wanted to share the latest ${articles.length === 1 ? "story" : `${articles.length} stories`} from The Catalyst — our student journalism magazine covering science, policy, and society.`;

  const articleBlocks = articles.map((a, i) => {
    const href = buildArticleUrl(a, siteUrl);
    const title = a.title || "Untitled";
    const excerpt = a.excerpt || a.dek || "";
    const byline = a.author ? `by ${esc(a.author)}` : "";
    const category = (a.category || "Feature").toUpperCase();
    return `
          <tr>
            <td style="padding:0 0 ${i < articles.length - 1 ? "28px" : "0"} 0;">
              <p style="margin:0 0 3px 0;font-size:11px;font-weight:600;letter-spacing:0.15em;color:#6e6e73;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${esc(category)}</p>
              <p style="margin:0 0 5px 0;font-size:18px;font-weight:700;line-height:1.3;color:#1d1d1f;font-family:Georgia,'Times New Roman',serif;">
                <a href="${esc(href)}" style="color:#1d1d1f;text-decoration:none;">${esc(title)}</a>
              </p>
              ${byline ? `<p style="margin:0 0 7px 0;font-size:13px;color:#6e6e73;font-family:Arial,Helvetica,sans-serif;">${byline}</p>` : ""}
              ${excerpt ? `<p style="margin:0 0 9px 0;font-size:15px;line-height:1.6;color:#424245;font-family:Georgia,'Times New Roman',serif;">${esc(excerpt)}</p>` : ""}
              <p style="margin:0;font-size:14px;font-family:Arial,Helvetica,sans-serif;">
                <a href="${esc(href)}" style="color:#0066cc;text-decoration:underline;">Read the full story &rarr;</a>
              </p>
            </td>
          </tr>`;
  }).join(`
          <tr><td style="padding:0;"><div style="height:1px;background:#d2d2d7;margin:0 0 28px 0;font-size:1px;line-height:1px;">&nbsp;</div></td></tr>`);

  const unsub = unsubscribeUrl
    ? `<a href="${esc(unsubscribeUrl)}" style="color:#6e6e73;text-decoration:underline;">unsubscribe</a>`
    : `<a href="${esc(siteUrl)}/api/unsubscribe?email=${encodeURIComponent(recipientEmail || "")}" style="color:#6e6e73;text-decoration:underline;">unsubscribe</a>`;

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
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0;mso-table-rspace:0;}
  img{-ms-interpolation-mode:bicubic;border:0;display:block;}
  body{margin:0!important;padding:0!important;width:100%!important;background:#ffffff;}
  a{color:#0066cc;}
  @media screen and (max-width:600px){
    .wrap{width:100%!important;padding:24px 20px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1d1d1f;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${esc(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:40px 16px 48px 16px;">
        <table role="presentation" class="wrap" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">

          <!-- Wordmark -->
          <tr>
            <td style="padding:0 0 28px 0;border-bottom:2px solid #1d1d1f;margin-bottom:28px;">
              <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#1d1d1f;font-family:Arial,Helvetica,sans-serif;">THE CATALYST</p>
            </td>
          </tr>

          <!-- Greeting + intro -->
          <tr>
            <td style="padding:28px 0 24px 0;">
              <p style="margin:0 0 14px 0;font-size:16px;line-height:1.6;color:#1d1d1f;font-family:Georgia,'Times New Roman',serif;">${greeting}</p>
              <p style="margin:0;font-size:16px;line-height:1.6;color:#424245;font-family:Georgia,'Times New Roman',serif;">${esc(defaultIntro)}</p>
            </td>
          </tr>

          <!-- Article list -->
          <tr>
            <td style="padding:0 0 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${articleBlocks}
              </table>
            </td>
          </tr>

          <!-- Reply invitation -->
          <tr>
            <td style="padding:0 0 32px 0;border-top:1px solid #d2d2d7;padding-top:24px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:#424245;font-family:Georgia,'Times New Roman',serif;">Which story caught your eye? Just hit reply and let me know — I read every response.</p>
              <p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:#424245;font-family:Georgia,'Times New Roman',serif;">Thanks for reading,<br><strong style="color:#1d1d1f;">The Catalyst Team</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 0 0 0;border-top:1px solid #d2d2d7;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#6e6e73;font-family:Arial,Helvetica,sans-serif;">
                You're receiving this because you subscribed at <a href="${esc(siteUrl)}" style="color:#6e6e73;text-decoration:underline;">catalyst-magazine.com</a>.
                &nbsp;·&nbsp; ${unsub}
              </p>
              <p style="margin:8px 0 0 0;font-size:12px;color:#6e6e73;font-family:Arial,Helvetica,sans-serif;">
                The Catalyst Magazine &nbsp;·&nbsp; 2212 Washington Cir NW, Washington, DC 20037
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
