// POST /api/bio/request
//
// A staff member sends a new or changed bio for the About page (Suite → their
// name → Update bio). Nothing on the website changes here: the request waits
// in bio_requests/{uid} until an admin approves it (/api/bio/review), and
// every admin gets a bell notification and an email.
//
// Body: { bio }            send (or replace) the request
//       { withdraw: true } take a waiting request back
// Auth: any staff role.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, firestoreRunQuery, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { adminBioRequestEmail } from "../../_utils/reminder-emails.js";
import { createNotifications } from "../../_utils/notifications.js";
import { titleToSlug } from "../../_utils/article-meta.js";

const STAFF = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
const BIO_MIN = 120;   // characters, about two sentences
const BIO_MAX = 1400;  // the longest bios on the About page run ~700

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }

    const path = `bio_requests/${auth.uid}`;
    const now = new Date().toISOString();

    if (body.withdraw) {
      const existing = await firestoreGet(env, path);
      if (!existing || fromFirestoreDoc(existing).data.status !== "pending") return json({ ok: true });
      await firestoreUpdate(env, path, { status: "withdrawn", decidedAt: now });
      return json({ ok: true, status: "withdrawn" });
    }

    const bio = String(body.bio ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (bio.length < BIO_MIN) return badRequest(`Write a little more: at least ${BIO_MIN} characters (about two sentences).`);
    if (bio.length > BIO_MAX) return badRequest(`That's a bit long. Keep it under ${BIO_MAX} characters.`);

    const name = String(auth.name || "").trim();
    const slug = titleToSlug(name);
    if (!name || !slug) return badRequest("Your account has no name yet. Ask an admin to add it in Users & roles.");

    const live = await firestoreGet(env, `team_bios/${slug}`).catch(() => null);
    const currentBio = live ? String(fromFirestoreDoc(live).data.bio || "") : "";
    if (currentBio && currentBio.trim() === bio) return badRequest("That's the bio already on the site. Change something first.");

    await firestoreUpdate(env, path, {
      uid: auth.uid,
      name,
      slug,
      bio,
      currentBio,
      suiteRole: auth.role,
      status: "pending",
      submittedAt: now,
      decidedAt: null,
      decidedByName: "",
      note: "",
    }, { mergeFields: false });

    // Tell the admins (bell + email). Best-effort: the request is saved.
    const admins = (await firestoreRunQuery(env, {
      from: [{ collectionId: "users" }],
      where: { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: "admin" } } },
      limit: 50,
    }).catch(() => [])).filter((r) => !(Array.isArray(r.data.blockedAccess) && r.data.blockedAccess.includes("#/admin/bios")) || r.data.owner);

    const first = name.split(/\s+/)[0];
    await createNotifications(env, admins.map((a) => a.id), {
      type: "event",
      eventType: "bio-request",
      title: `${first} ${currentBio ? "wants to update their bio" : "sent their first bio"} for the About page`,
      body: bio.slice(0, 160),
      actorId: auth.uid,
      actorName: name,
      actionHash: "#/admin/bios",
    }, (rid) => `bio_${auth.uid}_${now.slice(0, 16)}_${rid}`).catch(() => {});

    const emails = [...new Set(admins.filter((a) => a.id !== auth.uid).map((a) => String(a.data.email || "").toLowerCase()).filter(Boolean))];
    if (emails.length) {
      const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
      const { subject, html } = adminBioRequestEmail({ name, bio, currentBio, siteUrl });
      await sendEmail(env, { to: emails, subject, html, replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com" })
        .catch((e) => console.warn("[bio request] email", e?.message));
    }

    return json({ ok: true, status: "pending" });
  } catch (err) {
    return serverError(err);
  }
};
