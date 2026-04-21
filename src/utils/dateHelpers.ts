/**
 * utils/dateHelpers.ts — date math utilities for scoring and scheduling.
 *
 * Phase 1 scaffolding only. The real implementations land in Phase 5 per
 * CLAUDE.md §7 (Core Business Logic), Appendix B (Score Calculation
 * Function), and §13.4 (Recurring Payment Due Day > Days in Month).
 *
 * Conventions:
 *   - Every function is pure. Same inputs → same output, no side effects.
 *   - Dates flow through as JavaScript `Date` instances; ISO strings live
 *     only at the storage boundary (see utils/formatters.ts for ISO parsing).
 *   - All comparisons are calendar-day based, not millisecond based, so a
 *     "same day" comparison ignores the user's local clock time.
 *   - Everything is backed by `date-fns` — no moment.js, no manual math
 *     unless a helper genuinely cannot be expressed with the library.
 *
 * Used by:
 *   - utils/scoring.ts              (Phase 5)
 *   - hooks/useAmbanScore.ts        (Phase 5)
 *   - hooks/useNotifications.ts     (Phase 12)
 *   - utils/insightGenerators.ts    (Phase 11)
 */

import { addMonths, differenceInCalendarDays, endOfMonth, setDate, startOfDay } from "date-fns";

/**
 * Given an array of income sources and "today", returns the earliest
 * upcoming credit date across all sources.
 *
 * Rules (CLAUDE.md §7.2, §13.2, §13.3):
 *   - If a source's creditDay is strictly after today's day-of-month,
 *     the next date is this month's occurrence.
 *   - If today IS the creditDay, the next date is NEXT month's occurrence
 *     (today's salary has already credited by the time we ask).
 *   - If the creditDay has already passed this month, roll to next month.
 *   - Handle 30/31-day month mismatches via getActualDueDate().
 *   - If no sources are provided, returns null so callers can surface
 *     the "no-income-source" warning.
 */
export function getNextIncomeDate(sources: { creditDay: number }[], today: Date): Date | null {
  // Defensive filter — anything outside 1..31 is nonsense data that
  // must never have been written, but we refuse to let a corrupt row
  // poison the scoring pipeline. Silently drop and continue.
  const valid = sources.filter(
    (source) =>
      Number.isInteger(source.creditDay) && source.creditDay >= 1 && source.creditDay <= 31,
  );

  if (valid.length === 0) return null;

  // Normalise "today" once so every comparison uses a consistent
  // start-of-day reference. Without this, a lingering wall-clock time
  // could make today's own credit date look "in the future" by a few
  // hours and mis-classify income-day (§13.2).
  const reference = startOfDay(today);

  const candidates = valid.map((source) => {
    // Step 1 — candidate in the current month. getActualDueDate
    // handles the 30/31/February clamp (§13.4).
    let candidate = getActualDueDate(source.creditDay, reference);

    // Step 2 — if the candidate is today or already passed, roll to
    // next month. The "today IS the credit day" rule (§13.2) says
    // today's salary has already credited by the time we ask, so the
    // NEXT occurrence is the relevant one for scoring.
    if (differenceInCalendarDays(candidate, reference) <= 0) {
      candidate = getActualDueDate(source.creditDay, addMonths(reference, 1));
    }

    return candidate;
  });

  // Earliest candidate wins (§13.3 — multiple sources are independent,
  // only the next one matters for daysLeft).
  return candidates.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest,
  );
}

/**
 * Resolves a day-of-month (1–31) to an actual Date in the month of
 * `reference`, clamping to the last day when the month is shorter.
 *
 * @example
 *   getActualDueDate(31, new Date(2026, 1, 1)) // Feb 28, 2026
 *   getActualDueDate(15, new Date(2026, 5, 1)) // Jun 15, 2026
 *
 * See CLAUDE.md §13.4.
 */
export function getActualDueDate(dueDay: number, reference: Date): Date {
  const lastDay = endOfMonth(reference).getDate();
  return startOfDay(setDate(reference, Math.min(Math.max(dueDay, 1), lastDay)));
}

/**
 * Difference in calendar days, clamped to a minimum of 1.
 *
 * Why this exists (CLAUDE.md §7.2):
 *   The Amban Score divides by daysLeft. When today IS the income-credit
 *   day, the raw calendar-day diff is 0, which would divide by zero. This
 *   helper enforces the "min 1" rule the score formula depends on.
 *
 * @example
 *   differenceInCalendarDaysClamped(today, today)          // 1
 *   differenceInCalendarDaysClamped(today, addDays(t, 5))  // 5
 *   differenceInCalendarDaysClamped(today, subDays(t, 3))  // 1  (never negative)
 */
export function differenceInCalendarDaysClamped(from: Date, to: Date, min = 1): number {
  const raw = differenceInCalendarDays(to, from);
  return Math.max(min, raw);
}

/**
 * Safe end-of-month that always returns the last calendar day of the
 * month containing `reference`, at 00:00 local time.
 *
 * Wrapper around date-fns `endOfMonth` that normalises to start-of-day so
 * downstream calendar-day comparisons are unambiguous.
 */
export function endOfMonthSafe(reference: Date): Date {
  return startOfDay(endOfMonth(reference));
}

/**
 * True when a recurring payment with `dueDay` should be pre-deducted from
 * the effective balance for the current scoring window.
 *
 * Rule (CLAUDE.md §7.3, §13.7): include the payment only when its actual
 * due date falls in the inclusive range [today, nextIncomeDate]. If the
 * dueDay has already passed this month, assume it's already reflected in
 * the latest balance snapshot and skip it — do not double-deduct.
 */
export function isRecurringDueBeforeNextIncome(
  dueDay: number,
  today: Date,
  nextIncomeDate: Date,
): boolean {
  // Defensive guard — treat malformed dueDay values as "doesn't apply"
  // rather than crashing the scoring pipeline.
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return false;
  }

  // Normalise all three dates to start-of-day so comparisons are
  // strictly calendar-based — no stray wall-clock time can flip the
  // answer across the midnight boundary.
  const reference = startOfDay(today);
  const dueDate = getActualDueDate(dueDay, reference);
  const incomeDate = startOfDay(nextIncomeDate);

  // Inclusive on both ends:
  //   - `dueDate >= today` so a payment due TODAY still gets pre-deducted
  //     (the snapshot doesn't know the user hasn't paid it yet).
  //   - `dueDate <= nextIncomeDate` so a payment landing exactly on
  //     salary day counts against the current scoring window rather
  //     than drifting into the next cycle.
  const onOrAfterToday = differenceInCalendarDays(dueDate, reference) >= 0;
  const onOrBeforeIncome = differenceInCalendarDays(dueDate, incomeDate) <= 0;

  return onOrAfterToday && onOrBeforeIncome;
}

/**
 * Returns today's date normalised to start-of-day in the device's local
 * timezone. Exists so screens and hooks never accidentally pass an ad-hoc
 * `new Date()` with a stray wall-clock time into the scoring pipeline.
 */
export function today(): Date {
  return startOfDay(new Date());
}

/**
 * True when two dates fall on the same calendar day in local time.
 * Thin alias over date-fns to keep call sites readable at consumer sites.
 */
export function isSameCalendarDay(a: Date, b: Date): boolean {
  return differenceInCalendarDays(a, b) === 0;
}
