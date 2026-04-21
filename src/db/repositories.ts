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
      const res = await db.query(
        "SELECT COUNT(*) AS c FROM income_sources WHERE is_active = 1;",
      );
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

  async update(
    id: number,
    patch: Partial<Omit<RecurringPaymentRecord, "id">>,
  ): Promise<void> {
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
  spent: number;
  notes: string | null;
  category: CategoryKey | null;
  scoreAtLog: number | null;
  /** ISO timestamp. */
  loggedAt: string;
}

interface DailyLogRow {
  id: number;
  log_date: string;
  spent: number;
  notes: string | null;
  category: string | null;
  score_at_log: number | null;
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
    loggedAt: row.logged_at,
  };
}

export interface DailyLogInput {
  logDate: string;
  spent: number;
  notes?: string | null;
  category?: CategoryKey | null;
  scoreAtLog?: number | null;
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
   */
  async upsert(input: DailyLogInput): Promise<DailyLogRecord> {
    const loggedAt = new Date().toISOString();
    const notes = input.notes ?? null;
    const category = input.category ?? null;
    const scoreAtLog = input.scoreAtLog ?? null;

    return withDb(async (db) => {
      await db.run(
        `INSERT INTO daily_logs (log_date, spent, notes, category, score_at_log, logged_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(log_date) DO UPDATE SET
           spent = excluded.spent,
           notes = excluded.notes,
           category = excluded.category,
           score_at_log = excluded.score_at_log,
           logged_at = excluded.logged_at;`,
        [input.logDate, input.spent, notes, category, scoreAtLog, loggedAt],
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
        await db.run(
          `INSERT INTO daily_logs (log_date, spent, notes, category, score_at_log, logged_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(log_date) DO UPDATE SET
             spent = excluded.spent,
             notes = excluded.notes,
             category = excluded.category,
             score_at_log = excluded.score_at_log,
             logged_at = excluded.logged_at;`,
          [
            entry.logDate,
            entry.spent,
            entry.notes ?? null,
            entry.category ?? null,
            entry.scoreAtLog ?? null,
            loggedAt,
          ],
        );
      }
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
  ] = await Promise.all([
    userRepo.get(),
    settingsRepo.get(),
    incomeSourcesRepo.listAll(),
    recurringPaymentsRepo.listAll(),
    balanceSnapshotsRepo.history(50),
    manualCreditsRepo.listAll(),
    dailyLogsRepo.listRecent(90),
  ]);
  return {
    user,
    settings,
    incomeSources,
    recurringPayments,
    balanceSnapshots,
    manualCredits,
    dailyLogs,
  };
}
