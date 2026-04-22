/**
 * db/repositories.ts — typed repository layer for every amban table.
 *
 * Source of truth: CLAUDE.md §5 (Data Models → SQLite Schema) and §7
 * (Core Business Logic).
 *
 * Rationale:
 *   - The rest of the app must NEVER touch the SQLite connection
 *     directly. Every read and write flows through one of the
 *     repositories exported from this file. That's the only way the
 *     "write-through on mutation" pattern used by the Zustand stores
 *     (Phase 4) stays enforceable by grep.
 *   - Each repository is a plain object of async functions, not a
 *     class. We don't need instance state — the connection is a
 *     module-level singleton in db.ts — and flat objects are easier
 *     to mock in tests.
 *   - SQL lives as string literals inside the per-table modules below.
 *     Co-locating a query with the types it returns makes it easy to
 *     audit schema changes against actual call sites.
 *   - Every function is side-effect free beyond its declared SQL:
 *     no logging, no store reads, no date formatting. Pass Date
 *     objects in, receive typed records out.
 *
 * Conventions:
 *   - Monetary amounts are stored as REAL rupees (no paise in v1).
 *   - Dates are stored as ISO 8601 strings (TEXT) — either YYYY-MM-DD
 *     for calendar dates or full ISO timestamps for logged_at /
 *     recorded_at / created_at columns.
 *   - Boolean flags are stored as INTEGER (0 / 1) and converted at the
 *     repository boundary via the `toBool` helper.
 *   - Every list-returning query applies a stable ORDER BY so callers
 *     can memoize against the returned array identity.
 */

import type { SQLiteDBConnection } from "@capacitor-community/sqlite";

import type { CategoryKey } from "../constants/categories";
import { isCategoryKey } from "../constants/categories";
import { getDb } from "./db";

/* ==================================================================
 * Shared helpers
 * ==================================================================
 *
 * These are intentionally small and private-ish (not re-exported from
 * index files). Repositories consume them directly; nothing outside
 * this module should need them.
 * ================================================================== */

/**
 * Converts a 0/1 INTEGER into a real boolean. Accepts the raw numeric
 * form the SQLite plugin returns as well as the stringified form some
 * drivers emit — never trust the column type without coercing.
 */
function toBool(value: unknown): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  if (typeof value === "boolean") return value;
  return false;
}

/**
 * Converts a boolean into the 0/1 INTEGER the schema uses. Kept as a
 * named helper so the intent is obvious at call sites ("storing a
 * flag", not "coercing a number").
 */
function fromBool(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Coerces the plugin's `changes.lastId` into a number we can use as a
 * freshly-minted primary key. The plugin sometimes emits this as a
 * string on web, as a number on native — normalise before returning.
 */
function coerceLastId(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error("Insert did not return a valid lastId — schema or driver regression?");
}

/**
 * Narrow helper around the plugin's query result. Returns the rows
 * array as a typed list, or an empty array when the result is empty /
 * undefined. Keeps every caller from having to null-check `.values`.
 */
function rows<T>(result: { values?: unknown[] } | undefined): T[] {
  return (result?.values ?? []) as T[];
}

/**
 * Run a function with the active connection. Thin wrapper around
 * `getDb()` so call sites don't have to repeat the await everywhere
 * and so the connection can be mocked in a single place if we ever
 * grow a test harness.
 */
async function withDb<T>(fn: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
  const db = await getDb();
  return fn(db);
}

/**
 * Runs a body inside BEGIN/COMMIT. Any thrown error triggers ROLLBACK
 * and re-throws so callers see the original failure. Used by batch
 * writes (backfill logs, onboarding commit) where partial application
 * would be worse than no application.
 *
 * Note: the Capacitor plugin exposes a native `executeTransaction` on
 * some paths, but wrapping manually keeps the code path identical
 * across web + native and lets us mix different statement kinds in
 * one atomic block.
 */
async function transaction<T>(fn: (db: SQLiteDBConnection) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute("BEGIN;");
  try {
    const result = await fn(db);
    await db.execute("COMMIT;");
    return result;
  } catch (error) {
    try {
      await db.execute("ROLLBACK;");
    } catch {
      // If rollback itself fails we're already in a bad place; surface
      // the original error rather than masking it with rollback noise.
    }
    throw error;
  }
}

/* ==================================================================
 * user — single-row table
 * ==================================================================
 *
 * CLAUDE.md §5: one user per install. We pin id = 1 so upserts are
 * trivial and we never end up with a second profile row by accident.
 * ================================================================== */

export interface UserRecord {
  id: number;
  name: string;
  emoji: string | null;
  currency: string;
  createdAt: string;
  onboardingComplete: boolean;
}

/**
 * Raw shape as it sits on disk. Kept separate from UserRecord so the
 * snake_case → camelCase mapping happens in exactly one place.
 */
interface UserRow {
  id: number;
  name: string;
  emoji: string | null;
  currency: string;
  created_at: string;
  onboarding_complete: number;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    currency: row.currency,
    createdAt: row.created_at,
    onboardingComplete: toBool(row.onboarding_complete),
  };
}

export const userRepo = {
  /**
   * Returns the singleton user row, or null if onboarding hasn't
   * created it yet. The router gates against this — a null here is
   * the signal to mount the onboarding stack.
   */
  async get(): Promise<UserRecord | null> {
    return withDb(async (db) => {
      const res = await db.query("SELECT * FROM user WHERE id = 1;");
      const row = rows<UserRow>(res)[0];
      return row ? mapUser(row) : null;
    });
  },

  /**
   * Create the user row on first onboarding save. Uses INSERT OR
   * REPLACE so re-running the final onboarding step is idempotent
   * (e.g. user goes back and changes their name).
   */
  async upsert(input: {
    name: string;
    emoji?: string | null;
    currency?: string;
    onboardingComplete?: boolean;
  }): Promise<void> {
    const emoji = input.emoji ?? null;
    const currency = input.currency ?? "INR";
    const onboardingComplete = fromBool(input.onboardingComplete ?? false);
    const createdAt = new Date().toISOString();

    await withDb(async (db) => {
      await db.run(
        `INSERT INTO user (id, name, emoji, currency, created_at, onboarding_complete)
         VALUES (1, ?, ?, ?, COALESCE((SELECT created_at FROM user WHERE id = 1), ?), ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           emoji = excluded.emoji,
           currency = excluded.currency,
           onboarding_complete = excluded.onboarding_complete;`,
        [input.name, emoji, currency, createdAt, onboardingComplete],
      );
    });
  },

  /**
   * Patch-style update. Only the provided fields are written. Passing
   * nothing is a no-op. Does NOT create the row — call `upsert` for
   * that.
   */
  async update(patch: Partial<Omit<UserRecord, "id" | "createdAt">>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push("name = ?");
      values.push(patch.name);
    }
    if (patch.emoji !== undefined) {
      sets.push("emoji = ?");
      values.push(patch.emoji);
    }
    if (patch.currency !== undefined) {
      sets.push("currency = ?");
      values.push(patch.currency);
    }
    if (patch.onboardingComplete !== undefined) {
      sets.push("onboarding_complete = ?");
      values.push(fromBool(patch.onboardingComplete));
    }

    if (sets.length === 0) return;

    await withDb(async (db) => {
      await db.run(`UPDATE user SET ${sets.join(", ")} WHERE id = 1;`, values);
    });
  },

  /** Flip the onboarding flag to 1. Called by the final onboarding step. */
  async markOnboardingComplete(): Promise<void> {
    await withDb(async (db) => {
      await db.run("UPDATE user SET onboarding_complete = 1 WHERE id = 1;");
    });
  },
} as const;

/* ==================================================================
 * income_sources
 * ==================================================================
 *
 * CLAUDE.md §5 + §13.3: multiple sources are allowed; the scoring
 * pipeline picks the earliest next credit date. Keep is_active as a
 * soft-delete flag rather than deleting rows — historical recurring
 * math depends on knowing a source existed in the past.
 * ================================================================== */

export interface IncomeSourceRecord {
  id: number;
  label: string;
  amount: number;
  creditDay: number;
  isActive: boolean;
}

interface IncomeSourceRow {
  id: number;
  label: string;
  amount: number;
  credit_day: number;
  is_active: number;
}

function mapIncomeSource(row: IncomeSourceRow): IncomeSourceRecord {
  return {
    id: row.id,
    label: row.label,
    amount: row.amount,
    creditDay: row.credit_day,
    isActive: toBool(row.is_active),
  };
}

export const incomeSourcesRepo = {
  /**
   * List every income source ordered by credit_day ASC (calendar
   * reading order). Inactive rows are included so the Settings UI can
   * offer a toggle; filter at the call site when you need "active only"
   * for scoring.
   */
  async listAll(): Promise<IncomeSourceRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM income_sources ORDER BY is_active DESC, credit_day ASC, id ASC;",
      );
      return rows<IncomeSourceRow>(res).map(mapIncomeSource);
    });
  },

  /** Convenience — only the active rows, in the same order. */
  async listActive(): Promise<IncomeSourceRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM income_sources WHERE is_active = 1 ORDER BY credit_day ASC, id ASC;",
      );
      return rows<IncomeSourceRow>(res).map(mapIncomeSource);
    });
  },

  /**
   * Insert a new source. Returns the assigned id so the store can
   * round-trip into memory without re-fetching the full list.
   */
  async insert(input: Omit<IncomeSourceRecord, "id">): Promise<number> {
    return withDb(async (db) => {
      const res = await db.run(
        `INSERT INTO income_sources (label, amount, credit_day, is_active)
         VALUES (?, ?, ?, ?);`,
        [input.label, input.amount, input.creditDay, fromBool(input.isActive)],
      );
      return coerceLastId(res.changes?.lastId);
    });
  },

  /** Patch-style update by id. */
  async update(id: number, patch: Partial<Omit<IncomeSourceRecord, "id">>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.label !== undefined) {
      sets.push("label = ?");
      values.push(patch.label);
    }
    if (patch.amount !== undefined) {
      sets.push("amount = ?");
      values.push(patch.amount);
    }
    if (patch.creditDay !== undefined) {
      sets.push("credit_day = ?");
      values.push(patch.creditDay);
    }
    if (patch.isActive !== undefined) {
      sets.push("is_active = ?");
      values.push(fromBool(patch.isActive));
    }
    if (sets.length === 0) return;

    values.push(id);
    await withDb(async (db) => {
      await db.run(`UPDATE income_sources SET ${sets.join(", ")} WHERE id = ?;`, values);
    });
  },

  /** Toggle the active flag. Returns the new state after the flip. */
  async toggleActive(id: number): Promise<boolean> {
    return withDb(async (db) => {
      await db.run(
        "UPDATE income_sources SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?;",
        [id],
      );
      const res = await db.query("SELECT is_active FROM income_sources WHERE id = ?;", [id]);
      const row = rows<{ is_active: number }>(res)[0];
      return toBool(row?.is_active ?? 0);
    });
  },

  async delete(id: number): Promise<void> {
    await withDb(async (db) => {
      await db.run("DELETE FROM income_sources WHERE id = ?;", [id]);
    });
  },

  /**
   * Count of currently-active sources. Guardrails in Phase 10 use
   * this to refuse deleting the last active source.
   */
  async countActive(): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query("SELECT COUNT(*) AS c FROM income_sources WHERE is_active = 1;");
      const row = rows<{ c: number }>(res)[0];
      return row?.c ?? 0;
    });
  },
} as const;

/* ==================================================================
 * balance_snapshots
 * ==================================================================
 *
 * Every balance update is an append-only snapshot. Scoring reads the
 * latest row; history views walk the table in reverse chronological
 * order. We never UPDATE snapshots — mistakes are corrected by taking
 * a fresh snapshot, which is exactly how a bank statement works.
 * ================================================================== */

export interface BalanceSnapshotRecord {
  id: number;
  amount: number;
  /** ISO date string (YYYY-MM-DD). */
  recordedAt: string;
}

interface BalanceSnapshotRow {
  id: number;
  amount: number;
  recorded_at: string;
}

function mapBalanceSnapshot(row: BalanceSnapshotRow): BalanceSnapshotRecord {
  return {
    id: row.id,
    amount: row.amount,
    recordedAt: row.recorded_at,
  };
}

export const balanceSnapshotsRepo = {
  /**
   * Most recent snapshot, or null before onboarding step 4 has run.
   * Uses the (recorded_at DESC) index for a single-row lookup.
   */
  async latest(): Promise<BalanceSnapshotRecord | null> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM balance_snapshots ORDER BY recorded_at DESC, id DESC LIMIT 1;",
      );
      const row = rows<BalanceSnapshotRow>(res)[0];
      return row ? mapBalanceSnapshot(row) : null;
    });
  },

  /**
   * Paginated history for the future "balance timeline" view. Returns
   * newest-first up to the given limit; defaults generous enough for
   * typical use and capped to avoid accidental full-table loads.
   */
  async history(limit = 100): Promise<BalanceSnapshotRecord[]> {
    const cap = Math.max(1, Math.min(limit, 500));
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM balance_snapshots ORDER BY recorded_at DESC, id DESC LIMIT ?;",
        [cap],
      );
      return rows<BalanceSnapshotRow>(res).map(mapBalanceSnapshot);
    });
  },

  /**
   * Insert a new snapshot dated today by default. Callers can override
   * `recordedAt` for the onboarding "historical starting balance" path.
   * Returns the new id for round-trip into the store.
   */
  async insert(input: { amount: number; recordedAt?: string }): Promise<number> {
    const recordedAt = input.recordedAt ?? new Date().toISOString().slice(0, 10);
    return withDb(async (db) => {
      const res = await db.run(
        "INSERT INTO balance_snapshots (amount, recorded_at) VALUES (?, ?);",
        [input.amount, recordedAt],
      );
      return coerceLastId(res.changes?.lastId);
    });
  },
} as const;

/* ==================================================================
 * recurring_payments
 * ==================================================================
 *
 * Scoring pre-deducts any recurring payment due between today and the
 * next income date. is_active mirrors the income-source convention —
 * soft delete, never hard delete.
 * ================================================================== */

export interface RecurringPaymentRecord {
  id: number;
  label: string;
  amount: number;
  dueDay: number;
  category: CategoryKey;
  isActive: boolean;
}

interface RecurringPaymentRow {
  id: number;
  label: string;
  amount: number;
  due_day: number;
  category: string;
  is_active: number;
}

function mapRecurringPayment(row: RecurringPaymentRow): RecurringPaymentRecord {
  // Normalise any legacy / unknown category strings down to `other` so
  // the UI never has to render an undefined icon. The category column
  // is user-stable enum but we still trust-but-verify at the boundary.
  const category: CategoryKey = isCategoryKey(row.category) ? row.category : "other";
  return {
    id: row.id,
    label: row.label,
    amount: row.amount,
    dueDay: row.due_day,
    category,
    isActive: toBool(row.is_active),
  };
}

export const recurringPaymentsRepo = {
  async listAll(): Promise<RecurringPaymentRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM recurring_payments ORDER BY is_active DESC, due_day ASC, id ASC;",
      );
      return rows<RecurringPaymentRow>(res).map(mapRecurringPayment);
    });
  },

  async listActive(): Promise<RecurringPaymentRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM recurring_payments WHERE is_active = 1 ORDER BY due_day ASC, id ASC;",
      );
      return rows<RecurringPaymentRow>(res).map(mapRecurringPayment);
    });
  },

  async insert(input: Omit<RecurringPaymentRecord, "id">): Promise<number> {
    return withDb(async (db) => {
      const res = await db.run(
        `INSERT INTO recurring_payments (label, amount, due_day, category, is_active)
         VALUES (?, ?, ?, ?, ?);`,
        [input.label, input.amount, input.dueDay, input.category, fromBool(input.isActive)],
      );
      return coerceLastId(res.changes?.lastId);
    });
  },

  async update(id: number, patch: Partial<Omit<RecurringPaymentRecord, "id">>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.label !== undefined) {
      sets.push("label = ?");
      values.push(patch.label);
    }
    if (patch.amount !== undefined) {
      sets.push("amount = ?");
      values.push(patch.amount);
    }
    if (patch.dueDay !== undefined) {
      sets.push("due_day = ?");
      values.push(patch.dueDay);
    }
    if (patch.category !== undefined) {
      sets.push("category = ?");
      values.push(patch.category);
    }
    if (patch.isActive !== undefined) {
      sets.push("is_active = ?");
      values.push(fromBool(patch.isActive));
    }
    if (sets.length === 0) return;

    values.push(id);
    await withDb(async (db) => {
      await db.run(`UPDATE recurring_payments SET ${sets.join(", ")} WHERE id = ?;`, values);
    });
  },

  async toggleActive(id: number): Promise<boolean> {
    return withDb(async (db) => {
      await db.run(
        "UPDATE recurring_payments SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END WHERE id = ?;",
        [id],
      );
      const res = await db.query("SELECT is_active FROM recurring_payments WHERE id = ?;", [id]);
      const row = rows<{ is_active: number }>(res)[0];
      return toBool(row?.is_active ?? 0);
    });
  },

  async delete(id: number): Promise<void> {
    await withDb(async (db) => {
      await db.run("DELETE FROM recurring_payments WHERE id = ?;", [id]);
    });
  },
} as const;

/* ==================================================================
 * daily_logs
 * ==================================================================
 *
 * One row per calendar day. The UNIQUE constraint on log_date means
 * re-logging the same day is an UPDATE, not a second INSERT. The
 * backfill flow (§13.6) uses the transaction helper to write many
 * rows atomically.
 * ================================================================== */

export interface DailyLogRecord {
  id: number;
  /** ISO date, YYYY-MM-DD. */
  logDate: string;
  /**
   * Confirmed daily total. Kept in sync with the sum of
   * `spend_entries` for the same date whenever an entry mutates
   * (see spendEntriesRepo.rollUp). Users can still edit this value
   * directly via the end-of-day confirmation sheet or the history
   * edit flow — the entries rollup only writes it when the two
   * diverge and the day is not yet sealed in the UI layer.
   */
  spent: number;
  notes: string | null;
  category: CategoryKey | null;
  scoreAtLog: number | null;
  /**
   * ISO timestamp of the moment the user explicitly confirmed the
   * day's total (usually from the 9 PM notification sheet). NULL
   * means the day is still fluid — the UI can freely add/edit/delete
   * entries and the total auto-rolls. Once set, the UI treats the
   * day as confirmed but still permits edits until local midnight.
   */
  confirmedAt: string | null;
  /** ISO timestamp of the last write to this daily_logs row. */
  loggedAt: string;
}

interface DailyLogRow {
  id: number;
  log_date: string;
  spent: number;
  notes: string | null;
  category: string | null;
  score_at_log: number | null;
  confirmed_at: string | null;
  logged_at: string;
}

function mapDailyLog(row: DailyLogRow): DailyLogRecord {
  const category: CategoryKey | null = row.category
    ? isCategoryKey(row.category)
      ? row.category
      : "other"
    : null;
  return {
    id: row.id,
    logDate: row.log_date,
    spent: row.spent,
    notes: row.notes,
    category,
    scoreAtLog: row.score_at_log,
    // Migration 002 adds this column. Older rows from a pre-002 DB
    // return `undefined` from the driver, which we normalise to null
    // so the store / UI never has to distinguish the two.
    confirmedAt: row.confirmed_at ?? null,
    loggedAt: row.logged_at,
  };
}

export interface DailyLogInput {
  logDate: string;
  spent: number;
  notes?: string | null;
  category?: CategoryKey | null;
  scoreAtLog?: number | null;
  /**
   * Optional confirmation flag. When `true`, the upsert stamps
   * `confirmed_at` with the current timestamp (if not already set).
   * When `false` or omitted, `confirmed_at` is left untouched so a
   * routine auto-rollup from spend_entries does not accidentally
   * seal the day. Pass an explicit `null` only via the dedicated
   * `setConfirmed(id, null)` helper when the intent is to un-seal.
   */
  confirmed?: boolean;
}

export const dailyLogsRepo = {
  /**
   * The log for a specific date, or null when nothing was logged.
   * Uses the UNIQUE index on log_date for an O(log n) lookup.
   */
  async getByDate(logDate: string): Promise<DailyLogRecord | null> {
    return withDb(async (db) => {
      const res = await db.query("SELECT * FROM daily_logs WHERE log_date = ?;", [logDate]);
      const row = rows<DailyLogRow>(res)[0];
      return row ? mapDailyLog(row) : null;
    });
  },

  /**
   * Most recent N days of logs, newest first. Default cap of 90 keeps
   * the initial hydrate payload tight even after a year of logging.
   */
  async listRecent(days = 90): Promise<DailyLogRecord[]> {
    const cap = Math.max(1, Math.min(days, 365));
    return withDb(async (db) => {
      const res = await db.query(
        `SELECT * FROM daily_logs ORDER BY log_date DESC, id DESC LIMIT ?;`,
        [cap],
      );
      return rows<DailyLogRow>(res).map(mapDailyLog);
    });
  },

  /**
   * Logs within an inclusive date range, oldest first so charts can
   * consume them directly without a reverse(). Dates are ISO strings.
   */
  async listBetween(fromDate: string, toDate: string): Promise<DailyLogRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        `SELECT * FROM daily_logs
         WHERE log_date >= ? AND log_date <= ?
         ORDER BY log_date ASC, id ASC;`,
        [fromDate, toDate],
      );
      return rows<DailyLogRow>(res).map(mapDailyLog);
    });
  },

  /**
   * Insert or update the log for a given date. Matches the product
   * invariant: one log per date. Returns the stored record so the
   * caller can push it straight into the Zustand store.
   *
   * Confirmation semantics:
   *   - `confirmed: true` stamps `confirmed_at = NOW()` on insert, and
   *     on update leaves an existing `confirmed_at` alone (so the
   *     audit timestamp of "first confirmation" is preserved across
   *     subsequent same-day edits).
   *   - `confirmed` omitted / false leaves `confirmed_at` untouched
   *     on both paths. The rollup from spend_entries uses this path
   *     so an auto-refresh of the total never accidentally seals the
   *     day.
   */
  async upsert(input: DailyLogInput): Promise<DailyLogRecord> {
    const loggedAt = new Date().toISOString();
    const notes = input.notes ?? null;
    const category = input.category ?? null;
    const scoreAtLog = input.scoreAtLog ?? null;
    const confirmedAt = input.confirmed ? loggedAt : null;

    return withDb(async (db) => {
      await db.run(
        `INSERT INTO daily_logs (log_date, spent, notes, category, score_at_log, confirmed_at, logged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(log_date) DO UPDATE SET
           spent = excluded.spent,
           notes = excluded.notes,
           category = excluded.category,
           score_at_log = excluded.score_at_log,
           confirmed_at = COALESCE(daily_logs.confirmed_at, excluded.confirmed_at),
           logged_at = excluded.logged_at;`,
        [input.logDate, input.spent, notes, category, scoreAtLog, confirmedAt, loggedAt],
      );
      const res = await db.query("SELECT * FROM daily_logs WHERE log_date = ?;", [input.logDate]);
      const row = rows<DailyLogRow>(res)[0];
      if (!row) {
        throw new Error(`daily_logs upsert for ${input.logDate} produced no row`);
      }
      return mapDailyLog(row);
    });
  },

  /**
   * Atomic multi-row upsert. Used by the "you haven't logged in N
   * days" flow where the user supplies an amount per missed day.
   * Either all rows land or none do.
   */
  async upsertMany(entries: DailyLogInput[]): Promise<void> {
    if (entries.length === 0) return;
    await transaction(async (db) => {
      for (const entry of entries) {
        const loggedAt = new Date().toISOString();
        const confirmedAt = entry.confirmed ? loggedAt : null;
        await db.run(
          `INSERT INTO daily_logs (log_date, spent, notes, category, score_at_log, confirmed_at, logged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(log_date) DO UPDATE SET
             spent = excluded.spent,
             notes = excluded.notes,
             category = excluded.category,
             score_at_log = excluded.score_at_log,
             confirmed_at = COALESCE(daily_logs.confirmed_at, excluded.confirmed_at),
             logged_at = excluded.logged_at;`,
          [
            entry.logDate,
            entry.spent,
            entry.notes ?? null,
            entry.category ?? null,
            entry.scoreAtLog ?? null,
            confirmedAt,
            loggedAt,
          ],
        );
      }
    });
  },

  /**
   * Explicitly seal or un-seal a day. Used by the confirmation sheet
   * (seal) and by the post-confirmation "un-confirm" affordance in
   * the history edit flow (un-seal — rare, but documented).
   *
   * Accepts the ISO logDate so the UI doesn't have to round-trip
   * through `getByDate()` to find the row id.
   */
  async setConfirmed(logDate: string, confirmed: boolean): Promise<void> {
    const stamp = confirmed ? new Date().toISOString() : null;
    await withDb(async (db) => {
      await db.run(`UPDATE daily_logs SET confirmed_at = ?, logged_at = ? WHERE log_date = ?;`, [
        stamp,
        new Date().toISOString(),
        logDate,
      ]);
    });
  },

  /**
   * Patch an existing log row by id (used by the long-press edit flow
   * on Log History). Does not move the log_date — that invariant is
   * enforced at the UI layer.
   */
  async update(
    id: number,
    patch: Partial<Pick<DailyLogRecord, "spent" | "notes" | "category">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.spent !== undefined) {
      sets.push("spent = ?");
      values.push(patch.spent);
    }
    if (patch.notes !== undefined) {
      sets.push("notes = ?");
      values.push(patch.notes);
    }
    if (patch.category !== undefined) {
      sets.push("category = ?");
      values.push(patch.category);
    }
    if (sets.length === 0) return;

    // Always bump logged_at on edit so history views can sort by
    // "most recently modified" when they need to.
    sets.push("logged_at = ?");
    values.push(new Date().toISOString());

    values.push(id);
    await withDb(async (db) => {
      await db.run(`UPDATE daily_logs SET ${sets.join(", ")} WHERE id = ?;`, values);
    });
  },

  async delete(id: number): Promise<void> {
    await withDb(async (db) => {
      await db.run("DELETE FROM daily_logs WHERE id = ?;", [id]);
    });
  },

  /**
   * Sum of `spent` across all logs whose log_date is strictly after
   * the given date. Used by the scoring pipeline to compute
   * "spendSinceLastSnapshot" without pulling the full log set into
   * memory. Returns 0 when no rows match.
   */
  async sumSpentAfter(exclusiveStartDate: string): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT COALESCE(SUM(spent), 0) AS total FROM daily_logs WHERE log_date > ?;",
        [exclusiveStartDate],
      );
      const row = rows<{ total: number }>(res)[0];
      return row?.total ?? 0;
    });
  },

  /**
   * Inclusive variant of `sumSpentAfter`. Returns total spend whose
   * log_date falls on or after the given date — useful when the
   * caller wants to include the snapshot day itself.
   */
  async sumSpentFrom(inclusiveStartDate: string): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT COALESCE(SUM(spent), 0) AS total FROM daily_logs WHERE log_date >= ?;",
        [inclusiveStartDate],
      );
      const row = rows<{ total: number }>(res)[0];
      return row?.total ?? 0;
    });
  },

  /**
   * Total row count — used by the insights engine to decide whether
   * enough data exists to surface log-dependent cards.
   */
  async count(): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query("SELECT COUNT(*) AS c FROM daily_logs;");
      const row = rows<{ c: number }>(res)[0];
      return row?.c ?? 0;
    });
  },
} as const;

/* ==================================================================
 * spend_entries
 * ==================================================================
 *
 * Individual spend events. N entries per day roll up into the single
 * `daily_logs` row for that date. See migration 002 for the full
 * rationale. The repo exposes two kinds of operations:
 *
 *   1. CRUD over entries (add / list / update / delete).
 *   2. `rollUp(logDate)` — compute the day's total from the entries
 *      table and write it back to `daily_logs.spent`. Called by the
 *      store after every entry mutation so scoring never lags behind
 *      the entries list.
 *
 * Note: rollUp intentionally does NOT mark the day as confirmed.
 * Confirmation is an explicit user action, not a side-effect of
 * adding entries.
 * ================================================================== */

export interface SpendEntryRecord {
  id: number;
  /** ISO date, YYYY-MM-DD. Denormalised from spentAt for fast range scans. */
  logDate: string;
  amount: number;
  category: CategoryKey | null;
  notes: string | null;
  /** ISO timestamp of when the spend happened (user-editable). */
  spentAt: string;
  /** ISO timestamp of when the row was inserted. Never mutates. */
  createdAt: string;
  /** ISO timestamp of the most recent edit, or null if never edited. */
  updatedAt: string | null;
}

interface SpendEntryRow {
  id: number;
  log_date: string;
  amount: number;
  category: string | null;
  notes: string | null;
  spent_at: string;
  created_at: string;
  updated_at: string | null;
}

function mapSpendEntry(row: SpendEntryRow): SpendEntryRecord {
  const category: CategoryKey | null = row.category
    ? isCategoryKey(row.category)
      ? row.category
      : "other"
    : null;
  return {
    id: row.id,
    logDate: row.log_date,
    amount: row.amount,
    category,
    notes: row.notes,
    spentAt: row.spent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SpendEntryInput {
  logDate: string;
  amount: number;
  category?: CategoryKey | null;
  notes?: string | null;
  /** Optional override for when the spend happened. Defaults to now. */
  spentAt?: string;
}

export const spendEntriesRepo = {
  /**
   * All entries for a single day, newest first. Fed by the compound
   * index on (log_date, spent_at DESC) so this is a pure index scan
   * even on a device with months of history.
   */
  async listForDate(logDate: string): Promise<SpendEntryRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        `SELECT * FROM spend_entries WHERE log_date = ? ORDER BY spent_at DESC, id DESC;`,
        [logDate],
      );
      return rows<SpendEntryRow>(res).map(mapSpendEntry);
    });
  },

  /**
   * Every entry within an inclusive date range. Used by the history
   * expand-row (one day at a time) and by the insights engine's
   * category rollup (a wider window).
   */
  async listBetween(fromDate: string, toDate: string): Promise<SpendEntryRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        `SELECT * FROM spend_entries
         WHERE log_date >= ? AND log_date <= ?
         ORDER BY log_date DESC, spent_at DESC, id DESC;`,
        [fromDate, toDate],
      );
      return rows<SpendEntryRow>(res).map(mapSpendEntry);
    });
  },

  /**
   * Sum of entry amounts for a single day. Uses the compound index's
   * leading column so this is O(matching rows) without touching the
   * base table.
   */
  async sumForDate(logDate: string): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM spend_entries WHERE log_date = ?;`,
        [logDate],
      );
      const row = rows<{ total: number }>(res)[0];
      return row?.total ?? 0;
    });
  },

  /**
   * Insert a new entry. Returns the stored record so the caller can
   * push it straight into the Zustand store without a refetch. The
   * UI layer validates amount > 0 before calling; the CHECK constraint
   * in migration 002 is a safety net.
   */
  async add(input: SpendEntryInput): Promise<SpendEntryRecord> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("spendEntriesRepo.add: amount must be a positive finite number");
    }
    const now = new Date().toISOString();
    const spentAt = input.spentAt ?? now;
    const category = input.category ?? null;
    const notes = input.notes ?? null;

    return withDb(async (db) => {
      const res = await db.run(
        `INSERT INTO spend_entries (log_date, amount, category, notes, spent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL);`,
        [input.logDate, input.amount, category, notes, spentAt, now],
      );
      // SQLite plugin returns lastId via `changes.lastId` on native
      // and via a lookup fallback on web. Fetching by lastId is the
      // cheapest cross-platform round-trip.
      const insertedId =
        (res as { changes?: { lastId?: number } }).changes?.lastId ??
        (rows<{ id: number }>(await db.query(`SELECT last_insert_rowid() AS id;`))[0] ?? { id: 0 })
          .id;
      const row = rows<SpendEntryRow>(
        await db.query(`SELECT * FROM spend_entries WHERE id = ?;`, [insertedId]),
      )[0];
      if (!row) {
        throw new Error("spendEntriesRepo.add: inserted row could not be re-read");
      }
      return mapSpendEntry(row);
    });
  },

  /**
   * Patch an existing entry. All fields optional; at least one must
   * change for a meaningful call. Updates `updated_at` on every
   * successful edit so the UI can badge recently-edited entries.
   */
  async update(
    id: number,
    patch: Partial<Pick<SpendEntryRecord, "amount" | "category" | "notes" | "spentAt">>,
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.amount !== undefined) {
      if (!Number.isFinite(patch.amount) || patch.amount <= 0) {
        throw new Error("spendEntriesRepo.update: amount must be a positive finite number");
      }
      sets.push("amount = ?");
      values.push(patch.amount);
    }
    if (patch.category !== undefined) {
      sets.push("category = ?");
      values.push(patch.category);
    }
    if (patch.notes !== undefined) {
      sets.push("notes = ?");
      values.push(patch.notes);
    }
    if (patch.spentAt !== undefined) {
      sets.push("spent_at = ?");
      values.push(patch.spentAt);
    }
    if (sets.length === 0) return;

    sets.push("updated_at = ?");
    values.push(new Date().toISOString());

    values.push(id);
    await withDb(async (db) => {
      await db.run(`UPDATE spend_entries SET ${sets.join(", ")} WHERE id = ?;`, values);
    });
  },

  async delete(id: number): Promise<void> {
    await withDb(async (db) => {
      await db.run(`DELETE FROM spend_entries WHERE id = ?;`, [id]);
    });
  },

  /**
   * Recompute the day's total from `spend_entries` and write it back
   * to `daily_logs.spent`. Creates the `daily_logs` row if it doesn't
   * exist yet (first entry for a fresh date). Never mutates
   * `confirmed_at` — confirmation remains an explicit user action.
   *
   * Returns the updated total. A return value of 0 with no pre-existing
   * `daily_logs` row is a no-op (we don't materialise empty days).
   */
  async rollUp(logDate: string, scoreAtLog: number | null = null): Promise<number> {
    const total = await this.sumForDate(logDate);
    const now = new Date().toISOString();

    await withDb(async (db) => {
      // Check for an existing daily_logs row. We want "create if
      // missing" semantics, but only when there's something to record.
      const existing = rows<DailyLogRow>(
        await db.query(`SELECT * FROM daily_logs WHERE log_date = ?;`, [logDate]),
      )[0];

      if (!existing && total === 0) {
        // Nothing to write — no entries and no existing row.
        return;
      }

      await db.run(
        `INSERT INTO daily_logs (log_date, spent, notes, category, score_at_log, confirmed_at, logged_at)
         VALUES (?, ?, NULL, NULL, ?, NULL, ?)
         ON CONFLICT(log_date) DO UPDATE SET
           spent = excluded.spent,
           score_at_log = COALESCE(daily_logs.score_at_log, excluded.score_at_log),
           logged_at = excluded.logged_at;`,
        [logDate, total, scoreAtLog, now],
      );
    });

    return total;
  },

  /**
   * Total row count — symmetric with dailyLogsRepo.count() so the
   * insights engine can gate entry-aware cards on data volume.
   */
  async count(): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query(`SELECT COUNT(*) AS c FROM spend_entries;`);
      const row = rows<{ c: number }>(res)[0];
      return row?.c ?? 0;
    });
  },
} as const;

/* ==================================================================
 * manual_credits
 * ==================================================================
 *
 * Append-only, like balance_snapshots. Scoring treats these as
 * additive: they boost effective balance on the day they landed.
 * ================================================================== */

export interface ManualCreditRecord {
  id: number;
  label: string;
  amount: number;
  /** ISO date string (YYYY-MM-DD). */
  creditedAt: string;
}

interface ManualCreditRow {
  id: number;
  label: string;
  amount: number;
  credited_at: string;
}

function mapManualCredit(row: ManualCreditRow): ManualCreditRecord {
  return {
    id: row.id,
    label: row.label,
    amount: row.amount,
    creditedAt: row.credited_at,
  };
}

export const manualCreditsRepo = {
  async listAll(): Promise<ManualCreditRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM manual_credits ORDER BY credited_at DESC, id DESC;",
      );
      return rows<ManualCreditRow>(res).map(mapManualCredit);
    });
  },

  async listAfter(inclusiveStartDate: string): Promise<ManualCreditRecord[]> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT * FROM manual_credits WHERE credited_at >= ? ORDER BY credited_at DESC, id DESC;",
        [inclusiveStartDate],
      );
      return rows<ManualCreditRow>(res).map(mapManualCredit);
    });
  },

  async insert(input: { label: string; amount: number; creditedAt?: string }): Promise<number> {
    const creditedAt = input.creditedAt ?? new Date().toISOString().slice(0, 10);
    return withDb(async (db) => {
      const res = await db.run(
        "INSERT INTO manual_credits (label, amount, credited_at) VALUES (?, ?, ?);",
        [input.label, input.amount, creditedAt],
      );
      return coerceLastId(res.changes?.lastId);
    });
  },

  async delete(id: number): Promise<void> {
    await withDb(async (db) => {
      await db.run("DELETE FROM manual_credits WHERE id = ?;", [id]);
    });
  },

  /**
   * Sum of credits on or after a given date. Useful for effective-
   * balance math that needs to account for one-off windfalls since
   * the last snapshot.
   */
  async sumSince(inclusiveStartDate: string): Promise<number> {
    return withDb(async (db) => {
      const res = await db.query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM manual_credits WHERE credited_at >= ?;",
        [inclusiveStartDate],
      );
      const row = rows<{ total: number }>(res)[0];
      return row?.total ?? 0;
    });
  },
} as const;

/* ==================================================================
 * settings — single-row table
 * ==================================================================
 *
 * Singleton, pinned to id = 1. Seed defaults are declared in the
 * initial migration; this repo only reads / updates.
 * ================================================================== */

export type ThemeModeDb = "light" | "dark" | "system";

export interface SettingsRecord {
  id: number;
  /** HH:MM (24h). */
  notificationTime: string;
  notificationsEnabled: boolean;
  theme: ThemeModeDb;
  onboardingVersion: number;
}

interface SettingsRow {
  id: number;
  notification_time: string;
  notifications_enabled: number;
  theme: string;
  onboarding_version: number;
}

function mapSettings(row: SettingsRow): SettingsRecord {
  const theme: ThemeModeDb =
    row.theme === "light" || row.theme === "dark" || row.theme === "system" ? row.theme : "system";
  return {
    id: row.id,
    notificationTime: row.notification_time,
    notificationsEnabled: toBool(row.notifications_enabled),
    theme,
    onboardingVersion: row.onboarding_version,
  };
}

/**
 * Defaults kept in sync with migration 001's INSERT statement. Used
 * by `get()` below as a fallback when the row is somehow missing
 * (e.g. a half-run migration — not supposed to happen, but the app
 * should never crash because of it).
 */
export const DEFAULT_SETTINGS: SettingsRecord = {
  id: 1,
  notificationTime: "21:00",
  notificationsEnabled: true,
  theme: "system",
  onboardingVersion: 1,
};

export const settingsRepo = {
  /**
   * Reads the settings singleton. If the row is missing (theoretically
   * impossible after migration 001, but defensive), seeds the defaults
   * and returns them.
   */
  async get(): Promise<SettingsRecord> {
    return withDb(async (db) => {
      const res = await db.query("SELECT * FROM settings WHERE id = 1;");
      const row = rows<SettingsRow>(res)[0];
      if (row) return mapSettings(row);

      // Re-seed and return defaults. A missing settings row is a
      // corrupted-install signal; self-healing is better than hard fail.
      await db.run(
        `INSERT INTO settings (id, notification_time, notifications_enabled, theme, onboarding_version)
         VALUES (1, ?, ?, ?, ?);`,
        [
          DEFAULT_SETTINGS.notificationTime,
          fromBool(DEFAULT_SETTINGS.notificationsEnabled),
          DEFAULT_SETTINGS.theme,
          DEFAULT_SETTINGS.onboardingVersion,
        ],
      );
      return DEFAULT_SETTINGS;
    });
  },

  async update(patch: Partial<Omit<SettingsRecord, "id">>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.notificationTime !== undefined) {
      sets.push("notification_time = ?");
      values.push(patch.notificationTime);
    }
    if (patch.notificationsEnabled !== undefined) {
      sets.push("notifications_enabled = ?");
      values.push(fromBool(patch.notificationsEnabled));
    }
    if (patch.theme !== undefined) {
      sets.push("theme = ?");
      values.push(patch.theme);
    }
    if (patch.onboardingVersion !== undefined) {
      sets.push("onboarding_version = ?");
      values.push(patch.onboardingVersion);
    }
    if (sets.length === 0) return;

    await withDb(async (db) => {
      await db.run(`UPDATE settings SET ${sets.join(", ")} WHERE id = 1;`, values);
    });
  },
} as const;

/* ==================================================================
 * Dev inspector
 * ==================================================================
 *
 * Small JSON-dump helper consumed by the style-guide inspector. Not
 * exported through any feature-code boundary — screens must NEVER
 * import this; it's a dev affordance only.
 * ================================================================== */

export interface DbDump {
  user: UserRecord | null;
  settings: SettingsRecord;
  incomeSources: IncomeSourceRecord[];
  recurringPayments: RecurringPaymentRecord[];
  balanceSnapshots: BalanceSnapshotRecord[];
  manualCredits: ManualCreditRecord[];
  dailyLogs: DailyLogRecord[];
  spendEntries: SpendEntryRecord[];
}

export async function dumpAllTables(): Promise<DbDump> {
  const [
    user,
    settings,
    incomeSources,
    recurringPayments,
    balanceSnapshots,
    manualCredits,
    dailyLogs,
    spendEntries,
  ] = await Promise.all([
    userRepo.get(),
    settingsRepo.get(),
    incomeSourcesRepo.listAll(),
    recurringPaymentsRepo.listAll(),
    balanceSnapshotsRepo.history(50),
    manualCreditsRepo.listAll(),
    dailyLogsRepo.listRecent(90),
    // 90-day rolling window of entries — enough for history expand
    // rows and the category pie chart. The export path walks the
    // same window, so exports stay bounded.
    spendEntriesRepo.listBetween(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10),
    ),
  ]);
  return {
    user,
    settings,
    incomeSources,
    recurringPayments,
    balanceSnapshots,
    manualCredits,
    dailyLogs,
    spendEntries,
  };
}
