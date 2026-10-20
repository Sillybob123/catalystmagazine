// Editorial calendar (#/calendar): the month on its own page, set right on
// the page (no card): a large month title and controls, "Up next", the month
// as a hairline grid, then your stories and the publishing runway. Same data
// as before (schedule-calendar.js): publications, interviews, deadlines, the
// edition's key dates, social posts and shared tasks.

import { renderScheduleCalendar } from "./schedule-calendar.js?v=roles-5";

export function mount(ctx, container) {
  container.innerHTML = "";
  container.classList.add("cal-page");
  document.body.classList.add("scp-calm");   // a plain, solid page
  renderScheduleCalendar(container, ctx, { page: true });
  return () => document.body.classList.remove("scp-calm");
}
