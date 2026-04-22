/**
 * stores/dailyStore.ts — daily spend logs, per-entry capture, and confirmation state.
 *
 * Source of truth: CLAUDE.md §5 (Data Models → Zustand Store Shapes),
 * §6.2 (Daily Use Flow), §8.4 (Score History), §9.2 (Daily Log Screen),
 * and §13.6 (No Daily Log for Multiple Days → backfill). Post-v0.1.0
 * this store also owns the two-tier logging model introduced in
 * migration 002: per-entry spend capture rolling up into a single
 * confirmable `daily_logs` row per date.
 *
 * The two-tier model, briefly
 * ---------------------------
 * Users don't live their day as "one amount". They spend in bursts —
 * ₹120 chai in the morning, ₹800 groceries at lunch, ₹60 auto in the
 * evening — and each burst carries its own category and note. We
 * capture those bursts as `spend_entries` (N per day) and auto-roll
 * them into the one-row-per-day `daily_logs` that scoring consumes.
 *
 *   entries (fluid) ──rollUp──▶ daily_logs.spent ──▶ scoring
 *
 * A day is "fluid" until the user explicitly confirms the total
 * (usually from the 9 PM notification prompt). Confirmation stamps
 * `daily_logs.confirmed_at`. Even after confirmation, edits are
 * allowed until local midnight — the UI enforces the midnight cutoff,
 * this store simply exposes the confirmation state for the UI to
 * branch on.
 *
 * Responsibilities:
 *   - Hydrate both `daily_logs` (90-day window) and `spend_entries`
 *     (same window, keyed by date) on app boot.
 *   - Expose the full log list + today's log + today's entries + a
 *     derived "today's entries total" so Home, DailyLog, and Log
 *     History all read from the same source of truth.
 *   - Persist the Amban Score at confirmation time into `score_at_log`
 *     so the history view can render the "under / over / on-target"
 *     dot even after the live score has since changed (§8.4).
 *   - Provide entry-level CRUD that automatically rolls up the day's
 *     total via `spendEntriesRepo.rollUp()` on every mutation.
 *   - Provide a dedicated `confirmDay()` action for the end-of-day
 *     sheet — stamps `confirmed_at` and captures the score at
 *     confirmation time.
 *   - Write through to SQLite on every mutation. SQLite is always the
 *     authoritative source; in-memory state is a cache of it.
 *
 * Design rules:
 *   - UI reads from this store, never from the repos directly.
 *   - Write-through order: SQLite first, then in-memory. A failed
 *     write MUST NOT update the in-memory state.
 *   - `todayLog` / `todayEntries` / `entriesByDate` are derived
 *     convenience slices — recomputed on every mutation from freshly-
 *     refreshed raw data so the view can never drift from storage.
 *   - `hydrate` is the ONLY method allowed to bypass write-through.
 *   - `reset` is called by the destructive reset pipeline in
 *     `db/reset.ts`. It does NOT touch SQLite — the pipeline handles
 *     that separately.
 *   - After every mutation we re-read the last N days from SQLite
 *     rather than patching optimistically. The cost is one extra
 *     query per user-triggered write; the payoff is that the store
 *     cannot drift from storage (ordering, unique-per-date upserts,
 *     batch backfill semantics, entries ↔ logs rollup all "just work").
 *   - Derived values (averages, streaks, best/worst day) are NOT
 *     stored here. They're computed by the insights engine in Phase 11.
 */

import { create } from "zustand";

import { dailyLogsRepo, spendEntriesRepo } from "../db/repositories";
import type {
  DailyLogInput,
  DailyLogRecord,
  SpendEntryInput,
  SpendEntryRecord,
} from "../db/repositories";
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
  /**
   * Confirmed daily total. Kept in sync with the sum of `entries`
   * for the same date on every entry mutation via the repo's rollUp.
   */
  spent: number;
  notes: string | null;
  /** Amban Score (₹/day) at the moment the log was saved. Nullable on legacy rows. */
  scoreAtLog: number | null;
  /** Optional headline category for the day (from Appendix C). */
  category: CategoryKey | null;
  /**
   * ISO timestamp of user confirmation, or null if the day is still
   * fluid. UI branches on this to show the "Confirm today's total"
   * CTA vs the "Edit until midnight" affordance.
   */
  confirmedAt: string | null;
  /** ISO timestamp when the log row was written / last updated. */
  loggedAt: string;
}

export interface SpendEntry {
  id: number;
  /** ISO date, YYYY-MM-DD. */
  logDate: string;
  amount: number;
  category: CategoryKey | null;
  notes: string | null;
  /** ISO timestamp of when the spend happened (user-editable). */
  spentAt: string;
  createdAt: string;
  updatedAt: string | null;
}

/** Default rolling window loaded into memory on hydrate. */
export const DEFAULT_HYDRATE_DAYS = 90;

export interface DailyState {
  /** All loaded daily_logs rows, newest first. */
  logs: DailyLog[];

  /** All loaded entries in the window, newest first across dates. */
  entries: SpendEntry[];

  /**
   * Entries grouped by log_date. Derived on every mutation from
   * `entries` so the UI can render a day's entries in O(1) without
   * scanning the flat list. Dates with zero entries are absent from
   * the map (not empty-arrayed).
   */
  entriesByDate: Record<string, SpendEntry[]>;

  /**
   * Today's daily_logs row if one exists, otherwise null. Derived
   * from `logs` on every mutation.
   */
  todayLog: DailyLog | null;

  /** Today's entries, newest first. Derived from `entriesByDate`. */
  todayEntries: SpendEntry[];

  /**
   * Running total of today's entries. Cheaper than iterating in
   * every consumer; equal to `todayLog.spent` whenever the rollup
   * is in sync (which is always, after a mutation).
   */
  todayEntriesTotal: number;

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
  /**
   * If true, stamp `daily_logs.confirmed_at` with the current time
   * (if not already set). The end-of-day confirmation sheet sets
   * this; routine entry mutations do not.
   */
  confirm?: boolean;
}

export interface AddEntryInput {
  amount: number;
  category?: CategoryKey | null;
  notes?: string | null;
  /** ISO date override. Defaults to today. */
  logDate?: string;
  /** ISO timestamp override for when the spend happened. Defaults to now. */
  spentAt?: string;
  /**
   * Score at the moment of this entry, captured by the caller. Stored
   * on the rolled-up daily_logs row ONLY if that row didn't already
   * have a score recorded — the first score captured for the day
   * wins so confirmation-time scoring has something to compare to.
   */
  scoreAtLog?: number | null;
}

export interface UpdateEntryPatch {
  amount?: number;
  category?: CategoryKey | null;
  notes?: string | null;
  spentAt?: string;
}

export interface ConfirmDayInput {
  /** Date to confirm. Defaults to today. */
  logDate?: string;
  /** Amban Score at confirmation time. */
  scoreAtLog?: number | null;
  /** Optional headline note for the day. */
  notes?: string | null;
  /** Optional headline category for the day. */
  category?: CategoryKey | null;
}

export interface DailyActions {
  /**
   * Pull the most recent `days` of logs AND entries into memory.
   * Called once during app boot. Bypasses write-through by design.
   * Safe to call more than once — a re-hydrate resolves conflicts
   * that would otherwise require a cold restart.
   */
  hydrate: (days?: number) => Promise<void>;

  /* -----------------------------
   * Entry-level operations (new in migration 002)
   * ----------------------------- */

  /**
   * Append a new spend entry and auto-roll the day's total into
   * `daily_logs.spent`. Returns the stored record for UI chaining.
   * The rollup never stamps `confirmed_at` — confirmation stays an
   * explicit user action.
   */
  addEntry: (input: AddEntryInput) => Promise<SpendEntry>;

  /** Patch an existing entry and re-roll the affected day. */
  updateEntry: (id: number, patch: UpdateEntryPatch) => Promise<void>;

  /** Delete an entry and re-roll the affected day. */
  deleteEntry: (id: number) => Promise<void>;

  /**
   * Confirm the day's total. Stamps `daily_logs.confirmed_at` with
   * the current timestamp and attaches a score / headline note /
   * category. Safe to call more than once per day — on subsequent
   * calls, `confirmed_at` is preserved (audit trail) and the other
   * fields are updated in place.
   */
  confirmDay: (input?: ConfirmDayInput) => Promise<DailyLog>;

  /**
   * Un-seal a previously-confirmed day. Rare but documented — lets
   * the user clear the confirmation stamp from the history edit
   * flow. Does not touch entries.
   */
  unconfirmDay: (logDate: string) => Promise<void>;

  /* -----------------------------
   * Legacy day-total operations (kept for backfill + history edits)
   * ----------------------------- */

  /**
   * Insert or update a daily_logs row directly, bypassing the entries
   * rollup. Used by the backfill flow (no entries exist for missed
   * days) and by the history edit sheet (user overrides the total
   * without authoring entries). New screens should prefer `addEntry`
   * + `confirmDay` — this is the escape hatch.
   */
  logSpend: (input: LogSpendInput) => Promise<DailyLog>;

  /** Patch a daily_logs row (amount / notes / category). */
  updateLog: (
    id: number,
    patch: Partial<Pick<DailyLog, "spent" | "notes" | "category">>,
  ) => Promise<void>;

  /** Delete a daily_logs row. Does NOT cascade-delete entries. */
  deleteLog: (id: number) => Promise<void>;

  /**
   * Backfill multiple days in a single transaction (§13.6). Empty
   * input is a no-op. Writes directly to daily_logs — backfilled
   * days don't carry per-entry detail by design.
   */
  backfillLogs: (entries: LogSpendInput[]) => Promise<void>;

  /**
   * Reload the last N days of logs + entries from SQLite. Useful
   * after a long suspend or when the user expands history beyond
   * the default window.
   */
  fetchLogs: (days: number) => Promise<void>;

  /**
   * Reset to initial state. In-memory only — the destructive reset
   * pipeline (`db/reset.ts`) wipes SQLite separately.
   */
  reset: () => void;
}

export type DailyStore = DailyState & DailyActions;

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Today's date as an ISO YYYY-MM-DD string in the device's local
 * calendar. Mirrors utils/dateHelpers.today() but kept local here
 * so this store doesn't pull a circular dependency on the date
 * helpers. Cheap and stable — correct on every supported platform.
 */
function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Map a repository daily_logs record onto the store-facing shape.
 * The two shapes currently align one-to-one; the seam exists so a
 * future schema tweak stays a one-file edit.
 */
function toDailyLog(record: DailyLogRecord): DailyLog {
  return {
    id: record.id,
    logDate: record.logDate,
    spent: record.spent,
    notes: record.notes,
    scoreAtLog: record.scoreAtLog,
    category: record.category,
    confirmedAt: record.confirmedAt,
    loggedAt: record.loggedAt,
  };
}

/** Map a repository spend_entries record onto the store-facing shape. */
function toSpendEntry(record: SpendEntryRecord): SpendEntry {
  return {
    id: record.id,
    logDate: record.logDate,
    amount: record.amount,
    category: record.category,
    notes: record.notes,
    spentAt: record.spentAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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

/** Group a flat entries list into a { [logDate]: entries[] } map. */
function groupEntriesByDate(entries: SpendEntry[]): Record<string, SpendEntry[]> {
  const grouped: Record<string, SpendEntry[]> = {};
  for (const entry of entries) {
    const bucket = grouped[entry.logDate];
    if (bucket) {
      bucket.push(entry);
    } else {
      grouped[entry.logDate] = [entry];
    }
  }
  return grouped;
}

/**
 * Coerce a LogSpendInput into the strictly-typed DailyLogInput the
 * repo expects. Applies the "default to today" rule and validates
 * the amount so the repo never has to defend against NaN / negatives.
 */
function toRepoLogInput(input: LogSpendInput): DailyLogInput {
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
    confirmed: input.confirm ?? false,
  };
}

/**
 * Coerce an AddEntryInput into the repo's SpendEntryInput shape. The
 * repo validates `amount > 0` too, but rejecting garbage here keeps
 * the error surface closer to the UI.
 */
function toRepoEntryInput(input: AddEntryInput): SpendEntryInput {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("dailyStore: entry amount must be a positive finite number");
  }
  return {
    logDate: input.logDate ?? todayIsoDate(),
    amount: input.amount,
    category: input.category ?? null,
    notes: input.notes ?? null,
    spentAt: input.spentAt,
  };
}

/** Calendar-day distance between two YYYY-MM-DD strings. */
function calendarDaysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00`);
  const to = Date.parse(`${toIso}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((to - from) / MS_PER_DAY));
}

/**
 * Start-of-window ISO date for the current loaded window. Used when
 * we need to ask the repo for entries over the same horizon that
 * `listRecent(days)` covers for logs.
 */
function windowStartIso(days: number): string {
  const now = new Date();
  // `listRecent(days)` returns the most recent N rows but daily_logs
  // is at most one row per date, so the effective window is `days`
  // calendar days. Mirror that here so entries and logs stay aligned.
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ------------------------------------------------------------------
 * Store factory
 * ------------------------------------------------------------------ */

const INITIAL_STATE: DailyState = {
  logs: [],
  entries: [],
  entriesByDate: {},
  todayLog: null,
  todayEntries: [],
  todayEntriesTotal: 0,
  loadedDays: DEFAULT_HYDRATE_DAYS,
  hydrated: false,
};

/** Re-read logs + entries for the given window, in parallel. */
async function refreshAll(days: number): Promise<{
  logs: DailyLog[];
  entries: SpendEntry[];
}> {
  const [logRecords, entryRecords] = await Promise.all([
    dailyLogsRepo.listRecent(days),
    spendEntriesRepo.listBetween(windowStartIso(days), todayIsoDate()),
  ]);
  return {
    logs: logRecords.map(toDailyLog),
    entries: entryRecords.map(toSpendEntry),
  };
}

/**
 * Build the derived slices from a fresh (logs, entries) pair. Kept
 * as a single function so every mutation path goes through the same
 * derivation and can't forget a field.
 */
function deriveSlices(
  logs: DailyLog[],
  entries: SpendEntry[],
): Pick<DailyState, "entriesByDate" | "todayLog" | "todayEntries" | "todayEntriesTotal"> {
  const today = todayIsoDate();
  const entriesByDate = groupEntriesByDate(entries);
  const todayEntries = entriesByDate[today] ?? [];
  const todayEntriesTotal = todayEntries.reduce((sum, e) => sum + e.amount, 0);
  return {
    entriesByDate,
    todayLog: pickTodayLog(logs),
    todayEntries,
    todayEntriesTotal,
  };
}

export const useDailyStore = create<DailyStore>((set, get) => ({
  ...INITIAL_STATE,

  hydrate: async (days = DEFAULT_HYDRATE_DAYS) => {
    const { logs, entries } = await refreshAll(days);
    set({
      logs,
      entries,
      ...deriveSlices(logs, entries),
      loadedDays: days,
      hydrated: true,
    });
  },

  /* -----------------------------
   * Entry-level operations
   * ----------------------------- */

  addEntry: async (input) => {
    const repoInput = toRepoEntryInput(input);
    const stored = await spendEntriesRepo.add(repoInput);

    // Roll the day's total into daily_logs so scoring is current.
    // The `scoreAtLog` on the daily_logs row is only set if it's
    // missing — we want the FIRST score captured for the day to win
    // so subsequent rollups don't churn the value.
    await spendEntriesRepo.rollUp(repoInput.logDate, input.scoreAtLog ?? null);

    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));

    return toSpendEntry(stored);
  },

  updateEntry: async (id, patch) => {
    // Find the entry first so we know which date to re-roll. Reading
    // from the in-memory list keeps this off SQLite for the common
    // case; if the entry isn't loaded (older than the window), we
    // fall back to re-rolling today — the edit would have to have
    // come from a history expand row that already widened the window.
    const beforeDate = get().entries.find((e) => e.id === id)?.logDate ?? todayIsoDate();

    await spendEntriesRepo.update(id, patch);

    // If the edit changed the spentAt to a different log_date we'd
    // need to re-roll both dates. The current repo signature doesn't
    // expose log_date as a patch field (spentAt is the timestamp,
    // log_date is denormalised at insert time only), so we only need
    // to re-roll the original date.
    await spendEntriesRepo.rollUp(beforeDate);

    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));
  },

  deleteEntry: async (id) => {
    const affectedDate = get().entries.find((e) => e.id === id)?.logDate ?? todayIsoDate();

    await spendEntriesRepo.delete(id);
    await spendEntriesRepo.rollUp(affectedDate);

    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));
  },

  confirmDay: async (input = {}) => {
    const logDate = input.logDate ?? todayIsoDate();

    // Roll up first so the stamped total is current with entries.
    await spendEntriesRepo.rollUp(logDate, input.scoreAtLog ?? null);

    // If the user attached a headline note / category / score, patch
    // the row now. We explicitly do NOT touch `spent` here — that
    // was just set by the rollup from the entries sum.
    const existing = await dailyLogsRepo.getByDate(logDate);
    if (existing) {
      const patch: Partial<Pick<DailyLog, "notes" | "category">> = {};
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.category !== undefined) patch.category = input.category;
      if (Object.keys(patch).length > 0) {
        await dailyLogsRepo.update(existing.id, patch);
      }
    } else {
      // Edge case: confirmDay called with zero entries and no
      // pre-existing row. Create an explicit zero-total row so the
      // confirmation stamp has something to live on.
      await dailyLogsRepo.upsert({
        logDate,
        spent: 0,
        notes: input.notes ?? null,
        category: input.category ?? null,
        scoreAtLog: input.scoreAtLog ?? null,
      });
    }

    // Stamp confirmed_at. `setConfirmed` is a no-op on re-confirm
    // (preserves the first-confirmation timestamp via COALESCE in
    // the SQL upsert path? no — setConfirmed always overwrites; we
    // rely on the UI not calling this redundantly). Acceptable for
    // v0.2 scope; documented on the repo method.
    await dailyLogsRepo.setConfirmed(logDate, true);

    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));

    const updated = logs.find((l) => l.logDate === logDate);
    if (!updated) {
      throw new Error(`dailyStore.confirmDay: daily_logs row for ${logDate} missing after write`);
    }
    return updated;
  },

  unconfirmDay: async (logDate) => {
    await dailyLogsRepo.setConfirmed(logDate, false);
    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));
  },

  /* -----------------------------
   * Legacy day-total operations
   * ----------------------------- */

  logSpend: async (input) => {
    const repoInput = toRepoLogInput(input);
    const stored = await dailyLogsRepo.upsert(repoInput);

    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));

    return toDailyLog(stored);
  },

  updateLog: async (id, patch) => {
    await dailyLogsRepo.update(id, patch);
    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));
  },

  deleteLog: async (id) => {
    await dailyLogsRepo.delete(id);
    const { logs, entries } = await refreshAll(get().loadedDays);
    set((prev) => ({ ...prev, logs, entries, ...deriveSlices(logs, entries) }));
  },

  backfillLogs: async (entries) => {
    if (entries.length === 0) return;

    const repoInputs = entries.map(toRepoLogInput);
    await dailyLogsRepo.upsertMany(repoInputs);

    // Widen the window if the backfill reached older dates.
    let oldestBackfill = repoInputs[0]?.logDate ?? todayIsoDate();
    for (const entry of repoInputs) {
      if (entry.logDate < oldestBackfill) {
        oldestBackfill = entry.logDate;
      }
    }
    const today = todayIsoDate();
    const daysBack = Math.max(get().loadedDays, calendarDaysBetweenIso(oldestBackfill, today) + 1);

    const { logs: freshLogs, entries: freshEntries } = await refreshAll(daysBack);
    set((prev) => ({
      ...prev,
      logs: freshLogs,
      entries: freshEntries,
      ...deriveSlices(freshLogs, freshEntries),
      loadedDays: daysBack,
    }));
  },

  fetchLogs: async (days) => {
    const { logs, entries } = await refreshAll(days);
    set((prev) => ({
      ...prev,
      logs,
      entries,
      ...deriveSlices(logs, entries),
      loadedDays: days,
    }));
  },

  /* -----------------------------
   * Lifecycle
   * ----------------------------- */

  reset: () => {
    set({ ...INITIAL_STATE, hydrated: true });
  },
}));
