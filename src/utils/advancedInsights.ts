/**
 * utils/advancedInsights.ts — AI-enhanced insight generators.
 *
 * These generators go beyond simple arithmetic to use statistical
 * methods and pattern recognition for richer, more actionable insights.
 * All computation is on-device — no network calls, no cloud ML.
 *
 * Techniques used:
 *   - Z-score anomaly detection (flag unusual spends)
 *   - IQR-based outlier detection
 *   - Linear regression for trend prediction
 *   - Day-of-week pattern extraction
 *   - Time-of-month spending curves
 *   - Spending velocity (rate of daily burn)
 *   - Counterparty frequency analysis (from SMS data)
 *
 * These generators complement (not replace) the base generators in
 * insightGenerators.ts. The hook (useInsights) runs both sets.
 */

import { differenceInCalendarDays, parseISO, getDay, getDate, format } from "date-fns";
import type { Insight } from "../hooks/useInsights";
import type { InsightContext } from "./insightGenerators";
import { Icons } from "../theme/icons";
import { formatINR } from "./formatters";

/* ==================================================================
 * Statistical Helpers
 * ================================================================== */

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1));
}

function zScore(value: number, avg: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - avg) / stdDev;
}

/** IQR-based outlier detection. Returns { q1, q3, iqr, lowerFence, upperFence }. */
function iqrBounds(values: number[]): {
  q1: number;
  q3: number;
  iqr: number;
  lowerFence: number;
  upperFence: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)] ?? 0;
  const q3 = sorted[Math.floor(n * 0.75)] ?? 0;
  const iqr = q3 - q1;
  return {
    q1,
    q3,
    iqr,
    lowerFence: q1 - 1.5 * iqr,
    upperFence: q3 + 1.5 * iqr,
  };
}

/** Simple linear regression: returns { slope, intercept, r2 }. */
function linearRegression(points: Array<{ x: number; y: number }>): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = points.length;
  if (n < 3) return { slope: 0, intercept: 0, r2: 0 };

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const ssRes = points.reduce((sum, p) => sum + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const ssTot = points.reduce((sum, p) => sum + (p.y - sumY / n) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2 };
}

/* ==================================================================
 * Extended InsightContext — includes SMS suggestion data
 * ================================================================== */

export interface AdvancedInsightContext extends InsightContext {
  /** Recent SMS suggestions (accepted) for counterparty analysis. */
  recentTransactions?: ReadonlyArray<{
    amount: number;
    direction: "debit" | "credit";
    counterparty: string | null;
    receivedAt: string;
  }>;
}

export type AdvancedInsightGenerator = (ctx: AdvancedInsightContext) => Insight | null;

/* ==================================================================
 * §A1 — Anomaly Detection
 * "⚠️ Yesterday's spend (₹X) was unusually high — 2.3x your average."
 *
 * Uses z-score analysis. Triggers when the most recent log has a
 * z-score > 2.0 (i.e., more than 2 standard deviations above mean).
 * ================================================================== */
export const anomalyDetectionInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 7) return null; // Need at least a week of data

  const spends = ctx.logs.map((l) => l.spent).filter((s) => s > 0);
  if (spends.length < 7) return null;

  const latestSpend = spends[0]; // Newest first
  if (!latestSpend || latestSpend === 0) return null;

  const avg = mean(spends);
  const stdDev = standardDeviation(spends);
  const z = zScore(latestSpend, avg, stdDev);

  if (z < 2.0) return null; // Not anomalous

  const multiplier = (latestSpend / avg).toFixed(1);

  return {
    id: "anomaly-detection" as Insight["id"],
    priority: 0,
    tone: "warning",
    headline: `⚠️ Your last logged spend was ${multiplier}x your average.`,
    supporting: `${formatINR(Math.round(latestSpend))} vs your typical ${formatINR(Math.round(avg))}/day. Worth reviewing.`,
    icon: Icons.status.alert,
  };
};

/* ==================================================================
 * §A2 — Weekend vs Weekday Pattern
 * "You spend 40% more on weekends (₹2,100/day vs ₹1,500/day)."
 *
 * Splits logs by day-of-week and compares the averages.
 * ================================================================== */
export const weekendPatternInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 14) return null; // Need 2 weeks minimum

  const weekdaySpends: number[] = [];
  const weekendSpends: number[] = [];

  for (const log of ctx.logs) {
    const date = parseISO(log.logDate);
    const dow = getDay(date); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) {
      weekendSpends.push(log.spent);
    } else {
      weekdaySpends.push(log.spent);
    }
  }

  if (weekdaySpends.length < 5 || weekendSpends.length < 3) return null;

  const weekdayAvg = mean(weekdaySpends);
  const weekendAvg = mean(weekendSpends);

  if (weekdayAvg <= 0) return null;

  const ratio = weekendAvg / weekdayAvg;

  // Only surface if there's a meaningful difference (>25%)
  if (ratio < 1.25 && ratio > 0.75) return null;

  const pctDiff = Math.round((ratio - 1) * 100);
  const isWeekendHigher = ratio > 1;

  return {
    id: "weekend-pattern" as Insight["id"],
    priority: 2,
    tone: isWeekendHigher && pctDiff > 50 ? "warning" : "neutral",
    headline: isWeekendHigher
      ? `You spend ${pctDiff}% more on weekends.`
      : `You spend ${Math.abs(pctDiff)}% less on weekends.`,
    supporting: `Weekend avg: ${formatINR(Math.round(weekendAvg))}/day • Weekday avg: ${formatINR(Math.round(weekdayAvg))}/day.`,
    icon: Icons.status.calendar,
  };
};

/* ==================================================================
 * §A3 — Month-End Crunch Pattern
 * "You tend to overspend in the last week of the month."
 *
 * Splits the month into 4 periods and checks if the last period
 * has significantly higher average spend.
 * ================================================================== */
export const monthEndCrunchInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 20) return null;

  const early: number[] = []; // Days 1-7
  const mid: number[] = []; // Days 8-21
  const late: number[] = []; // Days 22-31

  for (const log of ctx.logs) {
    const day = getDate(parseISO(log.logDate));
    if (day <= 7) early.push(log.spent);
    else if (day <= 21) mid.push(log.spent);
    else late.push(log.spent);
  }

  if (early.length < 3 || mid.length < 5 || late.length < 3) return null;

  const lateAvg = mean(late);
  const overallAvg = mean([...early, ...mid, ...late]);

  // Check if late-month spend is significantly higher
  const lateRatio = lateAvg / overallAvg;
  if (lateRatio < 1.3) return null; // Not significant

  const pctAbove = Math.round((lateRatio - 1) * 100);

  return {
    id: "month-end-crunch" as Insight["id"],
    priority: 1,
    tone: "warning",
    headline: `📅 Your month-end spending is ${pctAbove}% above average.`,
    supporting: `Last 10 days: ${formatINR(Math.round(lateAvg))}/day vs ${formatINR(Math.round(overallAvg))}/day overall. Pre-plan to stay on track.`,
    icon: Icons.status.calendar,
  };
};

/* ==================================================================
 * §A4 — Spending Velocity Alert
 * "You've burned through 70% of today's score already and it's 2 PM."
 *
 * For real-time alerting: checks if the accumulated spend today
 * relative to the score suggests the user is on pace to overshoot.
 * This works best with SMS auto-accept providing real-time data.
 * ================================================================== */
export const spendingVelocityInsight: AdvancedInsightGenerator = (ctx) => {
  // This insight works with today's data
  const todayLogs = ctx.logs.filter((l) => l.logDate === format(ctx.today, "yyyy-MM-dd"));
  if (todayLogs.length === 0) return null;

  const todaySpent = todayLogs.reduce((sum, l) => sum + l.spent, 0);
  const score = ctx.score.score;

  if (score <= 0) return null;

  const ratio = todaySpent / score;

  // Only trigger if significantly over pace (>80% of daily budget used)
  if (ratio < 0.8) return null;

  const pct = Math.round(ratio * 100);

  if (ratio >= 1.5) {
    return {
      id: "spending-velocity" as Insight["id"],
      priority: 0,
      tone: "critical",
      headline: `🚨 You've spent ${pct}% of your daily budget today.`,
      supporting: `${formatINR(Math.round(todaySpent))} spent vs your score of ${formatINR(Math.round(score))}.`,
      icon: Icons.status.alert,
    };
  }

  return {
    id: "spending-velocity" as Insight["id"],
    priority: 1,
    tone: "warning",
    headline: `⚡ ${pct}% of today's budget used.`,
    supporting: `${formatINR(Math.round(todaySpent))} of ${formatINR(Math.round(score))} — pace yourself for the rest of the day.`,
    icon: Icons.status.trendingUp,
  };
};

/* ==================================================================
 * §A5 — Spending Trend Direction
 * "📈 Your daily spend is trending up 15% week-over-week."
 *
 * Uses linear regression on the last 14–30 days to detect if
 * spending is accelerating, decelerating, or flat.
 * ================================================================== */
export const spendingTrendInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 10) return null;

  // Build regression points: x = days-ago (0 = today), y = spend
  const points: Array<{ x: number; y: number }> = [];
  for (const log of ctx.logs) {
    const daysAgo = differenceInCalendarDays(ctx.today, parseISO(log.logDate));
    if (daysAgo >= 0 && daysAgo <= 30) {
      points.push({ x: daysAgo, y: log.spent });
    }
  }

  if (points.length < 10) return null;

  const { slope, r2 } = linearRegression(points);

  // slope is negative when spending is increasing (because x = days ago, more recent = smaller x)
  // Actually no — x = daysAgo, so higher x = older. If slope is positive, older days had more spend.
  // If slope is negative, recent days have more spend (spending increasing).
  const dailyChange = -slope; // Positive = spending growing
  const avgSpend = mean(points.map((p) => p.y));

  if (avgSpend <= 0) return null;
  if (r2 < 0.15) return null; // Trend not strong enough to be meaningful

  const weeklyChangePct = ((dailyChange * 7) / avgSpend) * 100;

  // Only surface if the trend is meaningful (>10% change per week)
  if (Math.abs(weeklyChangePct) < 10) return null;

  const isIncreasing = weeklyChangePct > 0;

  return {
    id: "spending-trend" as Insight["id"],
    priority: isIncreasing ? 1 : 2,
    tone: isIncreasing ? "warning" : "positive",
    headline: isIncreasing
      ? `📈 Spending is trending up ${Math.round(weeklyChangePct)}% week-over-week.`
      : `📉 Spending is trending down ${Math.abs(Math.round(weeklyChangePct))}% week-over-week.`,
    supporting: isIncreasing
      ? `Your daily average is creeping higher. Consider reviewing recent habits.`
      : `Great progress — you're spending less than you were a week ago.`,
    icon: isIncreasing ? Icons.status.trendingUp : Icons.status.trendingDown,
  };
};

/* ==================================================================
 * §A6 — Top Merchant / Counterparty
 * "Swiggy is your #1 spend — ₹4,200 across 12 orders this month."
 *
 * Requires SMS suggestion data (accepted transactions with
 * counterparty info).
 * ================================================================== */
export const topMerchantInsight: AdvancedInsightGenerator = (ctx) => {
  if (!ctx.recentTransactions || ctx.recentTransactions.length < 5) return null;

  // Group by counterparty
  const merchantTotals = new Map<string, { total: number; count: number }>();

  for (const txn of ctx.recentTransactions) {
    if (!txn.counterparty || txn.direction !== "debit") continue;
    const name = txn.counterparty.toLowerCase().trim();
    if (name.length < 2) continue;

    const existing = merchantTotals.get(name) ?? { total: 0, count: 0 };
    existing.total += txn.amount;
    existing.count += 1;
    merchantTotals.set(name, existing);
  }

  if (merchantTotals.size === 0) return null;

  // Find the top merchant by total spend
  let topName = "";
  let topData = { total: 0, count: 0 };
  for (const [name, data] of merchantTotals) {
    if (data.total > topData.total) {
      topName = name;
      topData = data;
    }
  }

  if (topData.count < 3) return null; // Need at least 3 transactions

  // Capitalize first letter of each word
  const displayName = topName
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return {
    id: "top-merchant" as Insight["id"],
    priority: 2,
    tone: "neutral",
    headline: `${displayName} is your #1 spend — ${formatINR(Math.round(topData.total))} across ${topData.count} transactions.`,
    supporting: `That's ${formatINR(Math.round(topData.total / topData.count))} per transaction on average.`,
    icon: Icons.finance.tag,
  };
};

/* ==================================================================
 * §A7 — Savings Potential Calculator
 * "If you cut your top spend by 20%, you'd save ₹2,400/month."
 *
 * Identifies the largest discretionary spending category and shows
 * what a modest reduction would yield over a month.
 * ================================================================== */
export const savingsPotentialInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 14) return null;

  const spends = ctx.logs.map((l) => l.spent).filter((s) => s > 0);
  if (spends.length < 10) return null;

  const { upperFence } = iqrBounds(spends);

  // Count "high-spend" days (above the IQR upper fence)
  const highDays = spends.filter((s) => s > upperFence);
  if (highDays.length < 3) return null;

  const avgHighDay = mean(highDays);
  // What if those high days were just at the upper fence?
  const potentialDailySaving = avgHighDay - upperFence;
  const monthlyPotential = potentialDailySaving * highDays.length; // Conservative

  if (monthlyPotential < 500) return null; // Not worth surfacing

  return {
    id: "savings-potential" as Insight["id"],
    priority: 2,
    tone: "neutral",
    headline: `💡 Potential monthly savings: ${formatINR(Math.round(monthlyPotential))}.`,
    supporting: `You have ${highDays.length} high-spend days averaging ${formatINR(Math.round(avgHighDay))}. Even a small trim adds up.`,
    icon: Icons.finance.wallet,
  };
};

/* ==================================================================
 * §A8 — Payday Splurge Detection
 * "You spent 3x your average in the 2 days after payday."
 *
 * Identifies a pattern of elevated spending immediately after income
 * credits. Classic behavioral finance nudge.
 * ================================================================== */
export const paydaySplurgeInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 14) return null;
  if (ctx.incomeSources.length === 0) return null;

  const creditDays = ctx.incomeSources.map((s) => s.creditDay);
  const allSpends = ctx.logs.map((l) => l.spent).filter((s) => s > 0);
  if (allSpends.length === 0) return null;

  // Check logs that fall on creditDay or 1-2 days after
  const postPaydaySpends: number[] = [];
  const normalSpends: number[] = [];

  for (const log of ctx.logs) {
    const date = parseISO(log.logDate);
    const dayOfMonth = getDate(date);
    const isPostPayday = creditDays.some(
      (cd) => dayOfMonth === cd || dayOfMonth === cd + 1 || dayOfMonth === cd + 2,
    );

    if (isPostPayday) {
      postPaydaySpends.push(log.spent);
    } else {
      normalSpends.push(log.spent);
    }
  }

  if (postPaydaySpends.length < 2 || normalSpends.length < 7) return null;

  const postPaydayAvg = mean(postPaydaySpends);
  const normalAvg = mean(normalSpends);

  if (normalAvg <= 0) return null;
  const ratio = postPaydayAvg / normalAvg;

  if (ratio < 1.8) return null; // Not significant enough

  const multiplier = ratio.toFixed(1);

  return {
    id: "payday-splurge" as Insight["id"],
    priority: 1,
    tone: "warning",
    headline: `💸 Payday effect: you spend ${multiplier}x more right after income.`,
    supporting: `Post-payday: ${formatINR(Math.round(postPaydayAvg))}/day vs normal ${formatINR(Math.round(normalAvg))}/day. Try a 24hr "cooling off" rule.`,
    icon: Icons.finance.cash,
  };
};

/* ==================================================================
 * §A9 — Consistency Score
 * "Your spending consistency is 78% — you're pretty predictable."
 *
 * Low volatility = high consistency. Uses coefficient of variation.
 * Good for users who want stability in their budgeting.
 * ================================================================== */
export const consistencyScoreInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 14) return null;

  const spends = ctx.logs.map((l) => l.spent).filter((s) => s > 0);
  if (spends.length < 10) return null;

  const avg = mean(spends);
  const stdDev = standardDeviation(spends);

  if (avg <= 0) return null;

  // Coefficient of variation (lower = more consistent)
  const cv = stdDev / avg;

  // Convert to a 0–100 "consistency score" (inverse of CV, capped)
  const consistency = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));

  // Only surface if there's something interesting to say
  if (consistency >= 50 && consistency <= 80) return null; // Mid-range, not interesting

  let tone: Insight["tone"] = "neutral";
  let headline: string;
  let supporting: string;

  if (consistency >= 80) {
    tone = "positive";
    headline = `🎯 Spending consistency: ${consistency}%. Rock solid.`;
    supporting = "Your daily spend is very predictable — that's great for budgeting.";
  } else if (consistency < 30) {
    tone = "warning";
    headline = `🎢 Spending consistency: ${consistency}%. Quite volatile.`;
    supporting = `Your spend swings from ${formatINR(Math.round(avg - stdDev))} to ${formatINR(Math.round(avg + stdDev))} regularly. More stability = better planning.`;
  } else {
    headline = `📊 Spending consistency: ${consistency}%.`;
    supporting = "Your daily spend has moderate variation.";
  }

  return {
    id: "consistency-score" as Insight["id"],
    priority: 2,
    tone,
    headline,
    supporting,
    icon: Icons.finance.analytics,
  };
};

/* ==================================================================
 * §A10 — Week-over-Week Comparison
 * "This week: ₹8,400 spent. Last week: ₹7,200. (+17%)"
 *
 * Simple but effective — gives the user a concrete comparison.
 * ================================================================== */
export const weekOverWeekInsight: AdvancedInsightGenerator = (ctx) => {
  if (ctx.logs.length < 10) return null;

  // Split into this-week and last-week
  const thisWeek: number[] = [];
  const lastWeek: number[] = [];

  for (const log of ctx.logs) {
    const daysAgo = differenceInCalendarDays(ctx.today, parseISO(log.logDate));
    if (daysAgo >= 0 && daysAgo < 7) {
      thisWeek.push(log.spent);
    } else if (daysAgo >= 7 && daysAgo < 14) {
      lastWeek.push(log.spent);
    }
  }

  if (thisWeek.length < 3 || lastWeek.length < 5) return null;

  const thisWeekTotal = thisWeek.reduce((s, v) => s + v, 0);
  const lastWeekTotal = lastWeek.reduce((s, v) => s + v, 0);

  if (lastWeekTotal <= 0) return null;

  // Normalize to per-day for fair comparison if different number of days
  const thisWeekDaily = thisWeekTotal / thisWeek.length;
  const lastWeekDaily = lastWeekTotal / lastWeek.length;

  const changePct = Math.round(((thisWeekDaily - lastWeekDaily) / lastWeekDaily) * 100);

  // Only surface if change is meaningful (>10%)
  if (Math.abs(changePct) < 10) return null;

  const isUp = changePct > 0;

  return {
    id: "week-over-week" as Insight["id"],
    priority: 2,
    tone: isUp && changePct > 30 ? "warning" : isUp ? "neutral" : "positive",
    headline: isUp
      ? `📊 Spending is up ${changePct}% vs last week.`
      : `📊 Spending is down ${Math.abs(changePct)}% vs last week.`,
    supporting: `This week: ~${formatINR(Math.round(thisWeekDaily))}/day • Last week: ~${formatINR(Math.round(lastWeekDaily))}/day.`,
    icon: Icons.finance.chart,
  };
};

/* ==================================================================
 * Registry — Advanced Insight Generators
 * ================================================================== */
export const ADVANCED_INSIGHT_GENERATORS: ReadonlyArray<{
  id: string;
  generate: AdvancedInsightGenerator;
}> = [
  { id: "anomaly-detection", generate: anomalyDetectionInsight },
  { id: "spending-velocity", generate: spendingVelocityInsight },
  { id: "spending-trend", generate: spendingTrendInsight },
  { id: "weekend-pattern", generate: weekendPatternInsight },
  { id: "month-end-crunch", generate: monthEndCrunchInsight },
  { id: "payday-splurge", generate: paydaySplurgeInsight },
  { id: "week-over-week", generate: weekOverWeekInsight },
  { id: "top-merchant", generate: topMerchantInsight },
  { id: "savings-potential", generate: savingsPotentialInsight },
  { id: "consistency-score", generate: consistencyScoreInsight },
];
