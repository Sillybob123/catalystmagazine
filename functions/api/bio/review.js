// POST /api/bio/review
//
// An admin approves or sends back a bio request (Suite → Bio requests,
// #/admin/bios). Approving writes team_bios/{slug}, the public copy the About
// page (js/about.js) and the writer pages (functions/author/[slug].js) read,
// so the bio is live as soon as this returns. Either way the person gets a
// bell notification and an email.
//
// Body: { uid, action: "approve" | "reject", bio?, role?, section?, note? }
//   bio      the admin's final wording (defaults to what was sent)
//   role     the title shown under their name (first bios, or a change)
//   section  where a first-time bio goes on the About page (see SECTIONS)
//   note     optional message to the person (required to send back)
// Auth: admin, or anyone granted #/admin/bios.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { bioDecisionEmail } from "../../_utils/reminder-emails.js";
import { createNotification } from "../../_utils/notifications.js";

// About page sections (rosterGroups in js/main.js, plus Alumni). Keep in sync
// with SECTIONS in js/dashboard/bios.js and the placement code in js/about.js.
const SECTIONS = ["eboard", "staff:Editing", "staff:Social Media", "undergraduate-fellows", "graduate-fellows", "alumni"];

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/admin/bios"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }

    const uid = String(body.uid || "");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return badRequest("Which request?");
    const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : "";
    if (!action) return badRequest("Approve or send back?");

    const raw = await firestoreGet(env, `bio_requests/${uid}`);
    if (!raw) return badRequest("That request no longer exists.");
    const req = fromFirestoreDoc(raw).data;
    if (req.status !== "pending") return badRequest("That request was already handled.");

    const note = String(body.note || "").trim().slice(0, 1200);
    const bio = String(body.bio ?? req.bio ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 2000);
    if (action === "approve" && bio.length < 40) return badRequest("The bio is empty.");
    if (action === "reject" && !note) return badRequest("Say what they should change, so they know what to fix.");

    const now = new Date().toISOString();
    const reviewer = auth.name || auth.email || "An admin";
    const slug = String(req.slug || "");
    if (!slug) return badRequest("This request has no name attached.");

    if (action === "approve") {
      const liveRaw = await firestoreGet(env, `team_bios/${slug}`).catch(() => null);
      const live = liveRaw ? fromFirestoreDoc(liveRaw).data : null;
      const role = String(body.role || live?.role || "").trim().slice(0, 120);
      const section = SECTIONS.includes(body.section) ? body.section : (live?.section || "");
      if (!live && !role) return badRequest("Give them a title for the About page (for example, Writer).");
      if (!live && !section) return badRequest("Choose where they appear on the About page.");
      const fields = {
        name: req.name,
        slug,
        bio,
        uid,
        updatedAt: now,
        approvedByName: reviewer,
      };
      if (role) fields.role = role;
      if (section) fields.section = section;
      await firestoreUpdate(env, `team_bios/${slug}`, fields);
    }

    await firestoreUpdate(env, `bio_requests/${uid}`, {
      status: action === "approve" ? "approved" : "changes",
      bio,
      note,
      decidedAt: now,
      decidedByName: reviewer,
    });

    const approved = action === "approve";
    await createNotification(env, {
      recipientId: uid,
      type: "event",
      eventType: approved ? "bio-approved" : "bio-changes",
      title: approved ? "Your bio is live on the About page" : "Your bio needs a few changes",
      body: approved ? `Approved by ${reviewer}.` : note.slice(0, 200),
      actorId: auth.uid,
      actorName: reviewer,
      actionHash: approved ? "" : "#/overview?bio=1",
    }, `bio_decision_${uid}_${now.slice(0, 16)}`).catch(() => {});

    const userRaw = await firestoreGet(env, `users/${uid}`).catch(() => null);
    const email = userRaw ? String(fromFirestoreDoc(userRaw).data.email || "") : "";
    if (email && uid !== auth.uid) {
      const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
      const { subject, html } = bioDecisionEmail({ name: req.name, approved, bio, note, slug, siteUrl });
      await sendEmail(env, { to: email, subject, html, replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com" })
        .catch((e) => console.warn("[bio review] email", e?.message));
    }

    return json({ ok: true, status: approved ? "approved" : "changes" });
  } catch (err) {
    return serverError(err);
  }
};
