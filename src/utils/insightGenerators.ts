/**
 * utils/insightGenerators.ts — pure insight generator functions.
 *
 * Source of truth: CLAUDE.md §11 (Insights Engine §11.1–§11.9) and
 * Appendix D (Insight Thresholds).
 *
 * Design rules:
 *   - Every generator is a pure function of its inputs. No store reads,
 *     no DOM, no Date.now() — all "now" values come through `ctx.today`.
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

import { differenceInCalendarDays, parseISO } from "date-fns";

import type { Insight } from "../hooks/useInsights";

import {
  COFFEE_MATH_PRODUCTS,
  COFFEE_MATH_THRESHOLDS,
  INCOME_COUNTDOWN_DAYS,
  OVERSPEND_STREAK_DAYS,
  SAVINGS_BUFFER_PCT,
  SAVINGS_RATE_AMBER,
  SAVINGS_RATE_GREEN,
  STREAK_MIN_DAYS,
} from "../constants/insightThresholds";
import { Icons } from "../theme/icons";
import { formatDateLabel, formatINR, formatNumber, formatPercent } from "../utils/formatters";

/**
 * Everything a generator needs to compute its verdict. The hook
 * assembles this object once per render pass and hands the same
 * reference to every generator so the work is cheap and deterministic.
 */
export interface InsightContext {
  /** "Today" in the user's local calendar (start-of-day). */
  today: Date;

  /** Current Amban Score + supporting metrics (from useAmbanScore). */
  score: {
    score: number;
    daysLeft: number;
    effectiveBalance: number;
    upcomingRecurring: number;
    nextIncomeDate: Date | null;
    projectedNegative: boolean;
  };

  /** Active income sources (hook has already filtered out inactive). */
  incomeSources: ReadonlyArray<{
    id: number;
    label: string;
    amount: number;
    creditDay: number;
  }>;

  /** Active recurring payments (hook has already filtered out inactive). */
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

/* ------------------------------------------------------------------
 * Shared helpers
 *
 * Kept local so generators stay drop-in pure. A few of these duplicate
 * logic in the scoring module; we intentionally re-derive here rather
 * than import, because the scoring module's inputs are a different
 * shape and mixing the two would couple insights to scoring's internals.
 * ------------------------------------------------------------------ */

/**
 * Mean spend over the rolling window. Uses `logs.length` (not the
 * nominal window size) as the denominator so a user with 5 days of
 * data gets a meaningful average rather than a 30-day dilution.
 */
function avgDailySpend(logs: InsightContext["logs"]): number {
  if (logs.length === 0) return 0;
  let total = 0;
  for (const log of logs) total += log.spent;
  return total / logs.length;
}

/**
 * Total monthly income across every active source. Each source
 * credits once per month, so `sum(amount)` is the correct answer.
 */
function monthlyIncomeTotal(sources: InsightContext["incomeSources"]): number {
  let total = 0;
  for (const source of sources) total += source.amount;
  return total;
}

/**
 * Total monthly recurring cost across every active payment.
 */
function monthlyRecurringTotal(recurring: InsightContext["recurringPayments"]): number {
  let total = 0;
  for (const payment of recurring) total += payment.amount;
  return total;
}

/* ==================================================================
 * §11.1 — Lifestyle Cost
 * "At ₹X/day, you'd ideally earn ₹Y/month."
 *
 * Needs a reasonable sample before it's meaningful — we require at
 * least STREAK_MIN_DAYS of logs (same floor the other trend insights
 * use). Priority 2 — informational, tone neutral.
 * ================================================================== */
export const lifestyleCostInsight: InsightGenerator = (ctx) => {
  if (ctx.logs.length < STREAK_MIN_DAYS) return null;

  const daily = avgDailySpend(ctx.logs);
  if (daily <= 0) return null;

  const projectedMonthlySpend = daily * 30;
  const recurring = monthlyRecurringTotal(ctx.recurringPayments);
  const buffer = projectedMonthlySpend * (SAVINGS_BUFFER_PCT / 100);
  const idealIncome = projectedMonthlySpend + recurring + buffer;

  const insight: Insight = {
    id: "lifestyle-cost",
    priority: 2,
    tone: "neutral",
    headline: `At ${formatINR(Math.round(daily))}/day, your ideal monthly income is ${formatINR(Math.round(idealIncome))}.`,
    supporting: `Covers your recurring bills plus a ${SAVINGS_BUFFER_PCT}% savings buffer.`,
    icon: Icons.finance.wallet,
  };
  return insight;
};

/* ==================================================================
 * §11.2 — Savings Rate
 * "You're saving ~X% of your income this month."
 *
 * Tone gated by SAVINGS_RATE_GREEN / SAVINGS_RATE_AMBER. Priority 2 —
 * informational when rate is healthy; drops to 0 (warning) when rate
 * is negative, since that's actionable.
 * ================================================================== */
export const savingsRateInsight: InsightGenerator = (ctx) => {
  const monthlyIncome = monthlyIncomeTotal(ctx.incomeSources);
  if (monthlyIncome <= 0) return null;

  // Avg-daily-based projection is noisy on day 1. Require a minimum
  // sample so we don't brand a brand-new user "below 15%" because
  // they happened to log ₹3,000 on their first day.
  if (ctx.logs.length < STREAK_MIN_DAYS) return null;

  const daily = avgDailySpend(ctx.logs);
  const monthlySpend = monthlyRecurringTotal(ctx.recurringPayments) + daily * 30;
  const rate = ((monthlyIncome - monthlySpend) / monthlyIncome) * 100;

  // Clamp to the range that makes sense to surface. A rate beyond
  // +100% or below -500% is almost always a data-entry mistake; we
  // still compute it, but we don't want to assign a warning tone to
  // garbage inputs.
  const displayRate = Math.max(-500, Math.min(100, rate));

  let tone: Insight["tone"] = "neutral";
  let supporting = "Decent — but there's room to grow.";
  if (rate >= SAVINGS_RATE_GREEN) {
    tone = "positive";
    supporting = "Great discipline. Keep going.";
  } else if (rate < SAVINGS_RATE_AMBER) {
    tone = rate < 0 ? "critical" : "warning";
    supporting =
      rate < 0
        ? "You're spending more than you earn this month."
        : "Below a comfortable savings cushion.";
  }

  const insight: Insight = {
    id: "savings-rate",
    priority: rate < 0 ? 0 : 2,
    tone,
    headline: `You're saving ~${formatPercent(displayRate)} of your income this month.`,
    supporting,
    icon: Icons.finance.trophy,
  };
  return insight;
};

/* ==================================================================
 * §11.3 — Streak
 * "🔥 N-day streak of spending within your score."
 *
 * Walks logs newest-first; counts consecutive days where
 * spent <= scoreAtLog. Stops at the first gap or over-score day.
 * Requires STREAK_MIN_DAYS before surfacing.
 * ================================================================== */
export const streakInsight: InsightGenerator = (ctx) => {
  if (ctx.logs.length < STREAK_MIN_DAYS) return null;

  let streak = 0;
  let previousIso: string | null = null;
  for (const log of ctx.logs) {
    // Require a stored scoreAtLog — a legacy row with null score
    // can't be classified, so it breaks the streak.
    if (log.scoreAtLog == null) break;
    if (log.spent > log.scoreAtLog) break;

    // Adjacency check: each successive log must be the previous day
    // exactly. A missed day breaks the streak (the user didn't stay
    // on track every day — they stopped logging).
    if (previousIso) {
      const prev = parseISO(previousIso);
      const current = parseISO(log.logDate);
      const gap = differenceInCalendarDays(prev, current);
      if (gap !== 1) break;
    }

    streak += 1;
    previousIso = log.logDate;
  }

  if (streak < STREAK_MIN_DAYS) return null;

  const insight: Insight = {
    id: "streak",
    priority: 2,
    tone: "positive",
    headline: `🔥 ${formatNumber(streak)}-day streak within your score!`,
    supporting:
      streak >= 14
        ? "You've built a real habit. Respect."
        : "Keep logging to extend it — every day counts.",
    icon: Icons.status.streak,
  };
  return insight;
};

/* ==================================================================
 * §11.4 — Biggest Cost
 * "[Label] takes up N% of your monthly income."
 *
 * Tone switches to warning when the single biggest line item exceeds
 * 50% of monthly income — that's a lifestyle-level signal that
 * deserves attention.
 * ================================================================== */
export const biggestCostInsight: InsightGenerator = (ctx) => {
  if (ctx.recurringPayments.length === 0) return null;

  const monthlyIncome = monthlyIncomeTotal(ctx.incomeSources);
  if (monthlyIncome <= 0) return null;

  // Walk the list once rather than sorting — we only need the max.
  let top = ctx.recurringPayments[0];
  if (!top) return null;
  for (const payment of ctx.recurringPayments) {
    if (payment.amount > top.amount) top = payment;
  }

  const pct = (top.amount / monthlyIncome) * 100;
  if (!Number.isFinite(pct)) return null;

  const tone: Insight["tone"] = pct >= 50 ? "warning" : pct >= 30 ? "neutral" : "neutral";
  const insight: Insight = {
    id: "biggest-cost",
    priority: 2,
    tone,
    headline: `${top.label} takes up ${formatPercent(pct)} of your monthly income.`,
    supporting:
      pct >= 50
        ? "That's a big share — keep an eye on lifestyle creep."
        : `${formatINR(top.amount)} per month across ${ctx.recurringPayments.length} recurring bills.`,
    icon: Icons.finance.pie,
  };
  return insight;
};

/* ==================================================================
 * §11.5 — Projected Month-End Balance
 * "At this pace, you'll end the month with ₹X."
 *
 * Uses the live score result so "upcomingRecurring" and "daysLeft"
 * already reflect the §13 edge cases. Tone becomes "critical" when
 * the projection lands negative.
 * ================================================================== */
export const projectedMonthEndInsight: InsightGenerator = (ctx) => {
  if (ctx.score.nextIncomeDate == null) return null;
  // Requires at least some history so avgDailySpend is meaningful.
  if (ctx.logs.length < STREAK_MIN_DAYS) return null;

  const daily = avgDailySpend(ctx.logs);
  const projected =
    ctx.score.effectiveBalance - ctx.score.upcomingRecurring - daily * ctx.score.daysLeft;

  const tone: Insight["tone"] =
    projected < 0 ? "critical" : projected < daily * 3 ? "warning" : "neutral";

  const insight: Insight = {
    id: "projected-month-end",
    priority: projected < 0 ? 0 : 1,
    tone,
    headline:
      projected < 0
        ? `You'll be short by ${formatINR(Math.abs(Math.round(projected)))} before your next income.`
        : `At this pace, you'll have ${formatINR(Math.max(0, Math.round(projected)))} left when your income hits.`,
    supporting:
      projected < 0
        ? "Trim today's spend or revisit upcoming bills."
        : `Based on your ${formatINR(Math.round(daily))}/day average.`,
    icon: Icons.finance.analytics,
  };
  return insight;
};

/* ==================================================================
 * §11.6 — Best & Worst Day
 * "Cheapest day was ₹X on <date>. Most expensive was ₹Y on <date>."
 *
 * Collapsed into a single card to keep the carousel tight. Zero-spend
 * days are excluded from the "cheapest" calculation — they're almost
 * always days the user simply didn't spend anything, not intentional
 * frugality moments.
 * ================================================================== */
export const bestWorstDayInsight: InsightGenerator = (ctx) => {
  if (ctx.logs.length < STREAK_MIN_DAYS) return null;

  let best: { spent: number; logDate: string } | null = null;
  let worst: { spent: number; logDate: string } | null = null;
  for (const log of ctx.logs) {
    if (log.spent > 0 && (best == null || log.spent < best.spent)) {
      best = { spent: log.spent, logDate: log.logDate };
    }
    if (worst == null || log.spent > worst.spent) {
      worst = { spent: log.spent, logDate: log.logDate };
    }
  }
  if (!best || !worst) return null;
  if (best.logDate === worst.logDate) return null;

  const insight: Insight = {
    id: "best-worst-day",
    priority: 2,
    tone: "neutral",
    headline: `Your most expensive day was ${formatINR(worst.spent)} on ${formatDateLabel(worst.logDate)}.`,
    supporting: `Cheapest was ${formatINR(best.spent)} on ${formatDateLabel(best.logDate)}.`,
    icon: Icons.finance.chart,
  };
  return insight;
};

/* ==================================================================
 * §11.7 — Lifestyle Upgrade
 * "You've been spending ₹X above your score daily. You'd need ₹Y more
 *  per month in income."
 *
 * Triggers only after OVERSPEND_STREAK_DAYS consecutive over-score
 * days. Priority 0 — a warning the user should actually see.
 * ================================================================== */
export const lifestyleUpgradeInsight: InsightGenerator = (ctx) => {
  if (ctx.logs.length < OVERSPEND_STREAK_DAYS) return null;

  let overspendTotal = 0;
  let overspendCount = 0;
  let previousIso: string | null = null;

  for (const log of ctx.logs) {
    if (log.scoreAtLog == null) break;
    if (log.spent <= log.scoreAtLog) break;
    if (previousIso) {
      const prev = parseISO(previousIso);
      const current = parseISO(log.logDate);
      const gap = differenceInCalendarDays(prev, current);
      if (gap !== 1) break;
    }
    overspendTotal += log.spent - log.scoreAtLog;
    overspendCount += 1;
    previousIso = log.logDate;
    if (overspendCount >= OVERSPEND_STREAK_DAYS * 2) break;
  }

  if (overspendCount < OVERSPEND_STREAK_DAYS) return null;

  const avgOverspend = overspendTotal / overspendCount;
  const requiredMonthly = avgOverspend * 30;

  const insight: Insight = {
    id: "lifestyle-upgrade",
    priority: 0,
    tone: "warning",
    headline: `You're spending ${formatINR(Math.round(avgOverspend))} above your score daily.`,
    supporting: `To sustain this lifestyle, you'd need about ${formatINR(Math.round(requiredMonthly))} more per month.`,
    icon: Icons.status.trendingUp,
  };
  return insight;
};

/* ==================================================================
 * §11.8 — "Coffee Math"
 * Playful translation of average spend into familiar purchases.
 * Walks COFFEE_MATH_THRESHOLDS top-down; the first match wins.
 * ================================================================== */
export const coffeeMathInsight: InsightGenerator = (ctx) => {
  if (ctx.logs.length < STREAK_MIN_DAYS) return null;

  const daily = avgDailySpend(ctx.logs);
  if (daily < 500) return null;

  let pick: (typeof COFFEE_MATH_THRESHOLDS)[number] | null = null;
  for (const threshold of COFFEE_MATH_THRESHOLDS) {
    if (daily >= threshold.minAvgDailySpend) {
      pick = threshold;
      break;
    }
  }
  if (!pick) return null;

  const cost = COFFEE_MATH_PRODUCTS[pick.product];
  const n = Math.round(daily / cost);
  if (n <= 0) return null;

  const label: Record<keyof typeof COFFEE_MATH_PRODUCTS, string> = {
    chai: `${formatNumber(n)} cups of chai at Café Coffee Day`,
    movieTicket: `${formatNumber(n)} movie tickets`,
    restaurantMeal: `${formatNumber(n)} restaurant meals`,
  };

  const insight: Insight = {
    id: "coffee-math",
    priority: 2,
    tone: "neutral",
    headline: `That's ${label[pick.product]} — every day.`,
    supporting: `Based on your average daily spend of ${formatINR(Math.round(daily))}.`,
    icon: Icons.finance.tag,
  };
  return insight;
};

/* ==================================================================
 * §11.9 — Income Day Countdown
 * Shown only when days-to-next-income <= INCOME_COUNTDOWN_DAYS.
 * ================================================================== */
export const incomeCountdownInsight: InsightGenerator = (ctx) => {
  const nextDate = ctx.score.nextIncomeDate;
  if (!nextDate) return null;

  const days = differenceInCalendarDays(nextDate, ctx.today);
  if (days < 0 || days > INCOME_COUNTDOWN_DAYS) return null;

  // Sum up every active income source crediting on that date. If
  // multiple land on the same day (§13.3), combine them.
  const nextDay = nextDate.getDate();
  let totalAmount = 0;
  for (const source of ctx.incomeSources) {
    if (source.creditDay === nextDay) totalAmount += source.amount;
  }
  if (totalAmount <= 0) return null;

  const dayWord = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${formatNumber(days)} days`;

  const insight: Insight = {
    id: "income-countdown",
    priority: 1,
    tone: "positive",
    headline: `💰 ${formatINR(Math.round(totalAmount))} landing ${dayWord}.`,
    supporting: days <= 2 ? "Remember to refresh your balance when it credits." : undefined,
    icon: Icons.finance.cash,
  };
  return insight;
};

/* ==================================================================
 * Registry
 * ==================================================================
 *
 * Order here is the stable sort tiebreaker when priorities match.
 * The hook walks this array, filters nulls, and applies dismissal /
 * capping rules on top. See useInsights for the composition logic.
 * ================================================================== */
export const INSIGHT_GENERATORS: ReadonlyArray<{
  id: Insight["id"];
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
