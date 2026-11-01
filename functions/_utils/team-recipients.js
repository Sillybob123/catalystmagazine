// functions/_utils/team-recipients.js
//
// Who on the team to email or notify for a meeting or a When-to-meet poll.
// Active staff accounts only, grouped by person (some people have two
// accounts), with every address on file.
//
//   staffRecipients(env)                 → everyone on the team
//   staffRecipients(env, { uids: [...] }) → only these people (widened to
//                                           all accounts with the same name)
//
// Returns { people: [{ name, emails, uids }], ids: [uid], emails: [address] }.

import { firestoreRunQuery } from "./firebase.js";

const STAFF = ["admin", "editor", "writer", "newsletter_builder", "marketing", "social_media"];

export async function staffRecipients(env, { uids = null } = {}) {
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
        rows.push({ id: r.id, email, name: String(r.data?.name || "").trim(), extra: Array.isArray(r.data?.extraEmails) ? r.data.extraEmails : [] });
      }
    } catch (err) {
      console.warn(`[team-recipients] ${role} query failed`, err?.message);
    }
  }
  const key = (r) => (r.name || r.email).toLowerCase();
  let chosen = rows;
  if (Array.isArray(uids)) {
    const wanted = new Set(uids.map(String));
    const names = new Set(rows.filter((r) => wanted.has(r.id)).map(key));
    chosen = rows.filter((r) => wanted.has(r.id) || names.has(key(r)));
  }
  const byPerson = new Map();
  for (const r of chosen) {
    const k = key(r);
    if (!byPerson.has(k)) byPerson.set(k, { name: r.name || r.email, emails: [], uids: [] });
    const p = byPerson.get(k);
    p.uids.push(r.id);
    for (const e of [r.email, ...r.extra]) {
      const x = String(e || "").trim().toLowerCase();
      if (x.includes("@") && !p.emails.includes(x)) p.emails.push(x);
    }
  }
  const people = [...byPerson.values()];
  return {
    people,
    ids: [...new Set(people.flatMap((p) => p.uids))],
    emails: [...new Set(people.flatMap((p) => p.emails))],
  };
}
