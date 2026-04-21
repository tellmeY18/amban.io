/**
 * stores/dailyStore.ts — daily spend logs and score history.
 *
 * Source of truth: CLAUDE.md §5 (Data Models → Zustand Store Shapes),
 * §6.2 (Daily Use Flow), §8.4 (Score History), and §13.6 (No Daily Log
 * for Multiple Days → backfill).
 *
 * Responsibilities:
 *   - Hydrate from `daily_logs` on app boot (most recent 90 days by
 *     default — enough data for every v1 insight without bloating the
 *     first render).
 *   - Expose the full log list + today's log so Home, DailyLog, and
 *     Log History all read from the same source of truth.
 *   - Persist the Amban Score at log time into `score_at_log` so the
 *     history view can render the "under / over / on-target" dot even
 *     after the score has since changed (§8.4).
 *   - Write through to SQLite on every mutation. SQLite is always the
 *     authoritative source; in-memory state is a cache of it.
 *
 * Design rules:
 *   - UI reads from this store, never from `daily_logs` directly. New
 *     selectors belong here or in a hook — not as ad-hoc repo calls.
 *   - Write-through order: SQLite first, then in-memory. A failed
 *     write MUST NOT update the in-memory state.
 *   - `todayLog` is a derived convenience — recomputed on every
 *     mutation from the freshly-refreshed `logs` list so the two can
 *     never drift. The recompute uses the device's local calendar day
 *     (same convention as utils/dateHelpers.ts).
 *   - `hydrate` is the ONLY method allowed to bypass write-through;
 *     it's the boot path pulling state from SQLite into memory.
 *   - `reset` is called by the destructive reset pipeline in
 *     db/reset.ts. It does NOT touch SQLite — the pipeline handles
 *     that separately.
 *   - After every mutation we re-read the last N days from SQLite
 *     rather than patching optimistically. The cost is one extra
 *     query per user-triggered write; the payoff is that the store
 *     cannot drift from storage (ordering, unique-per-date upserts,
 *     batch backfill semantics all "just work").
 *   - Derived values (averages, streaks, best/worst day) are NOT
 *     stored here. They're computed by the insights engine in Phase 11.
 */

import { create } from "zustand";

import { dailyLogsRepo } from "../db/repositories";
import type { DailyLogInput, DailyLogRecord } from "../db/repositories";
import type { CategoryKey } from "../constants/categories";

/* ------------------------------------------------------------------
 * Public store types
 *
 * Re-declared here (rather than re-exported from the repo) so UI code
 * depends on the store's contract, not on the storage layer's. The
 * shapes happen to line up today; the boundary stays explicit so a
 * future schema tweak stays a one-file edit.
 * ------------------------------------------------------------------ */

export interface DailyLog {
  id: number;
  /** ISO date: YYYY-MM-DD. Unique per day — re-logging updates in place. */
  logDate: string;
  spent: number;
  notes: string | null;
  /** Amban Score (₹/day) at the moment the log was saved. Nullable on legacy rows. */
  scoreAtLog: number | null;
  /** Optional category key from Appendix C. Null = uncategorised. */
  category: CategoryKey | null;
  /** ISO timestamp when the log row was written / last updated. */
  loggedAt: string;
}

/** Default rolling window loaded into memory on hydrate. */
export const DEFAULT_HYDRATE_DAYS = 90;

export interface DailyState {
  /** All loaded logs, newest first. */
  logs: DailyLog[];
  /**
   * Today's log if one exists in `logs`, otherwise null. Derived from
   * `logs` on every mutation — never set independently.
   */
  todayLog: DailyLog | null;
  /**
   * Size of the window currently loaded into memory. Kept so a later
   * call to `fetchLogs` with a wider window doesn't silently shrink
   * back to the default on the next mutation.
   */
  loadedDays: number;
  /** True after the initial hydrate from SQLite resolves. */
  hydrated: boolean;
}

export interface LogSpendInput {
  amount: number;
  notes?: string | null;
  category?: CategoryKey | null;
  /** Amban Score at the moment of logging, captured by the caller. */
  scoreAtLog?: number | null;
  /**
   * Override the log date (defaults to today). Used by the backfill
   * flow so the same primitive doesn't need a second code path.
   */
  logDate?: string;
}

export interface DailyActions {
  /**
   * Pull the most recent `days` of logs into memory. Called once
   * during app boot. Bypasses write-through by design. Safe to call
   * more than once — a re-hydrate resolves conflicts that would
   * otherwise require a cold restart.
   */
  hydrate: (days?: number) => Promise<void>;

  /**
   * Insert or update the log for the given date (defaults to today).
   * Enforces the "unique per date" invariant — re-logging the same
   * day replaces the existing row in place. Returns the stored record
   * so the caller can chain UI feedback off a concrete result.
   */
  logSpend: (input: LogSpendInput) => Promise<DailyLog>;

  /**
   * Patch an existing log row (amount / notes / category). Does NOT
   * move the log_date — that invariant is enforced at the UI layer
   * and at the repo layer's update() signature.
   */
  updateLog: (
    id: number,
    patch: Partial<Pick<DailyLog, "spent" | "notes" | "category">>,
  ) => Promise<void>;

  /** Delete a log row. */
  deleteLog: (id: number) => Promise<void>;

  /**
   * Backfill multiple days in a single transaction. Used by the
   * "You haven't logged in N days" flow (CLAUDE.md §13.6). Empty
   * input is a no-op.
   */
  backfillLogs: (entries: LogSpendInput[]) => Promise<void>;

  /**
   * Reload the last N days of logs from SQLite. Useful after a long
   * suspend or when the user expands the history view beyond the
   * default window. Widening replaces the loaded window; narrowing is
   * allowed but rarely useful — most call sites should just pass a
   * larger N than they currently have.
   */
  fetchLogs: (days: number) => Promise<void>;

  /**
   * Reset to initial state. In-memory only — the destructive reset
   * pipeline (db/reset.ts) wipes SQLite separately.
   */
  reset: () => void;
}

export type DailyStore = DailyState & DailyActions;

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Today's date as an ISO YYYY-MM-DD string in the device's local
 * calendar. Mirrors utils/dateHelpers.today() but kept local here so
 * this store doesn't pull a circular dependency on the date helpers
 * during their own Phase 5 rewrite. Cheap and stable — a one-line
 * helper that's correct on every supported platform.
 */
function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Map a repository record onto the store-facing shape. See the
 * top-of-file note — v1 shapes align; the seam exists so they don't
 * have to stay that way.
 */
function toDailyLog(record: DailyLogRecord): DailyLog {
  return {
    id: record.id,
    logDate: record.logDate,
    spent: record.spent,
    notes: record.notes,
    scoreAtLog: record.scoreAtLog,
    category: record.category,
    loggedAt: record.loggedAt,
  };
}

/**
 * Pick the log matching today's local calendar date out of a logs
 * list. Returns null when none matches — the UI uses that as the
 * "you haven't logged today yet" signal.
 */
function pickTodayLog(logs: DailyLog[]): DailyLog | null {
  const today = todayIsoDate();
  return logs.find((log) => log.logDate === today) ?? null;
}

/**
 * Coerce a LogSpendInput into the strictly-typed DailyLogInput the
 * repo expects. Applies the "default to today" rule and validates
 * the amount so the repo never has to defend against NaN / negatives.
 */
function toRepoInput(input: LogSpendInput): DailyLogInput {
  if (!Number.isFinite(input.amount)) {
    throw new Error("dailyStore: spend amount must be a finite number");
  }
  if (input.amount < 0) {
    throw new Error("dailyStore: spend amount cannot be negative");
  }

  return {
    logDate: input.logDate ?? todayIsoDate(),
    spent: input.amount,
    notes: input.notes ?? null,
    category: input.category ?? null,
    scoreAtLog: input.scoreAtLog ?? null,
  };
}

/* ------------------------------------------------------------------
 * Store factory
 * ------------------------------------------------------------------ */

const INITIAL_STATE: DailyState = {
  logs: [],
  todayLog: null,
  loadedDays: DEFAULT_HYDRATE_DAYS,
  hydrated: false,
};

/**
 * Re-read the last N days of logs from SQLite into memory. Used after
 * every mutation so ordering, unique-per-date upserts, and backfill
 * batch semantics all show up without bespoke patch logic. `days` is
 * clamped to a sane range by the repo.
 */
async function refreshLogs(days: number): Promise<DailyLog[]> {
  const records = await dailyLogsRepo.listRecent(days);
  return records.map(toDailyLog);
}

export const useDailyStore = create<DailyStore>((set, get) => ({
  ...INITIAL_STATE,

  hydrate: async (days = DEFAULT_HYDRATE_DAYS) => {
    const logs = await refreshLogs(days);
    set({
      logs,
      todayLog: pickTodayLog(logs),
      loadedDays: days,
      hydrated: true,
    });
  },

  /* -----------------------------
   * Logging
   * ----------------------------- */

  logSpend: async (input) => {
    const repoInput = toRepoInput(input);

    // Write-through. The repo's upsert respects the UNIQUE(log_date)
    // invariant — re-logging the same day replaces the existing row
    // instead of inserting a second one.
    const stored = await dailyLogsRepo.upsert(repoInput);

    // Re-read the currently-loaded window. Keeps the in-memory list
    // in the same order SQLite will return on the next cold boot.
    const logs = await refreshLogs(get().loadedDays);
    set((prev) => ({
      ...prev,
      logs,
      todayLog: pickTodayLog(logs),
    }));

    return toDailyLog(stored);
  },

  updateLog: async (id, patch) => {
    await dailyLogsRepo.update(id, patch);

    const logs = await refreshLogs(get().loadedDays);
    set((prev) => ({
      ...prev,
      logs,
      todayLog: pickTodayLog(logs),
    }));
  },

  deleteLog: async (id) => {
    await dailyLogsRepo.delete(id);

    const logs = await refreshLogs(get().loadedDays);
    set((prev) => ({
      ...prev,
      logs,
      todayLog: pickTodayLog(logs),
    }));
  },

  backfillLogs: async (entries) => {
    if (entries.length === 0) return;

    // Coerce every entry up-front so a bad row fails the whole batch
    // BEFORE any SQLite writes happen. The repo's upsertMany is
    // atomic, but we still want to reject garbage at the boundary.
    const repoInputs = entries.map(toRepoInput);

    await dailyLogsRepo.upsertMany(repoInputs);

    // If the caller backfilled dates older than the currently-loaded
    // window, widen the window so those dates become visible in
    // History without a manual `fetchLogs` call.
    const state = get();
    // `repoInputs` is non-empty at this point (we early-returned on
    // empty input above), but TypeScript can't infer that from the
    // early-return alone — walk the array and guard explicitly so
    // we don't rely on a non-null assertion.
    let oldestBackfill = repoInputs[0]?.logDate ?? todayIsoDate();
    for (const entry of repoInputs) {
      if (entry.logDate < oldestBackfill) {
        oldestBackfill = entry.logDate;
      }
    }
    const today = todayIsoDate();
    const daysBack = Math.max(state.loadedDays, calendarDaysBetweenIso(oldestBackfill, today) + 1);

    const logs = await refreshLogs(daysBack);
    set((prev) => ({
      ...prev,
      logs,
      todayLog: pickTodayLog(logs),
      loadedDays: daysBack,
    }));
  },

  fetchLogs: async (days) => {
    const logs = await refreshLogs(days);
    set((prev) => ({
      ...prev,
      logs,
      todayLog: pickTodayLog(logs),
      loadedDays: days,
    }));
  },

  /* -----------------------------
   * Lifecycle
   * ----------------------------- */

  reset: () => {
    // In-memory only. The reset pipeline in db/reset.ts handles the
    // SQLite wipe; calling the repo here would double-fire and race
    // the pipeline's ordering guarantees.
    set({ ...INITIAL_STATE, hydrated: true });
  },
}));

/* ------------------------------------------------------------------
 * Tiny date math helper
 *
 * Kept local so the store doesn't take a dependency on
 * utils/dateHelpers.ts (which itself imports date-fns and is still
 * being fleshed out in Phase 5). Handles the narrow case we need:
 * how many whole calendar days separate two YYYY-MM-DD strings.
 * ------------------------------------------------------------------ */

function calendarDaysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00`);
  const to = Date.parse(`${toIso}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}
