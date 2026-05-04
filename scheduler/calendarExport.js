// Calendar export helpers for proposal publication deadlines and interviews.
// Generates a downloadable .ics file (with a 5-day VALARM reminder) and a
// Google Calendar "Add to Calendar" URL for the same event. Buttons are
// surfaced after a successful proposal submit and persistently inside the
// project details modal sidebar.

(function () {
    const REMINDER_DAYS_BEFORE = 5;

    function pad(n) { return String(n).padStart(2, '0'); }

    // YYYY-MM-DD → Date at local midnight. Avoids the "off by one" timezone
    // surprise from `new Date('YYYY-MM-DD')` (which parses as UTC).
    function parseLocalDate(yyyyMmDd) {
        if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return null;
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

    // RFC 5545 says lines should be CRLF and folded at 75 octets. Email/calendar
    // clients are forgiving in practice, but we still escape commas/semicolons
    // and newlines inside text values so the file imports cleanly.
    function escapeIcsText(s) {
        return String(s == null ? '' : s)
            .replace(/\\/g, '\\\\')
            .replace(/\r?\n/g, '\\n')
            .replace(/,/g, '\\,')
            .replace(/;/g, '\\;');
    }

    // event: { uid, title, description, dateString (YYYY-MM-DD), reminderDaysBefore }
    function buildIcs(event) {
        const date = parseLocalDate(event.dateString);
        if (!date) return null;
        // All-day event: DTSTART (inclusive) → DTEND (exclusive next day).
        const next = new Date(date);
        next.setDate(next.getDate() + 1);

        const dtStart = toIcsDate(date);
        const dtEnd = toIcsDate(next);
        const dtStamp = toIcsUtcStamp(new Date());
        const reminder = Number.isFinite(event.reminderDaysBefore) ? event.reminderDaysBefore : REMINDER_DAYS_BEFORE;

        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Catalyst Magazine//Tracker//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'BEGIN:VEVENT',
            `UID:${escapeIcsText(event.uid)}`,
            `DTSTAMP:${dtStamp}`,
            `DTSTART;VALUE=DATE:${dtStart}`,
            `DTEND;VALUE=DATE:${dtEnd}`,
            `SUMMARY:${escapeIcsText(event.title)}`,
            `DESCRIPTION:${escapeIcsText(event.description)}`,
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${escapeIcsText(event.title)}`,
            `TRIGGER:-P${Math.max(0, reminder)}D`,
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR',
            ''
        ];
        return lines.join('\r\n');
    }

    function buildGoogleCalendarUrl(event) {
        const date = parseLocalDate(event.dateString);
        if (!date) return null;
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        const params = new URLSearchParams({
            action: 'TEMPLATE',
            text: event.title || '',
            dates: `${toIcsDate(date)}/${toIcsDate(next)}`,
            details: event.description || '',
        });
        return `https://calendar.google.com/calendar/render?${params.toString()}`;
    }

    function downloadIcs(event) {
        const ics = buildIcs(event);
        if (!ics) return false;
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (event.filename || 'catalyst-event') + '.ics';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    }

    // Build the standard event objects for a project. Returns an array — empty,
    // or with publication only, or with both publication + interview.
    function eventsForProject(project) {
        if (!project) return [];
        const events = [];
        const id = project.id || 'project';
        const title = project.title || 'Catalyst project';
        const pubDate = (project.deadlines && project.deadlines.publication) || project.deadline || '';
        const interviewDate = project.deadlines && project.deadlines.interview;

        if (pubDate) {
            events.push({
                kind: 'publication',
                uid: `proposal-${id}@catalyst-magazine.com`,
                title: `Catalyst publication: ${title}`,
                description: `Publication deadline for "${title}".\nReminder set ${REMINDER_DAYS_BEFORE} days before due date.\nView project: https://www.catalyst-magazine.com/scheduler/dashboard.html`,
                dateString: pubDate,
                filename: `catalyst-publication-${id}`,
                reminderDaysBefore: REMINDER_DAYS_BEFORE,
                label: 'Publication deadline',
            });
        }

        if (interviewDate) {
            events.push({
                kind: 'interview',
                uid: `interview-${id}@catalyst-magazine.com`,
                title: `Catalyst interview: ${title}`,
                description: `Scheduled interview for "${title}".\nReminder set ${REMINDER_DAYS_BEFORE} days before.\nView project: https://www.catalyst-magazine.com/scheduler/dashboard.html`,
                dateString: interviewDate,
                filename: `catalyst-interview-${id}`,
                reminderDaysBefore: REMINDER_DAYS_BEFORE,
                label: 'Interview date',
            });
        }
        return events;
    }

    function formatHumanDate(yyyyMmDd) {
        const d = parseLocalDate(yyyyMmDd);
        if (!d) return yyyyMmDd || '';
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Render a row of buttons for one event into a container. Used by both the
    // post-submit toast and the project details sidebar.
    function renderEventButtons(container, event) {
        const wrap = document.createElement('div');
        wrap.className = 'calendar-export-row';
        wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center;';

        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'flex-basis:100%;font-size:12px;color:var(--muted,#64748b);';
        labelEl.textContent = `${event.label} — ${formatHumanDate(event.dateString)}`;
        wrap.appendChild(labelEl);

        const icsBtn = document.createElement('button');
        icsBtn.type = 'button';
        icsBtn.className = 'btn-secondary';
        icsBtn.style.cssText = 'font-size:12px;padding:6px 10px;';
        icsBtn.textContent = 'Download .ics';
        icsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            downloadIcs(event);
        });
        wrap.appendChild(icsBtn);

        const gUrl = buildGoogleCalendarUrl(event);
        if (gUrl) {
            const gLink = document.createElement('a');
            gLink.href = gUrl;
            gLink.target = '_blank';
            gLink.rel = 'noopener';
            gLink.className = 'btn-secondary';
            gLink.style.cssText = 'font-size:12px;padding:6px 10px;text-decoration:none;display:inline-block;';
            gLink.textContent = 'Add to Google Calendar';
            wrap.appendChild(gLink);
        }

        container.appendChild(wrap);
    }

    // Show a centered modal dialog after a proposal submit. Modal (not toast)
    // because the corner toast got missed — this blocks the page until the
    // writer either downloads, adds to Google, or skips.
    function showPostSubmitPrompt(project) {
        const events = eventsForProject(project);
        if (!events.length) return;

        // Tear down any prior instance.
        const prior = document.getElementById('calendar-export-overlay');
        if (prior) prior.remove();

        const overlay = document.createElement('div');
        overlay.id = 'calendar-export-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: rgba(15, 23, 42, 0.55);
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #fff; color: #111; border-radius: 14px;
            box-shadow: 0 20px 60px rgba(15,23,42,0.35);
            max-width: 440px; width: 100%; padding: 22px 22px 18px;
            font-family: inherit;
        `;

        const heading = document.createElement('h3');
        heading.style.cssText = 'margin:0 0 6px 0; font-size:18px; font-weight:700;';
        heading.textContent = 'Save to your calendar?';
        dialog.appendChild(heading);

        const sub = document.createElement('p');
        sub.style.cssText = 'margin:0 0 14px 0; color:#64748b; font-size:13px; line-height:1.45;';
        sub.textContent = `Add this proposal's deadline to your calendar so you don't forget. We'll set a reminder ${REMINDER_DAYS_BEFORE} days before the due date.`;
        dialog.appendChild(sub);

        events.forEach((ev) => renderEventButtons(dialog, ev));

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex; justify-content:flex-end; margin-top:16px;';
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'btn-secondary';
        skip.style.cssText = 'font-size:13px; padding:8px 14px;';
        skip.textContent = 'Skip';
        skip.addEventListener('click', () => overlay.remove());
        footer.appendChild(skip);
        dialog.appendChild(footer);

        overlay.appendChild(dialog);
        // Click outside the dialog dismisses too.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    // Render the persistent buttons inside the project details modal sidebar.
    // Idempotent — replaces any prior block for the same project.
    function renderDetailsModalButtons(project) {
        const sidebar = document.querySelector('#details-modal .details-sidebar');
        if (!sidebar) return;

        const existing = sidebar.querySelector('[data-calendar-export]');
        if (existing) existing.remove();

        const events = eventsForProject(project);
        if (!events.length) return;

        const section = document.createElement('div');
        section.className = 'sidebar-section';
        section.setAttribute('data-calendar-export', '1');

        const heading = document.createElement('h4');
        heading.textContent = 'Save to calendar';
        section.appendChild(heading);

        const helper = document.createElement('p');
        helper.style.cssText = 'font-size:12px;color:var(--muted,#64748b);margin:0 0 6px 0;';
        helper.textContent = `Reminder set ${REMINDER_DAYS_BEFORE} days before each date.`;
        section.appendChild(helper);

        events.forEach((ev) => renderEventButtons(section, ev));

        // Insert just before the delete section if present, otherwise append.
        const deleteSection = sidebar.querySelector('#delete-section');
        if (deleteSection) {
            sidebar.insertBefore(section, deleteSection);
        } else {
            sidebar.appendChild(section);
        }
    }

    window.CatalystCalendarExport = {
        buildIcs,
        buildGoogleCalendarUrl,
        downloadIcs,
        eventsForProject,
        showPostSubmitPrompt,
        renderDetailsModalButtons,
        REMINDER_DAYS_BEFORE,
    };
})();
