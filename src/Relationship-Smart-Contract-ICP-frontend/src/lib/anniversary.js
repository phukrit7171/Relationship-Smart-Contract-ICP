/**
 * Anniversary maths, derived entirely from `accepted_at`.
 *
 * There is no canister timer behind any of this: nothing needs to be pushed,
 * so the date the pair was recorded is enough to compute everything on the
 * client. All comparisons use local wall-clock time, which is what the couple
 * actually experiences as "the day".
 */

import { nsToDate } from "./format";

const MS_PER_DAY = 86_400_000;

/** Midnight local time, so day counts don't shift with the hour of day. */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

/**
 * The same day-of-month in a target month, clamped to that month's last day.
 *
 * A 29 February start has no 29th in a common year, and a 31st has no
 * counterpart in April — both land on the last day of the target month rather
 * than rolling forward into the next one, which is what `setMonth` would do.
 */
export function clampToMonth(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

/**
 * @param {bigint|number} acceptedAtNs canister timestamp, nanoseconds
 * @param {Date} now
 */
export function anniversaryInfo(acceptedAtNs, now = new Date()) {
  const start = nsToDate(acceptedAtNs);
  const today = startOfDay(now);
  const startDay = start.getDate();
  const startMonth = start.getMonth();

  // --- yearly ---
  let nextAnniversary = clampToMonth(today.getFullYear(), startMonth, startDay);
  if (nextAnniversary < today) {
    nextAnniversary = clampToMonth(today.getFullYear() + 1, startMonth, startDay);
  }
  const yearsCompleted = Math.max(
    0,
    nextAnniversary.getFullYear() - start.getFullYear() - 1,
  );

  // --- monthly ---
  let nextMonthiversary = clampToMonth(
    today.getFullYear(),
    today.getMonth(),
    startDay,
  );
  if (nextMonthiversary <= today) {
    nextMonthiversary = clampToMonth(
      today.getFullYear(),
      today.getMonth() + 1,
      startDay,
    );
  }

  const totalDays = Math.max(0, daysBetween(start, now));
  let monthsTogether =
    (today.getFullYear() - start.getFullYear()) * 12 +
    (today.getMonth() - startMonth);
  if (today.getDate() < startDay) monthsTogether -= 1;
  monthsTogether = Math.max(0, monthsTogether);

  const daysUntil = daysBetween(now, nextAnniversary);

  return {
    start,
    totalDays,
    monthsTogether,
    nextAnniversary,
    /** Which anniversary `nextAnniversary` will be — 1st, 2nd, … */
    nextAnniversaryNumber: yearsCompleted + 1,
    yearsCompleted,
    daysUntil,
    /** True on the day itself. */
    isToday: daysUntil === 0,
    nextMonthiversary,
    daysUntilMonthiversary: daysBetween(now, nextMonthiversary),
  };
}

/** Days before the anniversary that the banner starts showing. */
export const BANNER_WINDOW_DAYS = 7;

/**
 * The gap between the canister's clock and the browser's, in seconds.
 *
 * A phone with a badly wrong clock would otherwise render a countdown that is
 * confidently hours or days off, with nothing on screen to suggest why.
 */
export function clockSkewSeconds(canisterNowNs, now = Date.now()) {
  return Math.abs(Number(nsToDate(canisterNowNs).getTime() - now)) / 1000;
}

export const SKEW_WARNING_SECONDS = 300;
