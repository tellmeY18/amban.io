/**
 * utils/insightGenerators.ts — pure insight generator functions.
 *
 * Phase 1 scaffolding only. The real implementations land in Phase 11 per
 * CLAUDE.md §11 (Insights Engine) and Appendix D (Insight Thresholds).
 *
 * Design rules:
 *   - Every generator is a pure function of its inputs. No store reads,
 *     no DOM, no Date.now() — all "now" values are passed in explicitly.
 *   - A generator returns either `null` (not applicable right now) or a
 *     structured Insight payload matching hooks/useInsights.ts → Insight.
 *   - Magic numbers come from constants/insightThresholds.ts. Never inline
 *     a threshold here; centralising them is the whole point of Appendix D.
 *   - One generator per §11.1–§11.9. Same order here as in the spec.
 *
 * Used by:
 *   - hooks/useInsights.ts  (Phase 11)
 *
 * UI must never call these directly — always go through useInsights().
 */

import type { Insight, InsightId } from "../hooks/useInsights";

/**
 * Everything a generator needs to compute its verdict. The hook assembles
 * this object once per render pass and hands the same reference to every
 * generator so the work is cheap and deterministic.
 */
export interface InsightContext {
  /** "Today" in the user's local calendar (start-of-day). */
  today: Date;

  /** Current Amban Score and its supporting metrics (from useAmbanScore). */
  score: {
    score: number;
    daysLeft: number;
    effectiveBalance: number;
    upcomingRecurring: number;
    nextIncomeDate: Date | null;
    projectedNegative: boolean;
  };

  /**
   * Active income sources, reduced to the fields insights read.
   * Inactive rows must be filtered out upstream by the hook.
   */
  incomeSources: ReadonlyArray<{
    id: number;
    label: string;
    amount: number;
    creditDay: number;
  }>;

  /**
   * Active recurring payments, reduced to the fields insights read.
   * Inactive rows must be filtered out upstream by the hook.
   */
  recurringPayments: ReadonlyArray<{
    id: number;
    label: string;
    amount: number;
    dueDay: number;
    category: string;
  }>;

  /**
   * Daily logs within the rolling window (AVG_WINDOW_DAYS). Newest first.
   * Empty on first-day state (§13.1) — generators that depend on logs
   * must return null in that case, not throw.
   */
  logs: ReadonlyArray<{
    logDate: string;
    spent: number;
    scoreAtLog: number | null;
  }>;
}

/** Shared signature every generator implements. */
export type InsightGenerator = (ctx: InsightContext) => Insight | null;

// ------------------------------------------------------------
// §11.1 Lifestyle Cost
// "At ₹X/day, you'd ideally earn ₹Y/month."
// Uses: AVG_WINDOW_DAYS, SAVINGS_BUFFER_PCT.
// ------------------------------------------------------------
export const lifestyleCostInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. Require at least AVG_WINDOW_DAYS logs, else return null.
  //   2. avgDailySpend = mean(logs.spent).
  //   3. monthlySpendProjection = avgDailySpend * 30.
  //   4. idealIncome = monthlySpendProjection
  //                   + sum(recurring.amount)
  //                   + (monthlySpendProjection * SAVINGS_BUFFER_PCT / 100).
  //   5. Return a priority-2 (informational), tone "neutral" card.
  return null;
};

// ------------------------------------------------------------
// §11.2 Savings Rate
// "You're saving ~X% of your income this month."
// Uses: SAVINGS_RATE_GREEN, SAVINGS_RATE_AMBER.
// ------------------------------------------------------------
export const savingsRateInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. monthlyIncome = sum(incomeSources.amount).
  //   2. monthlySpend = sum(recurring.amount) + (avgDailySpend * 30).
  //   3. rate = (monthlyIncome - monthlySpend) / monthlyIncome * 100.
  //   4. Tone: positive if >= GREEN, neutral if >= AMBER, warning otherwise.
  //   5. Priority 2 (informational).
  return null;
};

// ------------------------------------------------------------
// §11.3 Streak
// "🔥 N-day streak of spending within your score."
// Uses: STREAK_MIN_DAYS.
// ------------------------------------------------------------
export const streakInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. Walk logs newest-first; count consecutive days where
  //      spent <= scoreAtLog. Stop at the first gap or over-score day.
  //   2. If streak < STREAK_MIN_DAYS, return null.
  //   3. Priority 2 (informational), tone "positive".
  return null;
};

// ------------------------------------------------------------
// §11.4 Biggest Cost
// "[Label] takes up N% of your monthly income."
// ------------------------------------------------------------
export const biggestCostInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. Require at least one recurring AND monthlyIncome > 0.
  //   2. top = recurring sorted by amount desc [0].
  //   3. pct = top.amount / monthlyIncome * 100.
  //   4. Priority 2 (informational), tone "neutral".
  return null;
};

// ------------------------------------------------------------
// §11.5 Projected Month-End Balance
// "At this pace, you'll end the month with ₹X."
// ------------------------------------------------------------
export const projectedMonthEndInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. avgDailySpend from logs window.
  //   2. projected = effectiveBalance
  //                 - upcomingRecurring (remaining this month)
  //                 - (avgDailySpend * daysLeft)
  //                 + incomeLandingBeforeMonthEnd.
  //   3. Priority 1 (time-sensitive). Tone warning if projected < 0.
  return null;
};

// ------------------------------------------------------------
// §11.6 Best & Worst Day
// "Cheapest day was ₹X on <date>. Most expensive was ₹Y on <date>."
// ------------------------------------------------------------
export const bestWorstDayInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. Require >= STREAK_MIN_DAYS logs.
  //   2. min/max over logs.spent within the window.
  //   3. Priority 2 (informational), tone "neutral".
  return null;
};

// ------------------------------------------------------------
// §11.7 Lifestyle Upgrade
// Triggers only after OVERSPEND_STREAK_DAYS consecutive over-score days.
// "You're spending ₹X above your score daily. You'd need ₹Y more monthly."
// ------------------------------------------------------------
export const lifestyleUpgradeInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. Count consecutive days (newest-first) where spent > scoreAtLog.
  //   2. If count < OVERSPEND_STREAK_DAYS, return null.
  //   3. overspendPerDay = mean(spent - scoreAtLog) across that streak.
  //   4. requiredMonthly = overspendPerDay * 30.
  //   5. Priority 0 (warning), tone "warning".
  return null;
};

// ------------------------------------------------------------
// §11.8 "Coffee Math"
// Playful translation of average spend into familiar purchases.
// ------------------------------------------------------------
export const coffeeMathInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. avgDailySpend from logs window.
  //   2. Pick a template based on thresholds:
  //        >= 2000 → restaurant meals
  //        >= 1000 → movie tickets
  //        >= 500  → chai at CCD
  //   3. N = round(avgDailySpend / productCost).
  //   4. Priority 2 (informational), tone "neutral".
  //   5. Skip entirely when avgDailySpend < 500.
  return null;
};

// ------------------------------------------------------------
// §11.9 Income Day Countdown
// Shown only when days-to-next-income <= INCOME_COUNTDOWN_DAYS.
// ------------------------------------------------------------
export const incomeCountdownInsight: InsightGenerator = (_ctx) => {
  // TODO(phase-11):
  //   1. If score.nextIncomeDate is null, return null.
  //   2. days = calendarDaysBetween(today, nextIncomeDate).
  //   3. If days > INCOME_COUNTDOWN_DAYS, return null.
  //   4. amount = sum of incomeSources crediting on that date.
  //   5. Priority 1 (time-sensitive), tone "positive".
  return null;
};

// ------------------------------------------------------------
// Registry
// Order here is the stable sort tiebreaker when priorities match.
// The hook walks this array, filters nulls, and applies dismissal /
// capping rules on top. See useInsights for the composition logic.
// ------------------------------------------------------------
export const INSIGHT_GENERATORS: ReadonlyArray<{
  id: InsightId;
  generate: InsightGenerator;
}> = [
  { id: "lifestyle-upgrade", generate: lifestyleUpgradeInsight },
  { id: "projected-month-end", generate: projectedMonthEndInsight },
  { id: "income-countdown", generate: incomeCountdownInsight },
  { id: "streak", generate: streakInsight },
  { id: "savings-rate", generate: savingsRateInsight },
  { id: "biggest-cost", generate: biggestCostInsight },
  { id: "best-worst-day", generate: bestWorstDayInsight },
  { id: "lifestyle-cost", generate: lifestyleCostInsight },
  { id: "coffee-math", generate: coffeeMathInsight },
];
