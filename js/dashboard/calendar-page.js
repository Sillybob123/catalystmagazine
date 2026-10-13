// Editorial calendar (#/calendar): the month grid on its own page, so the
// Overview can stay a short summary. Same calendar everyone already knows
// (schedule-calendar.js): publications, interviews, your deadlines, social
// posts and shared tasks.

import { renderScheduleCalendar } from "./schedule-calendar.js?v=roles-2";

export function mount(ctx, container) {
  container.innerHTML = "";
  container.classList.add("cal-page");
  renderScheduleCalendar(container, ctx);
}
