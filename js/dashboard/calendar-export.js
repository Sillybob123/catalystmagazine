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

// Inject styles + keyframes once. Scoped under .cal-export-* so they can't
// collide with the host page's CSS.
function injectStylesOnce() {
  if (document.getElementById("cal-export-styles")) return;
  const style = document.createElement("style");
  style.id = "cal-export-styles";
  style.textContent = `
    @keyframes calExportFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes calExportPopIn {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .cal-export-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      animation: calExportFadeIn 0.18s ease-out;
    }
    .cal-export-dialog {
      background: #ffffff;
      color: #0f172a;
      border-radius: 18px;
      box-shadow: 0 25px 70px rgba(15, 23, 42, 0.35);
      max-width: 480px; width: 100%;
      overflow: hidden;
      font-family: inherit;
      animation: calExportPopIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .cal-export-header {
      padding: 22px 24px 16px;
      background: linear-gradient(135deg, #f8fafc 0%, #fff 100%);
      border-bottom: 1px solid #f1f5f9;
      position: relative;
    }
    .cal-export-icon {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      display: flex; align-items: center; justify-content: center;
      color: #fff;
      margin-bottom: 12px;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
    }
    .cal-export-title {
      margin: 0; font-size: 19px; font-weight: 700;
      letter-spacing: -0.01em; color: #0f172a;
    }
    .cal-export-subtitle {
      margin: 4px 0 0 0; color: #64748b;
      font-size: 13.5px; line-height: 1.5;
    }
    .cal-export-close {
      position: absolute; top: 14px; right: 14px;
      width: 32px; height: 32px; border: 0;
      background: transparent; border-radius: 8px;
      color: #94a3b8; font-size: 22px; line-height: 1;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .cal-export-close:hover { background: #f1f5f9; color: #0f172a; }
    .cal-export-body { padding: 16px 24px 4px; }
    .cal-export-event {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 12px;
      background: #fff;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .cal-export-event:hover {
      border-color: #cbd5e1;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
    }
    .cal-export-event-head {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 12px; margin-bottom: 10px;
    }
    .cal-export-event-label {
      font-size: 11px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      color: #6366f1;
    }
    .cal-export-event-date {
      font-size: 14px; font-weight: 600; color: #0f172a;
    }
    .cal-export-actions {
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    .cal-export-btn {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 500;
      padding: 8px 14px; border-radius: 8px;
      border: 1px solid #e2e8f0; background: #fff;
      color: #0f172a; cursor: pointer;
      text-decoration: none;
      transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
      font-family: inherit;
    }
    .cal-export-btn:hover {
      background: #f8fafc; border-color: #cbd5e1;
    }
    .cal-export-btn:active { transform: translateY(1px); }
    .cal-export-btn.primary {
      background: #0f172a; color: #fff; border-color: #0f172a;
    }
    .cal-export-btn.primary:hover { background: #1e293b; border-color: #1e293b; }
    .cal-export-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
    .cal-export-note {
      margin: 4px 24px 0;
      padding: 10px 12px;
      background: #fefce8;
      border: 1px solid #fde68a;
      border-radius: 10px;
      font-size: 12px; color: #854d0e; line-height: 1.5;
      display: flex; gap: 8px; align-items: flex-start;
    }
    .cal-export-note svg { flex-shrink: 0; margin-top: 1px; color: #ca8a04; }
    .cal-export-footer {
      padding: 16px 24px 18px;
      display: flex; justify-content: flex-end;
    }
  `;
  document.head.appendChild(style);
}

const ICON_CALENDAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICON_GOOGLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

// Centered modal (not a corner toast) so it can't be missed. Resolves when the
// user dismisses — caller can `await` it before doing anything else.
export function showCalendarExportPrompt(project, opts = {}) {
  const events = eventsForProject(project);
  if (!events.length) return Promise.resolve();

  injectStylesOnce();

  return new Promise((resolve) => {
    const prior = document.getElementById("calendar-export-overlay");
    if (prior) prior.remove();

    const overlay = document.createElement("div");
    overlay.id = "calendar-export-overlay";
    overlay.className = "cal-export-overlay";

    const dialog = document.createElement("div");
    dialog.className = "cal-export-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "cal-export-title");

    const dismiss = () => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(); };
    const onKey = (e) => { if (e.key === "Escape") dismiss(); };

    // Header
    const header = document.createElement("div");
    header.className = "cal-export-header";
    header.innerHTML = `
      <div class="cal-export-icon">${ICON_CALENDAR}</div>
      <h3 class="cal-export-title" id="cal-export-title">${escapeHtml(opts.title || "Save to your calendar")}</h3>
      <p class="cal-export-subtitle">${escapeHtml(opts.subtitle ||
        `Stay on top of this proposal. We'll set a reminder ${REMINDER_DAYS_BEFORE} days before each due date.`)}</p>
      <button class="cal-export-close" aria-label="Close">×</button>
    `;
    header.querySelector(".cal-export-close").addEventListener("click", dismiss);
    dialog.appendChild(header);

    // Body — one card per event
    const body = document.createElement("div");
    body.className = "cal-export-body";

    events.forEach((ev) => {
      const card = document.createElement("div");
      card.className = "cal-export-event";

      const head = document.createElement("div");
      head.className = "cal-export-event-head";
      head.innerHTML = `
        <div>
          <div class="cal-export-event-label">${escapeHtml(ev.label)}</div>
          <div class="cal-export-event-date">${escapeHtml(formatHumanDate(ev.dateString))}</div>
        </div>
      `;
      card.appendChild(head);

      const actions = document.createElement("div");
      actions.className = "cal-export-actions";

      const icsBtn = document.createElement("button");
      icsBtn.type = "button";
      icsBtn.className = "cal-export-btn primary";
      icsBtn.innerHTML = `${ICON_DOWNLOAD}<span>Download .ics</span>`;
      icsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        downloadIcs(ev);
      });
      actions.appendChild(icsBtn);

      const gUrl = buildGoogleCalendarUrl(ev);
      if (gUrl) {
        const gLink = document.createElement("a");
        gLink.href = gUrl;
        gLink.target = "_blank";
        gLink.rel = "noopener";
        gLink.className = "cal-export-btn";
        gLink.innerHTML = `${ICON_GOOGLE}<span>Add to Google Calendar</span>`;
        actions.appendChild(gLink);
      }

      card.appendChild(actions);
      body.appendChild(card);
    });
    dialog.appendChild(body);

    // Note: Google Calendar's URL template doesn't accept reminder params, so
    // make this explicit instead of letting the user wonder.
    const note = document.createElement("div");
    note.className = "cal-export-note";
    note.innerHTML = `${ICON_INFO}<span>The .ics file includes a built-in <strong>${REMINDER_DAYS_BEFORE}-day reminder</strong>. Google Calendar's web link doesn't support pre-set reminders — set one manually after the event opens.</span>`;
    dialog.appendChild(note);

    // Footer
    const footer = document.createElement("div");
    footer.className = "cal-export-footer";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "cal-export-btn";
    skip.textContent = "Done";
    skip.addEventListener("click", dismiss);
    footer.appendChild(skip);
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { REMINDER_DAYS_BEFORE };
