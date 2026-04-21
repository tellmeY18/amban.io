/**
 * hooks/useAmbanScore.ts — Amban Score calculation hook.
 *
 * Source of truth: CLAUDE.md §7 (Core Business Logic), §8 (The Amban
 * Score), §13 (Edge Cases & Rules), and Appendix B (Score Calculation
 * Function).
 *
 * Responsibilities:
 *   - Pull the relevant slices from userStore, financeStore, and
 *     dailyStore on every render.
 *   - Compute `spendSinceLastSnapshot` from the loaded logs + the
 *     latest balance snapshot date, plus `manualCredits` landed since
 *     the same date (they boost effective balance symmetrically to
 *     how daily spend reduces it).
 *   - Delegate the math to the pure `calculateAmbanScore()` function
 *     in utils/scoring.ts. This hook only orchestrates inputs and
 *     decorates the output with a `status` and a `warnings` list.
 *   - Derive `status` (healthy / watch / critical) by comparing today's
 *     score to the rolling 30-day average of previously-logged scores.
 *     On first launch (insufficient history), status is forced to
 *     "healthy" per CLAUDE.md §8.2.
 *   - Compose the `warnings` list from the edge cases in §13 so the UI
 *     has a single, enumerable set of signals to surface (banner copy,
 *     nudges, red states).
 *
 * Design rules:
 *   - Never call `calculateAmbanScore()` from screens. Always consume
 *     this hook. That keeps the "assemble inputs + decorate output"
 *     logic in one place.
 *   - The hook is memoised against the minimal set of store slices it
 *     depends on. Multiple Home subcomponents calling it in the same
 *     render pass must not trigger duplicate work.
 *   - No side effects. Persisting `scoreAtLog` happens at log-time
 *     inside dailyStore.logSpend(), not here.
 *   - "Today" is read via utils/dateHelpers.today() so every caller
 *     sees the same normalised start-of-day reference. Screens that
 *     need to override "today" (tests, dev inspector) can consume the
 *     underlying `calculateAmbanScore()` directly.
 */

import { useMemo } from "react";

import {
  AVG_WINDOW_DAYS,
  SCORE_GOOD_RATIO,
  SCORE_HEALTHY_RATIO,
} from "../constants/insightThresholds";
import { today as todayStartOfDay } from "../utils/dateHelpers";
import { calculateAmbanScore } from "../utils/scoring";
import type { ScoreResult } from "../utils/scoring";
import { useDailyStore } from "../stores/dailyStore";
import type { DailyLog } from "../stores/dailyStore";
import { useFinanceStore } from "../stores/financeStore";
import type { BalanceSnapshot, ManualCredit } from "../stores/financeStore";

/* ------------------------------------------------------------------
 * Public types
 * ------------------------------------------------------------------ */

export type ScoreStatus = "healthy" | "watch" | "critical";

export type ScoreWarning =
  /** First-day state: score is a projection, not yet validated by any log. */
  | "no-history"
  /** Balance after upcoming bills projects negative (§13.5). */
  | "projected-negative"
  /** User has not logged in >1 day, so effective balance may drift (§13.6). */
  | "stale-logs"
  /** Today is an income credit day — user should refresh their balance (§13.2 / §6.4). */
  | "income-day-pending"
  /** No income sources configured yet — score is undefined. */
  | "no-income-source"
  /** Balance snapshot has never been captured — onboarding incomplete. */
  | "no-balance-snapshot";

export interface AmbanScoreResult {
  /** Safe-to-spend amount per day, in rupees. Clamped at zero. */
  score: number;
  /** Colour bucket resolved by comparing today's score to the 30-day avg. */
  status: ScoreStatus;
  /** Calendar days until the next income credit (min 1). */
  daysLeft: number;
  /** Latest balance minus spend since the last snapshot, plus post-snapshot credits. */
  effectiveBalance: number;
  /** Sum of recurring payments due between today and next income. */
  upcomingRecurring: number;
  /** Date of the next income credit across all active sources. */
  nextIncomeDate: Date | null;
  /** Ordered list of conditions the UI should surface. */
  warnings: ScoreWarning[];
  /**
   * True once every upstream store has hydrated. Before this flips
   * true the returned numbers are zeros / placeholders — UI should
   * render a skeleton rather than the real ScoreCard.
   */
  ready: boolean;
}

/* ------------------------------------------------------------------
 * Derivation helpers
 *
 * Kept module-local and pure so the memo in the hook body has exactly
 * one seam to test against if we ever grow a harness.
 * ------------------------------------------------------------------ */

/**
 * ISO YYYY-MM-DD for a Date in the device's local calendar. The store
 * layer speaks ISO strings (log_date, recorded_at, credited_at), so
 * we compare strings there to avoid timezone drift from Date parsing.
 */
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Sum of daily log spend with log_date strictly after the given ISO
 * date. Mirrors the "spendSinceLastSnapshot" rule in §7.4 — the
 * snapshot day itself is assumed to already reflect that day's spend
 * at the moment the user captured it.
 */
function sumSpendAfter(logs: DailyLog[], exclusiveStartIso: string): number {
  let total = 0;
  for (const log of logs) {
    if (log.logDate > exclusiveStartIso) {
      total += log.spent;
    }
  }
  return total;
}

/**
 * Sum of one-off credits whose `credited_at` falls on or after the
 * snapshot date. Included in effective balance because the snapshot
 * was captured before these credits landed; ignoring them would
 * understate the user's real headroom.
 */
function sumCreditsFrom(credits: ManualCredit[], inclusiveStartIso: string): number {
  let total = 0;
  for (const credit of credits) {
    if (credit.creditedAt >= inclusiveStartIso) {
      total += credit.amount;
    }
  }
  return total;
}

/**
 * Rolling average of `score_at_log` over the last `windowDays` worth
 * of logs. Skips logs with a null score (legacy rows, backfilled days
 * where no score was captured). Returns null when there aren't enough
 * real samples to be meaningful — the caller then forces status to
 * "healthy" per §8.2.
 */
function averageHistoricalScore(logs: DailyLog[], windowDays: number): number | null {
  const MIN_SAMPLES = 3;
  let sum = 0;
  let count = 0;

  // `logs` is already sorted newest-first by the store layer, so the
  // first `windowDays` entries are the most recent window.
  for (let i = 0; i < logs.length && i < windowDays; i += 1) {
    const log = logs[i];
    if (log && typeof log.scoreAtLog === "number" && Number.isFinite(log.scoreAtLog)) {
      sum += log.scoreAtLog;
      count += 1;
    }
  }

  if (count < MIN_SAMPLES) return null;
  return sum / count;
}

/**
 * Resolve today's score against its historical average into a status
 * bucket. Thresholds come from `constants/insightThresholds.ts` so
 * retuning the colour rule is a one-file edit.
 */
function resolveStatus(score: number, historicalAvg: number | null): ScoreStatus {
  // Insufficient history → always "healthy" on first launches. Matches
  // the "no reference to compare against" convention in §8.2.
  if (historicalAvg == null || historicalAvg <= 0) return "healthy";

  const ratio = score / historicalAvg;
  if (ratio >= SCORE_HEALTHY_RATIO) return "healthy";
  if (ratio >= SCORE_GOOD_RATIO) return "watch";
  return "critical";
}

/**
 * True when the user hasn't captured a log for more than one full day.
 * The one-day grace period lets users log yesterday tonight without
 * tripping the stale warning. Logs newer than that are considered
 * current — the scoring pipeline simply has no daily spend to subtract.
 */
function hasStaleLogs(logs: DailyLog[], today: Date): boolean {
  if (logs.length === 0) return false; // "no-history" handles first-day
  const mostRecent = logs[0]; // store keeps logs newest-first
  if (!mostRecent) return false;
  const mostRecentIso = mostRecent.logDate;
  // Check against the day BEFORE yesterday: if today is Fri and the
  // most recent log is Wed or earlier, logs are stale.
  const twoDaysAgoIso = toIsoDate(new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000));
  return mostRecentIso < twoDaysAgoIso;
}

/**
 * True when today IS an income credit day AND the latest balance
 * snapshot is older than today. The banner on Home nudges the user
 * to refresh their balance now that the salary has landed (§6.4).
 */
function isIncomeDayPending(
  incomeSources: ReadonlyArray<{ creditDay: number }>,
  latestSnapshot: BalanceSnapshot | null,
  today: Date,
): boolean {
  if (incomeSources.length === 0) return false;

  const todayDay = today.getDate();
  const matchesSource = incomeSources.some((source) => source.creditDay === todayDay);
  if (!matchesSource) return false;

  // No snapshot at all → the "no-balance-snapshot" warning covers it;
  // don't double up with income-day-pending.
  if (!latestSnapshot) return false;

  // Snapshot captured today → the user has already refreshed; nothing
  // to nudge.
  return latestSnapshot.recordedAt < toIsoDate(today);
}

/* ------------------------------------------------------------------
 * Warning composer
 *
 * Centralised so the priority order is auditable in one place:
 *   1. no-income-source     (score is undefined)
 *   2. no-balance-snapshot  (score is a guess)
 *   3. projected-negative   (red state — bills outrun balance)
 *   4. income-day-pending   (actionable nudge)
 *   5. stale-logs           (informational, low urgency)
 *   6. no-history           (first-day framing, lowest urgency)
 * ------------------------------------------------------------------ */

interface WarningInput {
  incomeSourcesCount: number;
  latestBalance: BalanceSnapshot | null;
  scoreResult: ScoreResult;
  logs: DailyLog[];
  incomeDayPending: boolean;
  hasAnyHistory: boolean;
}

function composeWarnings(input: WarningInput): ScoreWarning[] {
  const out: ScoreWarning[] = [];

  if (input.incomeSourcesCount === 0) {
    out.push("no-income-source");
  }
  if (!input.latestBalance) {
    out.push("no-balance-snapshot");
  }
  if (input.scoreResult.projectedNegative) {
    out.push("projected-negative");
  }
  if (input.incomeDayPending) {
    out.push("income-day-pending");
  }
  if (hasStaleLogs(input.logs, todayStartOfDay())) {
    out.push("stale-logs");
  }
  if (!input.hasAnyHistory) {
    out.push("no-history");
  }

  return out;
}

/* ------------------------------------------------------------------
 * The hook
 * ------------------------------------------------------------------ */

/**
 * Returns the current Amban Score and its supporting metrics.
 *
 * Consumed by Home (ScoreCard, supporting-metrics row, banners),
 * Insights (projections), and the DailyLogScreen's post-save toast.
 * UI should memoise expensive downstream formatting against the
 * returned identities — the hook re-runs only when its minimal set
 * of store slices changes.
 */
export function useAmbanScore(): AmbanScoreResult {
  // Narrow subscriptions: pull only the slices the score actually
  // needs. Subscribing to the whole store would re-run this hook on
  // unrelated mutations (theme change, onboarding draft save, etc.).
  const latestBalance = useFinanceStore((state) => state.latestBalance);
  const incomeSources = useFinanceStore((state) => state.incomeSources);
  const recurringPayments = useFinanceStore((state) => state.recurringPayments);
  const manualCredits = useFinanceStore((state) => state.manualCredits);
  const financeHydrated = useFinanceStore((state) => state.hydrated);

  const logs = useDailyStore((state) => state.logs);
  const dailyHydrated = useDailyStore((state) => state.hydrated);

  return useMemo<AmbanScoreResult>(() => {
    const today = todayStartOfDay();
    const ready = financeHydrated && dailyHydrated;

    // Pre-hydrate guard — return a stable zero-state so consumers can
    // render skeletons without null checks. The `ready` flag tells
    // them when real data is available.
    if (!ready) {
      return {
        score: 0,
        status: "healthy",
        daysLeft: 1,
        effectiveBalance: 0,
        upcomingRecurring: 0,
        nextIncomeDate: null,
        warnings: [],
        ready: false,
      };
    }

    // Filter down to active rows here so every downstream calc treats
    // soft-deleted entries as non-existent.
    const activeIncome = incomeSources.filter((s) => s.isActive);
    const activeRecurring = recurringPayments.filter((p) => p.isActive);

    // Resolve the effective balance inputs. The snapshot date bounds
    // both the spend and the credit windows — everything on or after
    // it adjusts the snapshot rather than invalidating it.
    const snapshotIso = latestBalance?.recordedAt ?? null;
    const currentBalance = latestBalance?.amount ?? 0;

    // Spend strictly after the snapshot date (§7.4). Using the ISO
    // string comparison mirrors what the repo does in SQLite so the
    // two paths can't diverge.
    const spendSinceLastSnapshot = snapshotIso ? sumSpendAfter(logs, snapshotIso) : 0;

    // One-off credits landed on or after the snapshot. Included here
    // rather than in scoring.ts so the pure scorer stays unaware of
    // the manual_credits table's semantics.
    const creditsSinceSnapshot = snapshotIso ? sumCreditsFrom(manualCredits, snapshotIso) : 0;
    const balanceForScoring = currentBalance + creditsSinceSnapshot;

    // Pure math — everything the scorer needs is passed in explicitly.
    const scoreResult = calculateAmbanScore({
      currentBalance: balanceForScoring,
      spendSinceLastSnapshot,
      incomeSources: activeIncome,
      recurringPayments: activeRecurring,
      today,
    });

    // Status bucket from rolling history (§8.2). Uses scoreAtLog from
    // the stored rows, not re-derived values — the card should reflect
    // how the user saw their scores at the time they logged.
    const historicalAvg = averageHistoricalScore(logs, AVG_WINDOW_DAYS);
    const status = resolveStatus(scoreResult.score, historicalAvg);

    // Warnings are composed after the score so the "projected-
    // negative" flag can ride off the scorer's authoritative output.
    const warnings = composeWarnings({
      incomeSourcesCount: activeIncome.length,
      latestBalance,
      scoreResult,
      logs,
      incomeDayPending: isIncomeDayPending(activeIncome, latestBalance, today),
      hasAnyHistory: logs.length > 0,
    });

    return {
      score: scoreResult.score,
      status,
      daysLeft: scoreResult.daysLeft,
      effectiveBalance: scoreResult.effectiveBalance,
      upcomingRecurring: scoreResult.upcomingRecurring,
      nextIncomeDate: scoreResult.nextIncomeDate,
      warnings,
      ready: true,
    };
    // Dependency list is intentionally fine-grained: we want this memo
    // to stay warm across unrelated store mutations but invalidate
    // precisely when any scoring input shifts.
  }, [
    latestBalance,
    incomeSources,
    recurringPayments,
    manualCredits,
    logs,
    financeHydrated,
    dailyHydrated,
  ]);
}

/**
 * Re-export the result shape for consumers that want to type their
 * props against "whatever useAmbanScore returns" without pulling in
 * the store types transitively.
 */
export type { AmbanScoreResult as UseAmbanScoreResult };
