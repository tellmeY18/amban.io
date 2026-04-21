/**
 * utils/formatters.ts — user-facing string formatters.
 *
 * Source of truth: CLAUDE.md Appendix A (INR Formatting Utility).
 * All money, date, and number formatting the UI renders should go through
 * this module. Never call Intl.NumberFormat or toLocaleString directly from
 * components — funnel everything here so tone and locale stay consistent.
 *
 * v1 is en-IN / INR only. When we localise (future scope), the locale +
 * currency arguments move up to a single settings-driven source.
 */

import {
  differenceInCalendarDays,
  format,
  isThisYear,
  isToday,
  isYesterday,
  parseISO,
} from "date-fns";

/** ISO 4217 code for the Indian rupee. v1 is INR-only. */
const DEFAULT_CURRENCY = "INR";

/** BCP-47 locale tag. Uses the Indian numbering system (lakhs / crores). */
const DEFAULT_LOCALE = "en-IN";

/**
 * Formats a rupee amount for display.
 *
 * @param amount  The value in rupees (not paise).
 * @param compact When true, collapses large values to K / L suffixes
 *                for use in constrained spots (chips, badges, chart axes).
 *                Defaults to false — long-form everywhere else.
 *
 * @example
 *   formatINR(1234)          // "₹1,234"
 *   formatINR(125000)        // "₹1,25,000"
 *   formatINR(125000, true)  // "₹1.3L"
 *   formatINR(4500,   true)  // "₹4.5K"
 */
export function formatINR(amount: number, compact = false): string {
  if (!Number.isFinite(amount)) {
    return "—";
  }

  if (compact) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";

    if (abs >= 10_000_000) {
      return `${sign}₹${(abs / 10_000_000).toFixed(1)}Cr`;
    }
    if (abs >= 100_000) {
      return `${sign}₹${(abs / 100_000).toFixed(1)}L`;
    }
    if (abs >= 1_000) {
      return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
    }
  }

  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: DEFAULT_CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formats a plain integer with Indian digit grouping (no currency symbol).
 * Useful for raw counts — streak days, log counts, etc.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Formats a percentage for insight copy. Rounds to a whole number by
 * default; pass `fractionDigits` for finer control.
 *
 * @example
 *   formatPercent(0.324)   // "32%"
 *   formatPercent(32.4, 1) // "32.4%" (when the caller already has a %)
 */
export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  // Accept either a 0–1 ratio or a human percent. Anything above 1.5 we
  // assume is already a percent; below, we treat as a ratio. This matches
  // the call sites in insightGenerators.ts (§11).
  const asPercent = Math.abs(value) <= 1.5 ? value * 100 : value;
  return `${asPercent.toFixed(fractionDigits)}%`;
}

/**
 * Relative, human-friendly date labels for list rows and chips.
 *   Today               → "Today"
 *   Yesterday           → "Yesterday"
 *   Within this year    → "Mon, 4 Aug"
 *   Any other year      → "4 Aug 2024"
 *
 * Accepts either a Date or an ISO string (both YYYY-MM-DD and full ISO).
 */
export function formatDateLabel(input: Date | string): string {
  const date = typeof input === "string" ? parseISO(input) : input;
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isThisYear(date)) return format(date, "EEE, d MMM");
  return format(date, "d MMM yyyy");
}

/**
 * "in N days" / "N days ago" label. Used by upcoming payment chips,
 * income countdowns, and backfill prompts.
 *
 * @example
 *   formatRelativeDays(new Date(), addDays(new Date(), 2))  // "in 2 days"
 *   formatRelativeDays(new Date(), addDays(new Date(), 0))  // "today"
 *   formatRelativeDays(new Date(), subDays(new Date(), 3))  // "3 days ago"
 */
export function formatRelativeDays(from: Date, to: Date): string {
  const diff = differenceInCalendarDays(to, from);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

/**
 * HH:MM (24h) → 9:00 PM style for the notification-time row in Settings.
 * The underlying storage format stays 24h; this is display-only.
 */
export function formatTime12h(time24: string): string {
  // Accept "HH:MM" or "H:MM".
  const match = /^(\d{1,2}):(\d{2})$/.exec(time24.trim());
  if (!match) return time24;

  const hour24 = Number(match[1]);
  const minute = match[2];
  if (Number.isNaN(hour24) || hour24 < 0 || hour24 > 23) return time24;

  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}

/**
 * Time-of-day greeting for the Home screen header.
 * Thresholds are deliberately simple and Indian-English toned.
 */
export function greetingForHour(hour: number): "Good morning" | "Good afternoon" | "Good evening" | "Good night" {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}
