// Best times to post, by platform and weekday, for an East Coast (Eastern
// Time) audience. Used by the Social media page: the "Best times to post"
// guide, and the tip under "Post on" that suggests a time for the chosen day
// (social-plan.js, marketing.js).
//
// Research, October 2026. The big studies report times in the audience's
// local time, so for our D.C. readers they read as Eastern Time:
//   • Sprout Social, best times to post (Instagram, LinkedIn, X, Facebook,
//     TikTok), updated March 2026: nearly 2 billion engagements across
//     ~307,000 profiles, Nov 27 2025 to Feb 27 2026, with education and
//     nonprofit breakdowns. sproutsocial.com/insights/best-times-to-post-on-social-media/
//   • Buffer, State of Social Media Engagement 2026: 52 million posts
//     (Instagram ~9.6M, X ~8.7M, LinkedIn ~4.8M). buffer.com/resources/best-time-to-post-social-media/
//   • Hootsuite, best time to post (2025 data), as a cross-check.
// Where they agree, that's the window; the single "best" pick is where they
// overlap (e.g. Instagram Wednesday noon is top in both). Strength:
// peak = the strongest days, good = solid, weak = the quietest days.
//
// Update once a year: the studies refresh every spring.

export const RESEARCHED = "October 2026";

export const POST_TIMES = {
  instagram: {
    label: "Instagram",
    summary: "Tuesday to Thursday, midday into the evening. Wednesday is the strongest day; weekends are the quietest.",
    days: {
      1: { s: "good", window: "2–4 PM", best: "15:00" },
      2: { s: "peak", window: "1–7 PM", best: "18:00" },
      3: { s: "peak", window: "12–9 PM", best: "12:00", alt: "18:00" },
      4: { s: "peak", window: "9 AM, 12–2 PM", best: "12:00", alt: "09:00" },
      5: { s: "weak", window: "No clear peak", best: "12:00" },
      6: { s: "weak", window: "Quietest day", best: "15:00" },
      0: { s: "weak", window: "Very quiet", best: null },
    },
    note: "Students also look in the evening: Sprout's education data adds Tuesday 7–9 PM and Wednesday until 9 PM, and Buffer finds 6–11 PM strong on most weekdays.",
  },
  linkedin: {
    label: "LinkedIn",
    summary: "Weekdays, late morning through the afternoon. Tuesday to Thursday are strongest; skip weekends and early mornings.",
    days: {
      1: { s: "good", window: "1–2 PM", best: "13:00" },
      2: { s: "peak", window: "11 AM–5 PM", best: "12:00" },
      3: { s: "peak", window: "11 AM–4 PM", best: "16:00", alt: "11:00" },
      4: { s: "peak", window: "11 AM, 1–5 PM", best: "13:00" },
      5: { s: "good", window: "11 AM, 1–4 PM", best: "15:00" },
      6: { s: "weak", window: "Very quiet", best: null },
      0: { s: "weak", window: "Very quiet", best: null },
    },
    note: "Professional audiences (faculty, researchers, employers) read on weekdays during work hours. Buffer finds posts between 6 and 11 AM do worse.",
  },
  twitter: {
    label: "X",
    summary: "Tuesday to Thursday, from noon to 6 PM. Monday is close behind; Saturday is the quietest.",
    days: {
      1: { s: "good", window: "2–3 PM, 5 PM", best: "14:00" },
      2: { s: "peak", window: "12–6 PM", best: "12:00", alt: "09:00" },
      3: { s: "peak", window: "12–6 PM", best: "12:00", alt: "10:00" },
      4: { s: "peak", window: "12–6 PM", best: "12:00" },
      5: { s: "good", window: "12–6 PM", best: "13:00" },
      6: { s: "weak", window: "Quietest day", best: null },
      0: { s: "good", window: "2–6 PM", best: "15:00" },
    },
    note: "For student audiences, Sprout's education data shows evenings (Tuesday 7–9 PM, Wednesday 6 and 9 PM) and weekend afternoons doing well, outside class hours.",
  },
  facebook: {
    label: "Facebook",
    summary: "Monday to Thursday around midday; Tuesday and Wednesday stay strong into the evening. Weekends are the quietest.",
    days: {
      1: { s: "good", window: "12–1 PM", best: "12:00" },
      2: { s: "peak", window: "12–8 PM", best: "12:00" },
      3: { s: "peak", window: "12–8 PM", best: "12:00" },
      4: { s: "peak", window: "9 AM, 12–2 PM", best: "12:00", alt: "09:00" },
      5: { s: "good", window: "Around midday", best: "12:00" },
      6: { s: "weak", window: "Quietest day", best: null },
      0: { s: "weak", window: "Very quiet", best: null },
    },
    note: "Facebook's audience skews older (parents, alumni, faculty), who check it at lunch and in the evening.",
  },
};

export const GENERAL_TIPS = [
  "Times are Eastern Time, our D.C. audience's time zone. If you're posting from elsewhere, convert first.",
  "Tuesday, Wednesday and Thursday are the strongest days on every platform we use. Saturday and Sunday are the quietest.",
  "Post a little before the peak, so the post is already there when people start scrolling.",
  "These are averages from millions of posts. After a few weeks, check Instagram's Insights (Most active times) for when our own followers are online, and lean toward that.",
];

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "18:00" → "6:00 PM"
export function fmtClock(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const parseDay = (dateStr) => { const [y, m, d] = String(dateStr || "").split("-").map(Number); const dt = new Date(y, (m || 1) - 1, d || 1); return y ? dt : null; };
const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
const short = (dt) => dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };

// What to tell someone who picked `dateStr` (and maybe `timeStr`) for a post
// on `platform`: { text, useTime, moveTo, moveLabel, tone }.
export function bestTimeAdvice(platform, dateStr, timeStr = "") {
  const P = POST_TIMES[platform] || POST_TIMES.instagram;
  const dt = parseDay(dateStr);
  if (!dt) return null;
  const day = P.days[dt.getDay()];
  const out = { tone: day.s, useTime: null, moveTo: null, moveLabel: "" };
  const dayName = DAY[dt.getDay()];
  if (day.s === "weak") {
    // The next strong day (Tuesday to Thursday) after the chosen date.
    let next = dt;
    for (let i = 1; i <= 7; i++) { next = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + i); if (P.days[next.getDay()].s === "peak") break; }
    const nd = P.days[next.getDay()];
    out.moveTo = iso(next);
    out.moveLabel = `Move to ${short(next)}`;
    out.text = `${dayName}s are among the quietest days on ${P.label}. ${short(next)} at ${fmtClock(nd.best)} ET would likely reach more people.${day.best ? ` If it has to be ${dayName}, aim for about ${fmtClock(day.best)} ET.` : ""}`;
    out.useTime = day.best;
    return out;
  }
  out.useTime = day.best;
  const alt = day.alt ? ` (or ${fmtClock(day.alt)})` : "";
  out.text = `Best on ${P.label} on ${dayName}s: ${day.window} ET. Top pick: ${fmtClock(day.best)}${alt}.${day.s === "peak" ? " This is one of the strongest days." : ""}`;
  if (timeStr && day.best) {
    const diff = Math.abs(toMin(timeStr) - toMin(day.best));
    if (diff <= 30) { out.text = `Good timing: ${fmtClock(timeStr)} is right in ${P.label}'s best window on ${dayName}s (${day.window} ET).`; out.useTime = null; }
  }
  return out;
}

// The weekly guide (one platform), for the Best times modal.
export function guideTableHTML(platform) {
  const P = POST_TIMES[platform] || POST_TIMES.instagram;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const label = { peak: "Strongest", good: "Good", weak: "Quiet" };
  return `
    <p class="pt-summary">${esc(P.summary)}</p>
    <ol class="pt-week">${order.map((d) => {
      const x = P.days[d];
      return `<li class="pt-day is-${x.s}">
        <span class="pt-dname">${DAY[d].slice(0, 3)}</span>
        <span class="pt-window">${esc(x.window)}</span>
        <span class="pt-best">${x.best ? `${esc(fmtClock(x.best))}${x.alt ? ` <small>or ${esc(fmtClock(x.alt))}</small>` : ""}` : "<small>Skip if you can</small>"}</span>
        <span class="pt-tag">${label[x.s]}</span>
      </li>`;
    }).join("")}</ol>
    <p class="pt-note">${esc(P.note)}</p>`;
}
