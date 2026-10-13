// /api/team/broadcast — email the whole team from Team & messages.
//
// POST  Any staff member writes one email to everyone on the team. It goes
//       out as a single message with the whole team on the To line (so
//       "reply all" reaches everyone), from "<Name> via The Catalyst", with
//       Reply-To set to the sender. Formatted body (sanitized here), links and
//       attachments. Everyone also gets a bell notification, and a copy is
//       kept in team_broadcasts for the in-Suite archive.
//       Body: { clientId, subject, html, attachments?: [{ filename, contentType?, content: <base64> }] }
// GET   The archive, newest first (staff only): { ok, items: [...] }.
//
// team_broadcasts is only touched here (service account), so it needs no
// client rules. Former members are excluded automatically: they're Readers.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate, firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { teamBroadcastEmail } from "../../_utils/reminder-emails.js";
import { createNotifications } from "../../_utils/notifications.js";

const STAFF = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
const ROLE_LABEL = { admin: "Admin", editor: "Editor", writer: "Writer", newsletter_builder: "Newsletter", marketing: "Marketing", social_media: "Social media" };
const MAX_SUBJECT = 160;
const MAX_HTML = 100_000;
const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;      // all attachments together
const COOLDOWN_MS = 60 * 1000;           // one team email a minute per person
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|js|vbs|ps1|jar|sh|apk|dmg|app)$/i;

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF);
    if (auth instanceof Response) return auth;
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "team_broadcasts" }],
      orderBy: [{ field: { fieldPath: "sentAt" }, direction: "DESCENDING" }],
      limit: 40,
    }).catch(() => []);
    const items = rows.map((r) => ({
      id: r.id,
      subject: r.data.subject || "",
      html: r.data.html || "",
      senderId: r.data.senderId || "",
      senderName: r.data.senderName || "",
      senderRole: r.data.senderRole || "",
      attachmentNames: Array.isArray(r.data.attachmentNames) ? r.data.attachmentNames : [],
      recipientCount: r.data.recipientCount || 0,
      sentAt: r.data.sentAt || "",
    }));
    return json({ ok: true, items });
  } catch (err) {
    return serverError(err);
  }
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }

    const clientId = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.clientId || "")) ? String(body.clientId) : null;
    const subject = String(body.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_SUBJECT);
    const html = sanitizeHtml(String(body.html || "").slice(0, MAX_HTML));
    const text = htmlToText(html);
    if (!subject) return badRequest("Add a subject.");
    if (!text.trim()) return badRequest("Write a message.");

    // Attachments: count, size, and no executables.
    const files = Array.isArray(body.attachments) ? body.attachments : [];
    if (files.length > MAX_FILES) return badRequest(`Attach up to ${MAX_FILES} files.`);
    let total = 0;
    const attachments = [];
    for (const f of files) {
      const filename = String(f?.filename || "").replace(/[\\/\r\n"]/g, "_").trim().slice(0, 120);
      const content = String(f?.content || "").replace(/^data:[^,]*,/, "");
      if (!filename || !content || !/^[A-Za-z0-9+/=]+$/.test(content)) return badRequest("One of the attachments couldn't be read.");
      if (BLOCKED_EXT.test(filename)) return badRequest(`"${filename}" can't be emailed. Share a link to it instead.`);
      total += Math.floor(content.length * 3 / 4);
      attachments.push({ filename, content });
    }
    if (total > MAX_BYTES) return badRequest("Attachments are over 10 MB together. Share a link for big files.");

    // Double-click / retry guard, then a short per-person cooldown.
    if (clientId) {
      const existing = await firestoreGet(env, `team_broadcasts/${clientId}`).catch(() => null);
      if (existing) return json({ ok: true, deduped: true, id: clientId, recipientCount: existing.recipientCount || 0 });
    }
    const mine = await firestoreRunQuery(env, {
      from: [{ collectionId: "team_broadcasts" }],
      where: { fieldFilter: { field: { fieldPath: "senderId" }, op: "EQUAL", value: { stringValue: auth.uid } } },
      limit: 50,
    }).catch(() => []);
    const lastMs = Math.max(0, ...mine.map((r) => Date.parse(r.data.sentAt || "") || 0));
    if (Date.now() - lastMs < COOLDOWN_MS) return json({ ok: false, error: "You just emailed the team. Give it a minute before sending another." }, { status: 429 });

    // Everyone on the team (every address on file), de-duplicated.
    const team = await collectTeam(env);
    if (!team.emails.length) return badRequest("No one on the team has an email on file.");

    const senderName = auth.name || auth.email || "A teammate";
    const senderRole = ROLE_LABEL[auth.role] || "";
    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const { subject: subj, html: emailHtml } = teamBroadcastEmail({
      senderName, senderRole, subject, bodyHtml: html,
      attachmentNames: attachments.map((a) => a.filename),
      recipientCount: team.people, siteUrl,
    });

    // Resend takes up to 50 recipients per message.
    for (let i = 0; i < team.emails.length; i += 50) {
      await sendEmail(env, {
        to: team.emails.slice(i, i + 50),
        subject: subj,
        html: emailHtml,
        text: `${senderName} wrote to the team:\n\n${text}\n\n— Sent from the Catalyst Editorial Suite. Reply to answer ${senderName}.`,
        replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com",
        fromName: `${senderName} via The Catalyst`,
        attachments,
      });
    }

    const sentAt = new Date().toISOString();
    const record = {
      subject, html, senderId: auth.uid, senderName, senderRole,
      attachmentNames: attachments.map((a) => a.filename),
      recipientCount: team.people, emailCount: team.emails.length, sentAt,
    };
    let id = clientId;
    try {
      const created = await firestoreCreate(env, "team_broadcasts", record, clientId || undefined);
      id = id || (created?.name || "").split("/").pop() || created?.id || "";
    } catch (e) { console.warn("[team/broadcast] archive write failed", e?.message); }

    await createNotifications(env, team.ids, {
      type: "message",
      title: `${senderName} emailed the team`,
      body: subject,
      actorId: auth.uid,
      actorName: senderName,
      actionHash: "#/directory?view=team-emails",
    }, (rid) => `teamemail_${id || sentAt}_${rid}`).catch(() => {});

    return json({ ok: true, id, recipientCount: team.people, emailCount: team.emails.length });
  } catch (err) {
    return serverError(err);
  }
};

// ─── helpers ─────────────────────────────────────────────────────────────────

async function collectTeam(env) {
  const emails = new Set();
  const ids = new Set();
  const people = new Set();
  for (const role of STAFF) {
    let rows = [];
    try {
      rows = await firestoreRunQuery(env, {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: role } } },
        select: { fields: [{ fieldPath: "email" }, { fieldPath: "extraEmails" }, { fieldPath: "status" }, { fieldPath: "name" }] },
        limit: 300,
      });
    } catch (err) {
      console.warn(`[team/broadcast] ${role} query failed`, err?.message);
      continue;
    }
    for (const r of rows) {
      if (String(r.data?.status || "active") === "inactive") continue;
      const primary = String(r.data?.email || "").trim().toLowerCase();
      if (!primary) continue;
      ids.add(r.id);
      people.add(String(r.data?.name || primary).trim().toLowerCase());
      emails.add(primary);
      for (const e of Array.isArray(r.data?.extraEmails) ? r.data.extraEmails : []) {
        const x = String(e || "").trim().toLowerCase();
        if (x.includes("@")) emails.add(x);
      }
    }
  }
  return { emails: [...emails], ids: [...ids], people: people.size };
}

// Keep a small set of formatting tags; every attribute is dropped except a
// link's href, and only http(s) / mailto links survive.
const KEEP = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "div"]);
const STYLE = {
  p: "margin:0 0 12px 0;",
  div: "margin:0;",
  ul: "margin:0 0 12px 0;padding-left:22px;",
  ol: "margin:0 0 12px 0;padding-left:22px;",
  li: "margin:0 0 4px 0;",
  h2: "margin:18px 0 8px 0;font-size:18px;line-height:1.35;color:#1d1d1f;",
  h3: "margin:16px 0 6px 0;font-size:16px;line-height:1.35;color:#1d1d1f;",
  blockquote: "margin:0 0 12px 0;padding:2px 0 2px 14px;border-left:3px solid #d2d2d7;color:#424245;",
  a: "color:#1d4ed8;text-decoration:underline;",
};
export function sanitizeHtml(input) {
  let s = String(input || "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|iframe|object|embed|head|title|meta|link|svg|math|template|noscript|form|textarea|select|button)\b[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<(script|style|iframe|object|embed|meta|link|svg|math|template|noscript|form|input|textarea|select|button)\b[^>]*\/?>/gi, "");
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    const closing = m.startsWith("</");
    if (!KEEP.has(tag)) return tag === "br" ? "<br>" : "";
    if (tag === "br") return "<br>";
    if (closing) return `</${tag}>`;
    if (tag === "a") {
      const hm = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const href = (hm ? (hm[1] ?? hm[2] ?? hm[3] ?? "") : "").replace(/&amp;/g, "&").trim();
      if (!/^(https?:\/\/|mailto:)/i.test(href)) return `<a style="${STYLE.a}">`;
      return `<a href="${href.replace(/&/g, "&amp;").replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E")}" target="_blank" rel="noopener noreferrer" style="${STYLE.a}">`;
    }
    return STYLE[tag] ? `<${tag} style="${STYLE[tag]}">` : `<${tag}>`;
  });
  // Anything left that looks like a tag opener is shown as text.
  s = s.replace(/<(?![a-z/])/gi, "&lt;");
  return s.trim();
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h2|h3|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => (label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label.replace(/<[^>]+>/g, "")} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
