/**
 * hooks/useInsights.ts — Insights generation hook.
 *
 * Source of truth: CLAUDE.md §11 (Insights Engine), §11.10 (Insight
 * Priority / Display Rules), and Appendix D (Insight Thresholds).
 *
 * Responsibilities:
 *   - Run every generator in utils/insightGenerators.ts (one per
 *     insight defined in §11.1–§11.9). Each generator is pure and
 *     returns either null (not applicable) or a structured Insight.
 *   - Filter out insights the user has swipe-dismissed within the TTL
 *     window (INSIGHT_DISMISS_TTL_HOURS). The dismissed list lives in
 *     Capacitor Preferences, not SQLite.
 *   - Sort by priority per §11.10: warnings > time-sensitive >
 *     informational. Ties break on generator order.
 *   - Cap the Home carousel at HOME_CAROUSEL_MAX. The full Insights
 *     screen passes { capped: false } to see everything.
 *
 * Design rules:
 *   - UI never calls the generators directly — this hook is the
 *     choke point.
 *   - Pure generators, impure hook: the hook is the only place that
 *     touches stores, preferences, or "now".
 *   - Dismissal state is persisted in PreferenceKey.DismissedInsights
 *     as a JSON array of `{ id, dismissedAt }`. On every read we
 *     drop entries whose TTL has expired so the array stays bounded.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { PreferenceKey, prefs } from "../db/preferences";
import { HOME_CAROUSEL_MAX, INSIGHT_DISMISS_TTL_HOURS } from "../constants/insightThresholds";
import { useAmbanScore } from "./useAmbanScore";
import { useDailyStore } from "../stores/dailyStore";
import { useFinanceStore } from "../stores/financeStore";
import { today as todayStartOfDay } from "../utils/dateHelpers";
import { INSIGHT_GENERATORS, type InsightContext } from "../utils/insightGenerators";

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
  /** Ionicon name, resolved via theme/icons at render time. */
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

/* ------------------------------------------------------------------
 * Dismissal record shape (persisted in Capacitor Preferences)
 *
 * { id: InsightId, dismissedAt: ISO timestamp }
 *
 * The stored array is bounded by the cardinality of InsightId — there
 * can never be more than ~10 entries in it. We still walk it on
 * every read to prune expired entries; the cost is trivial.
 * ------------------------------------------------------------------ */

interface DismissalRecord {
  id: string;
  dismissedAt: string;
}

function isDismissalRecord(value: unknown): value is DismissalRecord {
  if (!value || typeof value !== "object") return false;
  const obj = value as { id?: unknown; dismissedAt?: unknown };
  return typeof obj.id === "string" && typeof obj.dismissedAt === "string";
}

function pruneExpired(records: DismissalRecord[], now: Date): DismissalRecord[] {
  const cutoffMs = now.getTime() - INSIGHT_DISMISS_TTL_HOURS * 60 * 60 * 1000;
  return records.filter((record) => {
    const ts = Date.parse(record.dismissedAt);
    if (!Number.isFinite(ts)) return false;
    return ts >= cutoffMs;
  });
}

async function loadDismissedIds(now: Date): Promise<Set<string>> {
  const raw = await prefs.getJSON<unknown[]>(PreferenceKey.DismissedInsights, []);
  if (!Array.isArray(raw)) return new Set();
  const records = raw.filter(isDismissalRecord);
  const fresh = pruneExpired(records, now);

  // Opportunistic rewrite when pruning changed anything — keeps the
  // stored array from growing stale across many dismissal cycles.
  if (fresh.length !== records.length) {
    await prefs.setJSON(PreferenceKey.DismissedInsights, fresh);
  }

  return new Set(fresh.map((r) => r.id));
}

async function appendDismissal(id: InsightId, now: Date): Promise<void> {
  const existing = await prefs.getJSON<unknown[]>(PreferenceKey.DismissedInsights, []);
  const records = Array.isArray(existing) ? existing.filter(isDismissalRecord) : [];
  const pruned = pruneExpired(records, now);
  // Replace any prior record for the same id — the TTL always resets
  // on a fresh dismissal.
  const withoutId = pruned.filter((r) => r.id !== id);
  withoutId.push({ id, dismissedAt: now.toISOString() });
  await prefs.setJSON(PreferenceKey.DismissedInsights, withoutId);
}

/* ------------------------------------------------------------------
 * Context assembly
 *
 * The generator context is re-derived on every render pass. It's a
 * narrow projection over the stores + score hook so generator work
 * stays O(n_logs) with tiny constants.
 * ------------------------------------------------------------------ */

function useInsightContext(): InsightContext {
  const score = useAmbanScore();
  const logs = useDailyStore((s) => s.logs);
  const incomeSources = useFinanceStore((s) => s.incomeSources);
  const recurringPayments = useFinanceStore((s) => s.recurringPayments);

  return useMemo<InsightContext>(() => {
    const today = todayStartOfDay();
    return {
      today,
      score: {
        score: score.score,
        daysLeft: score.daysLeft,
        effectiveBalance: score.effectiveBalance,
        upcomingRecurring: score.upcomingRecurring,
        nextIncomeDate: score.nextIncomeDate,
        projectedNegative: score.warnings.includes("projected-negative"),
      },
      incomeSources: incomeSources
        .filter((s) => s.isActive)
        .map((s) => ({
          id: s.id,
          label: s.label,
          amount: s.amount,
          creditDay: s.creditDay,
        })),
      recurringPayments: recurringPayments
        .filter((p) => p.isActive)
        .map((p) => ({
          id: p.id,
          label: p.label,
          amount: p.amount,
          dueDay: p.dueDay,
          category: p.category,
        })),
      logs: logs.map((l) => ({
        logDate: l.logDate,
        spent: l.spent,
        scoreAtLog: l.scoreAtLog,
      })),
    };
  }, [
    score.score,
    score.daysLeft,
    score.effectiveBalance,
    score.upcomingRecurring,
    score.nextIncomeDate,
    score.warnings,
    logs,
    incomeSources,
    recurringPayments,
  ]);
}

/* ------------------------------------------------------------------
 * Public hook
 * ------------------------------------------------------------------ */

/**
 * Returns the currently applicable insights, sorted and filtered.
 *
 * Pipeline:
 *   1. Run every generator against the shared context.
 *   2. Drop nulls.
 *   3. Drop any insight whose id is dismissed (TTL-bounded).
 *   4. Sort by (priority ascending, then registry order).
 *   5. Slice to HOME_CAROUSEL_MAX when `capped` is true.
 *
 * Memoised on the minimal context derived from stores so unrelated
 * mutations (theme, settings, etc.) don't retrigger the generators.
 */
export function useInsights(options: UseInsightsOptions = {}): UseInsightsResult {
  const { capped = true } = options;
  const ctx = useInsightContext();

  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);

  // Load the dismissed list once on mount. Subsequent dismissals
  // update the local set synchronously; we persist the change in the
  // background.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = new Date();
      const ids = await loadDismissedIds(now);
      if (!cancelled) {
        setDismissed(ids);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const insights = useMemo<Insight[]>(() => {
    // Preserve registry order as the stable tiebreaker — the hook
    // walks INSIGHT_GENERATORS in sequence and tags each with its
    // index for the sort.
    const produced: Array<{ insight: Insight; order: number }> = [];
    INSIGHT_GENERATORS.forEach((entry, index) => {
      const insight = entry.generate(ctx);
      if (!insight) return;
      if (dismissed.has(insight.id)) return;
      produced.push({ insight, order: index });
    });

    produced.sort((a, b) => {
      if (a.insight.priority !== b.insight.priority) {
        return a.insight.priority - b.insight.priority;
      }
      return a.order - b.order;
    });

    const sorted = produced.map((p) => p.insight);
    return capped ? sorted.slice(0, HOME_CAROUSEL_MAX) : sorted;
  }, [ctx, dismissed, capped]);

  const dismiss = useCallback(async (id: InsightId) => {
    const now = new Date();
    // Optimistic local update so the UI reacts in the same frame —
    // the persisted write follows and failures don't block the UX
    // (the insight will re-appear on next boot, which is acceptable
    // for a 24h preference).
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await appendDismissal(id, now);
    } catch {
      /* Best-effort — the local set already hides the card. */
    }
  }, []);

  return {
    insights,
    loading: !loaded,
    dismiss,
  };
}
