// functions/_utils/emails.js
// HTML email templates. Pure functions — no side effects.

const BRAND = {
  name: "The Catalyst Magazine",
  tagline: "D.C.'s student STEM magazine",
  primary: "#0f766e",
  accent: "#14b8a6",
  text: "#0f172a",
  muted: "#475569",
  bg: "#f8fafc",
};

function shell({ title, preheader = "", body, siteUrl }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};">
  <span style="display:none;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
        <tr><td style="padding:28px 32px;background:linear-gradient(135deg,${BRAND.primary},${BRAND.accent});color:#fff;">
          <div style="font-size:20px;font-weight:700;">${BRAND.name}</div>
          <div style="font-size:13px;opacity:0.85;">${BRAND.tagline}</div>
        </td></tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr><td style="padding:24px 32px;background:#f1f5f9;font-size:12px;color:${BRAND.muted};text-align:center;">
          You are receiving this email because you subscribed at
          <a href="${siteUrl}" style="color:${BRAND.primary};text-decoration:none;">${prettyHost(siteUrl)}</a>.<br>
          &copy; ${new Date().getFullYear()} The Catalyst Magazine.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function welcomeEmail({ name, siteUrl }) {
  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;">Welcome${name ? `, ${escapeHtml(name)}` : ""}!</h1>
    <p style="margin:0 0 16px 0;line-height:1.6;color:${BRAND.muted};">
      Thanks for joining The Catalyst Magazine. We publish stories by and for young scientists in the D.C. area.
    </p>
    <p style="margin:0 0 16px 0;line-height:1.6;color:${BRAND.muted};">
      You will receive a community newsletter every time we publish a fresh batch of three stories.
    </p>
    <p style="margin:24px 0;">
      <a href="${siteUrl}/articles.html" style="background:${BRAND.primary};color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block;">Read the latest stories</a>
    </p>
  `;
  return shell({
    title: "Welcome to The Catalyst Magazine",
    preheader: "Thanks for subscribing — here is what to expect.",
    body,
    siteUrl,
  });
}

export function subscribeConfirmEmail({ firstName, siteUrl }) {
  const body = `
    <h1 style="margin:0 0 16px 0;font-size:22px;">You're on the list${firstName ? `, ${escapeHtml(firstName)}` : ""}.</h1>
    <p style="margin:0 0 16px 0;line-height:1.6;color:${BRAND.muted};">
      We will send you a short newsletter whenever three new stories go live. No spam, no filler — just the best of student STEM reporting from D.C.
    </p>
    <p style="margin:24px 0;">
      <a href="${siteUrl}/articles.html" style="background:${BRAND.primary};color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block;">Browse the archive</a>
    </p>
  `;
  return shell({
    title: "You're subscribed to The Catalyst",
    preheader: "Newsletter confirmation.",
    body,
    siteUrl,
  });
}

export function newsletterEmail({ articles, siteUrl }) {
  const cards = articles
    .map(
      (a) => `
      <tr><td style="padding:12px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          ${
            a.coverImage
              ? `<tr><td><a href="${absoluteUrl(siteUrl, a.url)}"><img src="${escapeAttr(a.coverImage)}" alt="${escapeAttr(a.title)}" style="width:100%;display:block;border:0;"></a></td></tr>`
              : ""
          }
          <tr><td style="padding:18px 20px;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${BRAND.accent};margin-bottom:6px;">${escapeHtml(a.category || "Feature")}</div>
            <a href="${absoluteUrl(siteUrl, a.url)}" style="color:${BRAND.text};text-decoration:none;">
              <div style="font-size:18px;font-weight:700;margin-bottom:6px;line-height:1.3;">${escapeHtml(a.title)}</div>
            </a>
            <div style="font-size:13px;color:${BRAND.muted};line-height:1.5;margin-bottom:12px;">${escapeHtml(a.excerpt || "")}</div>
            <a href="${absoluteUrl(siteUrl, a.url)}" style="color:${BRAND.primary};font-weight:600;text-decoration:none;font-size:14px;">Read the story &rarr;</a>
          </td></tr>
        </table>
      </td></tr>`
    )
    .join("");

  const body = `
    <h1 style="margin:0 0 8px 0;font-size:22px;">Three new stories, fresh off the press</h1>
    <p style="margin:0 0 24px 0;color:${BRAND.muted};line-height:1.6;">
      Here is the latest reporting from our team of student writers. Tap any card to read the full piece.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
    <p style="margin:32px 0 0 0;color:${BRAND.muted};font-size:13px;line-height:1.6;">
      Enjoying the magazine? Forward this to a friend, or send them to <a href="${siteUrl}" style="color:${BRAND.primary};text-decoration:none;">catalyst-magazine.com</a>.
    </p>
  `;
  return shell({
    title: "New from The Catalyst",
    preheader: `${articles[0]?.title || "Three new stories"} — and two more inside.`,
    body,
    siteUrl,
  });
}

function prettyHost(siteUrl) {
  try {
    return new URL(siteUrl).host;
  } catch {
    return "our website";
  }
}

function absoluteUrl(siteUrl, path) {
  if (!path) return siteUrl;
  if (/^https?:/i.test(path)) return path;
  const cleanBase = siteUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return cleanBase + cleanPath;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s);
}
