/**
 * hooks/useInsights.ts — Insights generation hook.
 *
 * Phase 1 scaffolding only. The real implementation lands in Phase 11 per
 * CLAUDE.md §11 (Insights Engine) and Appendix D (Insight Thresholds).
 *
 * Responsibilities once wired:
 *   - Run every generator in utils/insightGenerators.ts (one per insight
 *     defined in §11.1–§11.9). Each generator is pure and returns either
 *     null (not applicable) or a structured Insight payload.
 *   - Filter out insights the user has swipe-dismissed within the TTL
 *     window (INSIGHT_DISMISS_TTL_HOURS from Appendix D). The dismissed
 *     list lives in Capacitor Preferences, not SQLite.
 *   - Sort by priority per §11.10: warnings > time-sensitive > informational.
 *   - Cap the Home carousel at HOME_CAROUSEL_MAX (Appendix D). The full
 *     Insights screen shows everything, so callers pass { capped: false }.
 *
 * UI should never call generators directly — always consume this hook.
 */

/** Stable identifier per insight type. Persisted in the dismissed-list. */
export type InsightId =
  | "lifestyle-cost"
  | "savings-rate"
  | "streak"
  | "biggest-cost"
  | "projected-month-end"
  | "best-worst-day"
  | "lifestyle-upgrade"
  | "coffee-math"
  | "income-countdown";

/**
 * Priority buckets. Lower number = shown first.
 *   0 — Warnings (overspend streak, projected negative, critical score).
 *   1 — Time-sensitive (upcoming income, upcoming payment).
 *   2 — Informational (streak, coffee math, best/worst day).
 */
export type InsightPriority = 0 | 1 | 2;

/** The tonal treatment a card should render with. */
export type InsightTone = "positive" | "neutral" | "warning" | "critical";

export interface Insight {
  id: InsightId;
  priority: InsightPriority;
  tone: InsightTone;
  headline: string;
  supporting?: string;
  /** Ionicon name, resolved via constants/icons at render time. */
  icon: string;
}

export interface UseInsightsOptions {
  /**
   * When true (default), caps the returned list at HOME_CAROUSEL_MAX
   * from Appendix D. The full Insights screen passes false.
   */
  capped?: boolean;
}

export interface UseInsightsResult {
  insights: Insight[];
  loading: boolean;
  dismiss: (id: InsightId) => Promise<void>;
}

/**
 * Returns the currently applicable insights, sorted and filtered.
 *
 * Not implemented yet — returns an empty list so consumers can type against
 * the real shape while Phase 11 is under construction.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useInsights(_options: UseInsightsOptions = {}): UseInsightsResult {
  // TODO(phase-11):
  //   1. Pull inputs: score hook, finance store, daily store, dismissed list
  //      from Capacitor Preferences.
  //   2. Invoke every generator in utils/insightGenerators.ts. Each one reads
  //      its thresholds from constants/insightThresholds.ts.
  //   3. Drop nulls; drop any insight whose id is dismissed and still inside
  //      INSIGHT_DISMISS_TTL_HOURS.
  //   4. Sort by priority asc, then by generator order for stability.
  //   5. If options.capped (default true), slice to HOME_CAROUSEL_MAX.
  //   6. Memoize on the minimal dependency set.

  return {
    insights: [],
    loading: false,
    dismiss: async () => {
      throw new Error(
        "useInsights.dismiss() not implemented yet — landing in Phase 11.",
      );
    },
  };
}
