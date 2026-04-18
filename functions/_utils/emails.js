// functions/_utils/emails.js
// HTML email templates. Pure functions — no side effects.
//
// Design matches the newsletter template: monochrome editorial, Catalyst logo
// masthead, Apple-style typography. Rendered table-based for Gmail / Apple
// Mail / Outlook compatibility.

const COLORS = {
  pageBg:   "#f5f5f7",
  surface:  "#ffffff",
  ink:      "#1d1d1f",
  inkSoft:  "#424245",
  muted:    "#6e6e73",
  hairline: "#d2d2d7",
  footerBg: "#fafafa",
};

const LOGO_URL = "https://www.catalyst-magazine.com/newsletterlogo.jpg";

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
    .hero-h1 { font-size:32px !important; line-height:1.1 !important; letter-spacing:-0.03em !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  <span style="display:none !important;visibility:hidden;opacity:0;color:transparent;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.pageBg};padding:36px 12px 48px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.surface};border-radius:20px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">

          <!-- Masthead -->
          <tr>
            <td class="px-40" style="padding:24px 40px 20px 40px;text-align:center;background:${COLORS.surface};">
              <a href="${escapeAttr(siteUrl)}" style="text-decoration:none;display:inline-block;background:#ffffff;border-radius:14px;padding:18px 28px;">
                <img src="${escapeAttr(LOGO_URL)}" alt="The Catalyst" width="440" style="width:440px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;background:#ffffff;">
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td class="px-40" style="padding:22px 40px 0 40px;">
              <div style="height:1px;background:${COLORS.hairline};line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Body -->
          <tr><td class="px-40" style="padding:36px 40px 36px 40px;">${body}</td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 40px 40px 40px;background:${COLORS.footerBg};border-top:1px solid ${COLORS.hairline};text-align:center;">
              <div style="margin:0 auto 16px auto;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${COLORS.muted};font-weight:600;">The Catalyst</div>
              <p style="margin:0 0 14px 0;font-size:12px;line-height:1.6;color:${COLORS.muted};">You're receiving this email because you subscribed at <a href="${escapeAttr(siteUrl)}" style="color:${COLORS.inkSoft};text-decoration:underline;">${prettyHost(siteUrl)}</a>.</p>
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

export function welcomeEmail({ name, siteUrl }) {
  return subscribeConfirmEmail({ firstName: name, siteUrl });
}

export function subscribeConfirmEmail({ firstName, siteUrl }) {
  const greeting = firstName
    ? `Welcome, ${escapeHtml(firstName)}.`
    : `Welcome to The Catalyst.`;

  const body = `
    <!-- Hero -->
    <div style="text-align:center;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.28em;color:${COLORS.muted};margin-bottom:16px;text-transform:uppercase;">You're in</div>
      <h1 class="hero-h1" style="margin:0 0 20px 0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:700;font-size:42px;line-height:1.05;color:${COLORS.ink};letter-spacing:-0.035em;">${greeting}</h1>
      <p style="margin:0;font-size:18px;line-height:1.5;color:${COLORS.inkSoft};font-weight:400;">
        You've just joined a community of curious minds who believe science is for everyone.
      </p>
    </div>

    <!-- Inspirational quote -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:40px 0 0 0;">
      <tr>
        <td style="padding:32px 28px;background:#0b0b0d;border-radius:16px;text-align:center;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.45;color:#ffffff;font-style:italic;font-weight:400;letter-spacing:-0.01em;margin-bottom:14px;">
            &ldquo;Somewhere, something incredible is waiting to be known.&rdquo;
          </div>
          <div style="font-size:11px;font-weight:700;letter-spacing:0.28em;color:#a1a1a6;text-transform:uppercase;">Carl Sagan</div>
        </td>
      </tr>
    </table>

    <!-- Mission -->
    <div style="margin:40px 0 0 0;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.22em;color:${COLORS.muted};margin-bottom:12px;text-transform:uppercase;">Our mission</div>
      <p style="margin:0 0 16px 0;font-size:17px;line-height:1.6;color:${COLORS.inkSoft};font-weight:400;">
        The Catalyst is a student-run STEM magazine based in Washington, D.C. We exist to put young scientists behind the byline — reporting on research, policy, and the people shaping the future of science.
      </p>
      <p style="margin:0;font-size:17px;line-height:1.6;color:${COLORS.inkSoft};font-weight:400;">
        Every story is written, edited, and published by students who believe the next generation of thinkers deserves a platform to tell the truth, ask hard questions, and make science feel human again.
      </p>
    </div>

    <!-- Primary CTA -->
    <div style="text-align:center;margin:40px 0 0 0;">
      <a href="${escapeAttr(siteUrl)}/articles.html" style="display:inline-block;background:${COLORS.ink};color:#ffffff;text-decoration:none;padding:16px 38px;border-radius:980px;font-weight:500;font-size:15px;letter-spacing:-0.01em;">Start reading</a>
    </div>

    <!-- Explore the community -->
    <div style="margin:48px 0 0 0;border-top:1px solid ${COLORS.hairline};padding-top:36px;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.22em;color:${COLORS.muted};margin-bottom:20px;text-transform:uppercase;text-align:center;">Explore the community</div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:0 0 14px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLORS.hairline};border-radius:14px;">
              <tr>
                <td style="padding:22px 24px;">
                  <div style="font-size:17px;font-weight:600;color:${COLORS.ink};margin-bottom:4px;letter-spacing:-0.01em;">Read our stories</div>
                  <div style="font-size:14px;line-height:1.55;color:${COLORS.inkSoft};margin-bottom:12px;">Browse the archive — features, investigations, and interviews from our student newsroom.</div>
                  <a href="${escapeAttr(siteUrl)}/articles.html" style="font-size:14px;font-weight:600;color:${COLORS.ink};text-decoration:none;letter-spacing:-0.01em;">Visit the archive &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 14px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLORS.hairline};border-radius:14px;">
              <tr>
                <td style="padding:22px 24px;">
                  <div style="font-size:17px;font-weight:600;color:${COLORS.ink};margin-bottom:4px;letter-spacing:-0.01em;">Join our team</div>
                  <div style="font-size:14px;line-height:1.55;color:${COLORS.inkSoft};margin-bottom:12px;">Pitch a story, edit with us, or design our next cover. We're always looking for new voices.</div>
                  <a href="${escapeAttr(siteUrl)}/collaborate.html" style="font-size:14px;font-weight:600;color:${COLORS.ink};text-decoration:none;letter-spacing:-0.01em;">Collaborate with us &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLORS.hairline};border-radius:14px;">
              <tr>
                <td style="padding:22px 24px;">
                  <div style="font-size:17px;font-weight:600;color:${COLORS.ink};margin-bottom:4px;letter-spacing:-0.01em;">About The Catalyst</div>
                  <div style="font-size:14px;line-height:1.55;color:${COLORS.inkSoft};margin-bottom:12px;">Meet the team, read our editorial standards, and learn how we got here.</div>
                  <a href="${escapeAttr(siteUrl)}/about.html" style="font-size:14px;font-weight:600;color:${COLORS.ink};text-decoration:none;letter-spacing:-0.01em;">Our story &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    <p style="margin:40px 0 0 0;font-size:14px;line-height:1.6;color:${COLORS.muted};text-align:center;">
      Welcome aboard. We can't wait to share what's next.
    </p>
  `;

  return shell({
    title: "Welcome to The Catalyst",
    preheader: "You're in — a welcome note from the student newsroom.",
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
