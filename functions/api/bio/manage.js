// POST /api/bio/manage
//
// An admin edits anyone's entry on the About page directly (Suite → Team
// bios, #/admin/bios → Edit): bio, title, photo, which sections they appear
// in, and whether they show at all. Writes team_bios/{slug}, which the About
// page (js/about.js) and the writer pages read, so it's live at once. No
// approval step: admins are the approvers.
//
// Body: { slug?, name, uid?, role, sections: string[], hidden, bio, image, imageSource?, imageFit? }
//   slug     omitted for someone new (made from the name)
//   sections where they appear (see SECTIONS); several are allowed
//   hidden   true keeps them off the About page without losing their entry
//   image    the framed photo URL ("" for initials)
//   imageSource / imageFit  the original photo and its { zoom, x, y } in the
//            hexagon, so an admin can resize it later
// Auth: admin, or anyone granted #/admin/bios.

import { json, badRequest, serverError } from "../../_utils/http.js";
import { firestoreGet, firestoreUpdate, fromFirestoreDoc } from "../../_utils/firebase.js";
import { requireRole } from "../../_utils/auth.js";
import { titleToSlug } from "../../_utils/article-meta.js";

// About page sections, in page order (rosterGroups in js/main.js, plus
// Alumni). Keep in sync with SECTIONS in js/dashboard/bios.js and
// functions/api/bio/review.js.
const SECTIONS = ["eboard", "staff:Editing", "staff:Social Media", "undergraduate-fellows", "graduate-fellows", "alumni"];

export const onRequestPost = async ({ request, env }) => {
  try {
    const auth = await requireRole(request, env, ["admin"], ["#/admin/bios"]);
    if (auth instanceof Response) return auth;

    let body = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return badRequest("Invalid JSON body"); }

    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const slug = String(body.slug || titleToSlug(name));
    if (!name || !/^[a-z0-9-]{1,120}$/.test(slug)) return badRequest("Give them a name.");

    const bio = String(body.bio ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
    const role = String(body.role || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const sections = [...new Set((Array.isArray(body.sections) ? body.sections : []).filter((s) => SECTIONS.includes(s)))];
    const hidden = body.hidden === true;
    const image = String(body.image || "").trim().slice(0, 1500);
    // The original photo and how it sits in the hexagon, so it can be resized later.
    const imageSource = String(body.imageSource || "").trim().slice(0, 1500);
    const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
    const imageFit = body.imageFit && typeof body.imageFit === "object"
      ? { zoom: num(body.imageFit.zoom, 0.3, 3, 1), x: num(body.imageFit.x, -1, 1, 0), y: num(body.imageFit.y, -1, 1, 0),
          kind: ["framed", "cutout", "photo"].includes(body.imageFit.kind) ? body.imageFit.kind : "" }
      : null;

    if (!hidden && bio.length < 40) return badRequest("Write a bio first (or hide them from the About page).");
    if (!hidden && !role) return badRequest("Give them a title, for example Writer.");
    if (!hidden && !sections.length) return badRequest("Choose at least one section of the About page.");
    const okUrl = (u) => !u || /^(https:\/\/|\/)[^\s"'<>]+$/.test(u);
    if (!okUrl(image) || !okUrl(imageSource)) return badRequest("That photo link doesn't look right.");

    const path = `team_bios/${slug}`;
    const existing = await firestoreGet(env, path).catch(() => null);
    const before = existing ? fromFirestoreDoc(existing).data : {};

    const fields = {
      name,
      slug,
      bio,
      role,
      sections,
      section: sections[0] || before.section || "",
      hidden,
      image,
      imageSource,
      imageFit,
      updatedAt: new Date().toISOString(),
      approvedByName: `Edited by ${auth.name || auth.email || "an admin"}`,
    };
    const uid = String(body.uid || before.uid || "");
    if (/^[A-Za-z0-9_-]{1,128}$/.test(uid)) fields.uid = uid;

    await firestoreUpdate(env, path, fields);
    return json({ ok: true, slug });
  } catch (err) {
    return serverError(err);
  }
};
