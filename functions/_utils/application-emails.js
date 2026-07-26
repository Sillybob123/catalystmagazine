// functions/_utils/application-emails.js
// Emails for the "Join the Team" application flow. Two distinct messages:
//
//   1. applicationReceivedEmail — sent immediately on submit. Pure
//      acknowledgement. Deliberately asks for NOTHING, because the old
//      combined email (confirmation + "send us your resume") read as a
//      decision letter to some applicants.
//   2. founderResumeRequestEmail — sent ~1h02m later by the cron dispatcher.
//      Plain-text-feeling note from Aidan and Yair asking for a resume. No
//      masthead, no buttons, no marketing furniture — it should read like a
//      personal email someone typed, because that's what it's imitating.
//
// Pure functions, no side effects.

const COLORS = {
  pageBg: "#f5f5f7",
  surface: "#ffffff",
  ink: "#1d1d1f",
  inkSoft: "#424245",
  muted: "#6e6e73",
  hairline: "#d2d2d7",
  footerBg: "#fafafa",
};

const LOGO_URL = "https://catalystmagazine.pages.dev/WebLogo.jpg";

// --- 1. Immediate acknowledgement -------------------------------------------

export function applicationReceivedEmail({ name, role, siteUrl }) {
  const firstName = firstNameFrom(name);
  const roleLine = role
    ? `<p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;color:${COLORS.inkSoft};">You applied for: <strong style="color:${COLORS.ink};">${escapeHtml(role)}</strong></p>`
    : "";

  const body = `
    <div style="text-align:center;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.28em;color:${COLORS.muted};margin-bottom:16px;text-transform:uppercase;">Application received</div>
      <h1 class="hero-h1" style="margin:0 0 20px 0;font-weight:700;font-size:36px;line-height:1.08;color:${COLORS.ink};letter-spacing:-0.03em;">Thanks, ${escapeHtml(firstName)}.</h1>
      <p style="margin:0;font-size:17px;line-height:1.55;color:${COLORS.inkSoft};">
        We've got your application to join The Catalyst.
      </p>
    </div>

    <div style="margin:36px 0 0 0;border-top:1px solid ${COLORS.hairline};padding-top:28px;">
      ${roleLine}
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;color:${COLORS.inkSoft};">
        This is just a confirmation that your submission came through &mdash; there's nothing you need to do right now.
      </p>
      <p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;color:${COLORS.inkSoft};">
        Our editors read every application ourselves. If there's a fit, one of our co-founders will follow up personally with next steps. That usually happens within a few days.
      </p>
      <p style="margin:0;font-size:16px;line-height:1.65;color:${COLORS.inkSoft};">
        In the meantime, the best way to get a feel for what we do is to read a few of our stories.
      </p>
    </div>

    <div style="text-align:center;margin:32px 0 0 0;">
      <a href="${escapeAttr(siteUrl)}/articles" style="display:inline-block;background:${COLORS.ink};color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:980px;font-weight:500;font-size:15px;letter-spacing:-0.01em;">Read The Catalyst</a>
    </div>

    <p style="margin:36px 0 0 0;font-size:15px;line-height:1.6;color:${COLORS.inkSoft};">
      &mdash; The Catalyst Editorial Team
    </p>
  `;

  return shell({
    title: "We received your application",
    preheader: "Confirming we received your application to join The Catalyst.",
    body,
    siteUrl,
  });
}

export function applicationReceivedText({ name, role, siteUrl }) {
  const firstName = firstNameFrom(name);
  // `null` marks a line to drop; "" is a real blank line and must survive.
  return [
    `Hi ${firstName},`,
    "",
    "We've got your application to join The Catalyst.",
    role ? "" : null,
    role ? `You applied for: ${role}` : null,
    "",
    "This is just a confirmation that your submission came through - there's nothing you need to do right now.",
    "",
    "Our editors read every application ourselves. If there's a fit, one of our co-founders will follow up personally with next steps. That usually happens within a few days.",
    "",
    `In the meantime, the best way to get a feel for what we do is to read a few of our stories: ${siteUrl}/articles`,
    "",
    "- The Catalyst Editorial Team",
  ].filter((l) => l !== null).join("\n");
}

// --- 2. Delayed founder note ------------------------------------------------

// Intentionally sparse markup. A message claiming to be typed by two people
// should not arrive wrapped in a branded template with a hero and a CTA
// button — that's what gives "automated" away.
export function founderResumeRequestEmail({ name, role, siteUrl }) {
  const firstName = firstNameFrom(name);
  const roleClause = role
    ? ` for ${escapeHtml(role)}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Following up on your application</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">Could you send over your resume when you get a chance?</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
        <tr>
          <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.65;color:#1d1d1f;">
            <p style="margin:0 0 16px 0;">Hi ${escapeHtml(firstName)},</p>

            <p style="margin:0 0 16px 0;">Aidan and Yair here &mdash; we co-founded The Catalyst and we read through the applications together.</p>

            <p style="margin:0 0 16px 0;">Yours came in earlier today${roleClause ? ` and we saw you applied${roleClause}` : ""}. Before we take it to the rest of the editorial team, could you reply to this email with your resume or CV attached? A PDF is perfect.</p>

            <p style="margin:0 0 16px 0;">If you have writing samples, a portfolio, or anything you've published, feel free to include those too &mdash; they help, but they're not required. We care more about curiosity than credentials.</p>

            <p style="margin:0 0 16px 0;">Once we have it, we'll get back to you with where things stand. If you have questions in the meantime, just reply here; this goes straight to us.</p>

            <p style="margin:0 0 4px 0;">Thanks,</p>
            <p style="margin:0 0 16px 0;">Aidan &amp; Yair</p>

            <p style="margin:0;padding-top:14px;border-top:1px solid #e5e5e7;font-size:13px;line-height:1.6;color:#6e6e73;">
              Aidan Schurr &amp; Yair Ben-Dor<br>
              Co-Founders, Editors-in-Chief<br>
              <a href="${escapeAttr(siteUrl)}" style="color:#6e6e73;">The Catalyst Magazine</a> &middot; Washington, D.C.
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

export function founderResumeRequestText({ name, role, siteUrl }) {
  const firstName = firstNameFrom(name);
  const roleClause = role ? ` and we saw you applied for ${role}` : "";
  return [
    `Hi ${firstName},`,
    "",
    "Aidan and Yair here - we co-founded The Catalyst and we read through the applications together.",
    "",
    `Yours came in earlier today${roleClause}. Before we take it to the rest of the editorial team, could you reply to this email with your resume or CV attached? A PDF is perfect.`,
    "",
    "If you have writing samples, a portfolio, or anything you've published, feel free to include those too - they help, but they're not required. We care more about curiosity than credentials.",
    "",
    "Once we have it, we'll get back to you with where things stand. If you have questions in the meantime, just reply here; this goes straight to us.",
    "",
    "Thanks,",
    "Aidan & Yair",
    "",
    "Aidan Schurr & Yair Ben-Dor",
    "Co-Founders, Editors-in-Chief",
    `The Catalyst Magazine - Washington, D.C.`,
    siteUrl,
  ].join("\n");
}

// --- shared shell (matches emails.js) ---------------------------------------

function shell({ title, preheader = "", body, siteUrl }) {
  return `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title>
<style>
  body,table,td,a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table,td { mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; border:0; display:block; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background:${COLORS.pageBg}; }
  a { color:${COLORS.ink}; }
  @media screen and (max-width:620px) {
    .container { width:100% !important; }
    .px-40 { padding-left:24px !important; padding-right:24px !important; }
    .hero-h1 { font-size:30px !important; line-height:1.1 !important; letter-spacing:-0.03em !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.pageBg};padding:36px 12px 48px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.surface};border-radius:20px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">

          <tr>
            <td class="px-40" style="padding:24px 40px 20px 40px;text-align:center;background:${COLORS.surface};">
              <a href="${escapeAttr(siteUrl)}" style="text-decoration:none;display:inline-block;background:#ffffff;border-radius:14px;padding:18px 28px;">
                <img src="${escapeAttr(LOGO_URL)}" alt="The Catalyst" width="440" style="width:440px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;background:#ffffff;">
              </a>
            </td>
          </tr>

          <tr>
            <td class="px-40" style="padding:22px 40px 0 40px;">
              <div style="height:1px;background:${COLORS.hairline};line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <tr><td class="px-40" style="padding:36px 40px 36px 40px;">${body}</td></tr>

          <tr>
            <td style="padding:32px 40px 40px 40px;background:${COLORS.footerBg};border-top:1px solid ${COLORS.hairline};text-align:center;">
              <div style="margin:0 auto 16px auto;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${COLORS.muted};font-weight:600;">The Catalyst</div>
              <p style="margin:0 0 14px 0;font-size:12px;line-height:1.6;color:${COLORS.inkSoft};font-weight:500;">
                The Catalyst Magazine<br>
                2212 Washington Cir NW, Washington, DC 20037
              </p>
              <p style="margin:0 0 12px 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">
                <a href="${escapeAttr(siteUrl)}/privacy.html" style="color:${COLORS.muted};text-decoration:underline;">Privacy Policy</a>
                &nbsp;&nbsp;|&nbsp;&nbsp;
                <a href="${escapeAttr(siteUrl)}/contact.html" style="color:${COLORS.muted};text-decoration:underline;">Contact Us</a>
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

function firstNameFrom(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first || "there";
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
