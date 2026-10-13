// POST /api/social/request
//
// A writer (any staff member) asks the social media team for a post about
// their story, from the Story Tracker. Creates a social_assignments row owned
// by everyone with the social_media role (the Planner's content tracker shows
// it), emails them, and drops a bell notification. Done server-side because
// the Firestore rules only let non-leads create rows they own themselves.
//
// Body: { storyTitle, about, keyInfo?, link?, neededBy: "YYYY-MM-DD", projectId? }
// Auth: any staff role.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreCreate, firestoreRunQuery } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { sendEmail } from "../../_utils/resend.js";
import { socialAssignmentEmail } from "../../_utils/reminder-emails.js";
import { createNotifications } from "../../_utils/notifications.js";

const STAFF = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];
const clean = (v, max) => String(v ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, STAFF);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }

    const storyTitle = clean(body.storyTitle, 300);
    const about = clean(body.about, 2000);
    const keyInfo = clean(body.keyInfo, 3000);
    const link = clean(body.link, 500);
    const neededBy = clean(body.neededBy, 10);
    const projectId = /^[A-Za-z0-9_-]{1,200}$/.test(String(body.projectId || "")) ? String(body.projectId) : null;
    if (!storyTitle) return badRequest("Which story is the post for?");
    if (!about) return badRequest("Say what the post should be about.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) return badRequest("Give the date the story is expected to publish.");
    if (link && !/^https?:\/\//i.test(link)) return badRequest("The link should start with http:// or https://");

    // The social team: everyone whose role is social_media.
    const rows = await firestoreRunQuery(env, {
      from: [{ collectionId: "users" }],
      where: { fieldFilter: { field: { fieldPath: "role" }, op: "EQUAL", value: { stringValue: "social_media" } } },
      limit: 50,
    });
    const team = rows.map((r) => ({ id: r.id, name: String(r.data.name || r.data.email || ""), email: String(r.data.email || "") }));
    if (!team.length) return badRequest("There's no one on the social media team yet. Ask an admin.");

    const requester = auth.name || auth.email || "A writer";
    const notes = [
      `Requested by ${requester} from the Story Tracker.`,
      `What the post is about:\n${about}`,
      keyInfo ? `Key information to include:\n${keyInfo}` : "",
      `The story is expected to publish on ${neededBy}; the post is needed by then.`,
    ].filter(Boolean).join("\n\n");

    const now = new Date().toISOString();
    const assignment = {
      articleTitle: storyTitle,
      projectId,
      storyId: null,
      type: "",
      platform: "any",
      deadline: neededBy,
      link,
      notes,
      assigneeId: team[0].id,
      assigneeName: team[0].name,
      assigneeEmail: team[0].email,
      assignees: team,
      assigneeIds: team.map((t) => t.id),
      status: "planned",
      doneAt: null,
      kind: "request",
      requestedById: auth.uid,
      requestedByName: requester,
      createdById: auth.uid,
      createdByName: requester,
      createdAt: now,
    };
    const created = await firestoreCreate(env, "social_assignments", assignment);
    const id = (created?.name || "").split("/").pop() || created?.id || "";

    // Heads-up: email + bell. Best-effort; the row is the source of truth.
    const emails = [...new Set(team.map((t) => t.email).filter(Boolean))];
    if (emails.length) {
      const siteUrl = env.SITE_URL || "https://www.catalyst-magazine.com";
      const { subject, html } = socialAssignmentEmail({ assignment, assignerName: requester, siteUrl });
      await sendEmail(env, { to: emails, subject, html, replyTo: auth.email || env.MAIL_REPLY_TO || "stemcatalystmagazine@gmail.com" }).catch((e) => console.warn("[social request] email", e?.message));
    }
    await createNotifications(env, team.map((t) => t.id), {
      type: "assignment",
      title: `${requester} asked for a social post: ${storyTitle}`,
      body: `Needed by ${neededBy}`,
      actorId: auth.uid,
      actorName: requester,
      actionHash: "#/planner",
    }, (rid) => `socialrequest_${id}_${rid}`).catch(() => {});

    return json({ ok: true, id, team: team.map((t) => t.name) });
  } catch (err) {
    return serverError(err);
  }
};
