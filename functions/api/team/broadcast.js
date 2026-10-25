// /api/team/broadcast — team emails from Team & messages.
//
// POST  Any staff member writes one email to everyone on the team, or to some
//       of it: any of the GROUPS below plus people picked by name. It goes
//       out as a single message with every recipient on the To line (so
//       "reply all" reaches them all), from "<Name> via The Catalyst", with
//       Reply-To set to the sender. Formatted body (sanitized here), links and
//       attachments. Recipients also get a bell notification, and a copy is
//       kept in team_broadcasts for the in-Suite archive.
//       Body: { clientId, subject, html, attachments?: [{ filename, contentType?, content: <base64> }],
//               to?: { all: true } | { groups: ["admin", "editor", …], ids: [uid, …] } }  (default: everyone)
//       Recipients are always worked out here from the users collection, so
//       the label on the email ("to the editors and the admins") is true.
// GET   The archive, newest first (staff only): { ok, items: [...] }. An email
//       sent to part of the team is listed only for its sender and the
//       people it went to.
//
// team_broadcasts is only touched here (service account), so it needs no
// client rules. Former members are excluded automatically: they're Readers.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreCreate, firestoreRunQuery, fromFirestoreDoc } from "../../_utils/firebase.js";
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
// Groups a team email can go to (kept in step with AUDIENCE_GROUPS in
// js/dashboard/directory.js).
// "section" is the current edition's section editors (This edition's hub,
// edition_hub/{CURRENT_EDITION}), not the Editor role, which most writers have.
const CURRENT_EDITION = "winter-2027";   // keep in step with js/dashboard/edition-deadlines.js
const GROUPS = {
  admin: { phrase: "the admins", roles: ["admin"] },
  section: { phrase: "the section editors", roles: [] },
  editor: { phrase: "everyone with the Editor role", roles: ["editor"] },
  writer: { phrase: "the writers", roles: ["writer"] },
  social: { phrase: "the social & growth team", roles: ["social_media", "marketing", "newsletter_builder"] },
};

export const onRequestGet = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF);
    if (auth instanceof Response) return auth;
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "team_broadcasts" }],
      orderBy: [{ field: { fieldPath: "sentAt" }, direction: "DESCENDING" }],
      limit: 100,
    }).catch(() => []);
    // Every account of the person asking, so an email to any of them shows.
    const mine = await accountsOf(env, auth.uid);
    const visible = rows.filter((r) => !Array.isArray(r.data.recipientIds) || r.data.senderId === auth.uid
      || r.data.recipientIds.some((id) => mine.has(id))).slice(0, 40);
    const items = visible.map((r) => ({
      id: r.id,
      subject: r.data.subject || "",
      html: r.data.html || "",
      senderId: r.data.senderId || "",
      senderName: r.data.senderName || "",
      senderRole: r.data.senderRole || "",
      attachmentNames: Array.isArray(r.data.attachmentNames) ? r.data.attachmentNames : [],
      recipientCount: r.data.recipientCount || 0,
      audience: r.data.audience || "everyone",
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
      if (existing) return json({ ok: true, deduped: true, id: clientId, recipientCount: fromFirestoreDoc(existing).data.recipientCount || 0 });
    }
    const mine = await firestoreRunQuery(env, {
      from: [{ collectionId: "team_broadcasts" }],
      where: { fieldFilter: { field: { fieldPath: "senderId" }, op: "EQUAL", value: { stringValue: auth.uid } } },
      limit: 50,
    }).catch(() => []);
    const lastMs = Math.max(0, ...mine.map((r) => Date.parse(r.data.sentAt || "") || 0));
    if (Date.now() - lastMs < COOLDOWN_MS) return json({ ok: false, error: "You just emailed the team. Give it a minute before sending another." }, { status: 429 });

    // Who it goes to: everyone, or the chosen groups and people, worked out
    // from the team's accounts (every address on file, de-duplicated).
    const to = body.to && typeof body.to === "object" ? body.to : { all: true };
    const groups = to.all ? [] : (Array.isArray(to.groups) ? to.groups : []).map(String).filter((g) => GROUPS[g]);
    const pickedIds = to.all ? [] : (Array.isArray(to.ids) ? to.ids : []).map(String).filter((x) => /^[A-Za-z0-9_-]{1,128}$/.test(x)).slice(0, 300);
    const everyone = !!to.all || (!groups.length && !pickedIds.length);
    if (!to.all && !groups.length && !pickedIds.length) return badRequest("Pick who the email goes to.");
    const team = await collectTeam(env, everyone ? null : { groups, ids: pickedIds });
    if (!team.emails.length) return badRequest(everyone ? "No one on the team has an email on file." : "None of the people you picked have an email on file.");
    const audience = everyone ? "everyone" : team.label;

    const senderName = auth.name || auth.email || "A teammate";
    const senderRole = ROLE_LABEL[auth.role] || "";
    const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
    const { subject: subj, html: emailHtml } = teamBroadcastEmail({
      senderName, senderRole, subject, bodyHtml: html,
      attachmentNames: attachments.map((a) => a.filename),
      recipientCount: team.people, siteUrl,
      audienceLabel: everyone ? "" : audience,
    });

    // Resend takes up to 50 recipients per message.
    for (let i = 0; i < team.emails.length; i += 50) {
      await sendEmail(env, {
        to: team.emails.slice(i, i + 50),
        subject: subj,
        html: emailHtml,
        text: `${senderName} wrote to ${everyone ? "the team" : audience}:\n\n${text}\n\n— Sent from the Catalyst Editorial Suite. Reply to answer ${senderName}.`,
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
      audience,
      // Only for emails to part of the team: who may see it in the archive.
      ...(everyone ? {} : { recipientIds: team.ids, groups, pickedIds }),
    };
    let id = clientId;
    try {
      const created = await firestoreCreate(env, "team_broadcasts", record, clientId || undefined);
      id = id || (created?.name || "").split("/").pop() || created?.id || "";
    } catch (e) { console.warn("[team/broadcast] archive write failed", e?.message); }

    await createNotifications(env, team.ids.filter((rid) => rid !== auth.uid), {
      type: "message",
      title: everyone ? `${senderName} emailed the team` : `${senderName} emailed ${audience}`,
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

// The team's active staff accounts. With `pick`, only the chosen groups
// (by role) and people (by account id, widened to every account with the
// same name or email, since some people have two), plus a plain-English
// label for who that is.
async function collectTeam(env, pick = null) {
  const rows = [];
  for (const role of STAFF) {
    try {
      const found = await firestoreRunQuery(env, {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: role } } },
        select: { fields: [{ fieldPath: "email" }, { fieldPath: "extraEmails" }, { fieldPath: "status" }, { fieldPath: "name" }] },
        limit: 300,
      });
      for (const r of found) {
        if (String(r.data?.status || "active") === "inactive") continue;
        const email = String(r.data?.email || "").trim().toLowerCase();
        if (!email) continue;
        rows.push({ id: r.id, role, email, name: String(r.data?.name || "").trim(), extra: Array.isArray(r.data?.extraEmails) ? r.data.extraEmails : [] });
      }
    } catch (err) {
      console.warn(`[team/broadcast] ${role} query failed`, err?.message);
    }
  }
  const nameKey = (r) => (r.name || r.email).toLowerCase();
  let chosen = rows;
  let label = "everyone";
  if (pick) {
    const roles = new Set(pick.groups.flatMap((g) => GROUPS[g].roles));
    let sectionIds = new Set(), sectionNames = new Set();
    if (pick.groups.includes("section")) {
      const raw = await firestoreGet(env, `edition_hub/${CURRENT_EDITION}`).catch(() => null);
      const hub = raw ? fromFirestoreDoc(raw).data : null;
      sectionIds = new Set(Array.isArray(hub?.editorUids) ? hub.editorUids : []);
      sectionNames = new Set((Array.isArray(hub?.sections) ? hub.sections : []).map((x) => String(x?.editor?.name || "").trim().toLowerCase()).filter(Boolean));
    }
    const grouped = (r) => roles.has(r.role) || sectionIds.has(r.id) || sectionNames.has(nameKey(r));
    const picked = rows.filter((r) => pick.ids.includes(r.id));
    const names = new Set([...picked, ...rows.filter(grouped)].map(nameKey));
    const emails = new Set(picked.map((r) => r.email));
    chosen = rows.filter((r) => grouped(r) || names.has(nameKey(r)) || emails.has(r.email));
    const inGroup = new Set(rows.filter(grouped).map(nameKey));
    const extra = [...new Map(picked.filter((r) => !inGroup.has(nameKey(r))).map((r) => [nameKey(r), r.name || r.email])).values()];
    const parts = pick.groups.map((g) => GROUPS[g].phrase);
    if (extra.length > 3) parts.push(`${extra.length} more people`); else parts.push(...extra);
    label = parts.length <= 1 ? (parts[0] || "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  }
  const emails = new Set();
  for (const r of chosen) {
    emails.add(r.email);
    for (const e of r.extra) { const x = String(e || "").trim().toLowerCase(); if (x.includes("@")) emails.add(x); }
  }
  return { emails: [...emails], ids: [...new Set(chosen.map((r) => r.id))], people: new Set(chosen.map(nameKey)).size, label };
}

// Every account id that belongs to the same person as `uid` (same name or
// email), so archive visibility follows the person, not one account.
async function accountsOf(env, uid) {
  const out = new Set([uid]);
  try {
    const raw = await firestoreGet(env, `users/${uid}`);
    const me = raw ? fromFirestoreDoc(raw).data : null;
    const name = String(me?.name || "").trim().toLowerCase();
    const email = String(me?.email || "").trim().toLowerCase();
    if (!name && !email) return out;
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "users" }],
      where: { fieldFilter: { field: { fieldPath: name ? "name" : "email" }, op: "EQUAL", value: { stringValue: name ? me.name : me.email } } },
      select: { fields: [{ fieldPath: "name" }] },
      limit: 10,
    }).catch(() => []);
    rows.forEach((r) => out.add(r.id));
  } catch {}
  return out;
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
