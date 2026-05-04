// Calendar export helpers for proposal publication deadlines + interview
// dates. Used by the admin pipeline modal (js/dashboard/pipeline.js).
// Mirrors scheduler/calendarExport.js, just packaged as an ES module so the
// admin app can import it directly. Both versions agree on UID format so a
// re-export from either place updates the same calendar entry.

const REMINDER_DAYS_BEFORE = 5;

function pad(n) { return String(n).padStart(2, "0"); }

function parseLocalDate(yyyyMmDd) {
  if (!yyyyMmDd || typeof yyyyMmDd !== "string") return null;
  const m = yyyyMmDd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function toIcsDate(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function toIcsUtcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeIcsText(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildIcs(event) {
  const date = parseLocalDate(event.dateString);
  if (!date) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + 1);

  const reminder = Number.isFinite(event.reminderDaysBefore) ? event.reminderDaysBefore : REMINDER_DAYS_BEFORE;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Catalyst Magazine//Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${toIcsUtcStamp(new Date())}`,
    `DTSTART;VALUE=DATE:${toIcsDate(date)}`,
    `DTEND;VALUE=DATE:${toIcsDate(next)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(event.title)}`,
    `TRIGGER:-P${Math.max(0, reminder)}D`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function buildGoogleCalendarUrl(event) {
  const date = parseLocalDate(event.dateString);
  if (!date) return null;
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title || "",
    dates: `${toIcsDate(date)}/${toIcsDate(next)}`,
    details: event.description || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcs(event) {
  const ics = buildIcs(event);
  if (!ics) return false;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (event.filename || "catalyst-event") + ".ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function eventsForProject(project) {
  if (!project) return [];
  const id = project.id || "project";
  const title = project.title || "Catalyst project";
  const pubDate = (project.deadlines && project.deadlines.publication) || project.deadline || "";
  const interviewDate = project.deadlines && project.deadlines.interview;

  const events = [];
  if (pubDate) {
    events.push({
      kind: "publication",
      uid: `proposal-${id}@catalyst-magazine.com`,
      title: `Catalyst publication: ${title}`,
      description: `Publication deadline for "${title}".\nReminder set ${REMINDER_DAYS_BEFORE} days before due date.\nView project: https://www.catalyst-magazine.com/admin/`,
      dateString: pubDate,
      filename: `catalyst-publication-${id}`,
      reminderDaysBefore: REMINDER_DAYS_BEFORE,
      label: "Publication deadline",
    });
  }
  if (interviewDate) {
    events.push({
      kind: "interview",
      uid: `interview-${id}@catalyst-magazine.com`,
      title: `Catalyst interview: ${title}`,
      description: `Scheduled interview for "${title}".\nReminder set ${REMINDER_DAYS_BEFORE} days before.\nView project: https://www.catalyst-magazine.com/admin/`,
      dateString: interviewDate,
      filename: `catalyst-interview-${id}`,
      reminderDaysBefore: REMINDER_DAYS_BEFORE,
      label: "Interview date",
    });
  }
  return events;
}

function formatHumanDate(yyyyMmDd) {
  const d = parseLocalDate(yyyyMmDd);
  if (!d) return yyyyMmDd || "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Centered modal (not a corner toast) so it can't be missed. Resolves when the
// user dismisses — caller can `await` it before doing anything else.
export function showCalendarExportPrompt(project, opts = {}) {
  const events = eventsForProject(project);
  if (!events.length) return Promise.resolve();

  return new Promise((resolve) => {
    const prior = document.getElementById("calendar-export-overlay");
    if (prior) prior.remove();

    const overlay = document.createElement("div");
    overlay.id = "calendar-export-overlay";
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(15, 23, 42, 0.55);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
    `;

    const dialog = document.createElement("div");
    dialog.style.cssText = `
      background: #fff; color: #111; border-radius: 14px;
      box-shadow: 0 20px 60px rgba(15,23,42,0.35);
      max-width: 460px; width: 100%; padding: 22px 22px 18px;
      font-family: inherit;
    `;

    const heading = document.createElement("h3");
    heading.style.cssText = "margin:0 0 6px 0; font-size:18px; font-weight:700;";
    heading.textContent = opts.title || "Save to your calendar?";
    dialog.appendChild(heading);

    const sub = document.createElement("p");
    sub.style.cssText = "margin:0 0 14px 0; color:#64748b; font-size:13px; line-height:1.45;";
    sub.textContent = opts.subtitle ||
      `Add this proposal's deadline to your calendar so you don't forget. We'll set a reminder ${REMINDER_DAYS_BEFORE} days before each due date.`;
    dialog.appendChild(sub);

    events.forEach((ev) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;";

      const labelEl = document.createElement("div");
      labelEl.style.cssText = "flex-basis:100%;font-size:12px;color:#64748b;";
      labelEl.textContent = `${ev.label} — ${formatHumanDate(ev.dateString)}`;
      row.appendChild(labelEl);

      const icsBtn = document.createElement("button");
      icsBtn.type = "button";
      icsBtn.className = "btn btn-secondary";
      icsBtn.style.cssText = "font-size:13px;padding:8px 12px;";
      icsBtn.textContent = "Download .ics";
      icsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        downloadIcs(ev);
      });
      row.appendChild(icsBtn);

      const gUrl = buildGoogleCalendarUrl(ev);
      if (gUrl) {
        const gLink = document.createElement("a");
        gLink.href = gUrl;
        gLink.target = "_blank";
        gLink.rel = "noopener";
        gLink.className = "btn btn-secondary";
        gLink.style.cssText = "font-size:13px;padding:8px 12px;text-decoration:none;display:inline-block;";
        gLink.textContent = "Add to Google Calendar";
        row.appendChild(gLink);
      }

      dialog.appendChild(row);
    });

    const footer = document.createElement("div");
    footer.style.cssText = "display:flex; justify-content:flex-end; margin-top:18px;";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "btn btn-secondary";
    skip.style.cssText = "font-size:13px; padding:8px 14px;";
    skip.textContent = "Done";
    skip.addEventListener("click", () => { overlay.remove(); resolve(); });
    footer.appendChild(skip);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(); }
    });

    document.body.appendChild(overlay);
  });
}

export { REMINDER_DAYS_BEFORE };
