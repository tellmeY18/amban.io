-- ============================================================
-- amban.io — Migration 002: Per-entry spend capture
--
-- Source of truth: CLAUDE.md §9.2 (Daily Log Screen — revised) and
-- the "Logging two-tier model" note in ROADMAP.md.
--
-- Why this migration exists
-- -------------------------
-- v0.1.0 shipped a single-row-per-day model in `daily_logs`:
-- one amount, one optional category, one notes field per date.
-- That matches how the score math wants to *consume* a day, but it
-- does not match how a human actually *lives* a day. A person
-- spends ₹120 on chai in the morning, ₹800 on groceries at lunch,
-- ₹60 on an auto in the evening — three distinct transactions with
-- three distinct categories. Forcing them to mentally roll that up
-- into one number before tapping "save" is the single biggest piece
-- of friction in the daily use loop.
--
-- This migration introduces `spend_entries`: an append-only log of
-- individual spend events. `daily_logs` stays exactly as it was —
-- it continues to be the authoritative "this is what this day cost"
-- row that drives scoring, history, and insights. The relationship
-- is:
--
--   spend_entries  (N)  ── rolls up into ──▶  daily_logs  (1 per day)
--
-- The daily total in `daily_logs.spent` is the *confirmed* total.
-- It is written in two ways:
--
--   1. Implicitly, every time an entry is added/edited/deleted on a
--      day that already has a `daily_logs` row — we keep the total
--      in sync so scoring never lags behind entries.
--   2. Explicitly, when the user confirms the day's total from the
--      evening notification prompt. Confirmation is just a flag —
--      `daily_logs.confirmed_at` goes from NULL to an ISO timestamp.
--
-- Until a day is confirmed, the user can keep adding/editing/
-- deleting entries and the total stays fluid. After confirmation,
-- edits are still allowed up until midnight local (enforced at the
-- UI layer, not here — SQLite does not know what "local midnight"
-- means). Past days with `confirmed_at` set are treated as sealed
-- in the UI; the database never mutates them on its own.
--
-- Design rules reflected in this schema
-- -------------------------------------
--   * `spend_entries.log_date` is denormalised from `spent_at` so
--     the common "sum today's entries" query is a single indexed
--     range scan with no date math.
--   * We DO NOT foreign-key `spend_entries.log_date` to
--     `daily_logs.log_date`. Entries can exist before a `daily_logs`
--     row is created — the `daily_logs` row is created lazily by the
--     store the first time an entry lands for a given date.
--   * `daily_logs.confirmed_at` is nullable on purpose. NULL means
--     "still fluid / user has not said they're done for the day".
--   * Categories on entries use the Appendix C enum (stored as free
--     TEXT; the app validates). Null category is permitted for the
--     user who just wants to capture an amount and move on.
--   * Existing `daily_logs.notes` / `daily_logs.category` columns
--     remain. They represent the day's headline note/category
--     (what the user wrote on the confirmation sheet), distinct from
--     any per-entry notes. We do not try to "reconcile" them; they
--     are two different things.
--
-- Migration safety
-- ----------------
-- This migration is pure-additive: a new table, new columns on
-- `daily_logs`, new indexes. No existing rows are rewritten. A
-- freshly-installed device runs 001 then 002 in one transaction;
-- an upgrading device runs only 002. Either way, the end state is
-- identical. Per Appendix J, this file is immutable once shipped —
-- any future change lives in `003_*.sql`.
-- ============================================================

-- ------------------------------------------------------------
-- New table: spend_entries
--
-- One row per individual spend event the user logs. Entries are
-- append-only from the user's mental model, but we expose
-- update/delete so a typo or an accidental tap is recoverable
-- before the day is confirmed.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spend_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Local calendar date the entry belongs to, YYYY-MM-DD.
  -- Denormalised from spent_at so date-range queries stay index-only.
  log_date TEXT NOT NULL,

  -- Amount in rupees (REAL to match the rest of the schema). Must be
  -- strictly positive — a zero/negative entry is meaningless and the
  -- UI rejects it before the write. The CHECK is a safety net, not
  -- a primary validator.
  amount REAL NOT NULL CHECK (amount > 0),

  -- Optional category key from Appendix C. NULL = uncategorised.
  -- Stored as TEXT; enum validity is enforced by the app layer so
  -- future category additions do not need another migration.
  category TEXT,

  -- Optional free-text note for this specific entry (e.g. "auto
  -- to office", "groceries at Reliance Fresh"). Per-entry notes
  -- are independent of the day's headline note on `daily_logs`.
  notes TEXT,

  -- ISO timestamp of when the spend *happened* (user-editable; we
  -- default to "now" at insert time). Separate from `created_at` so
  -- a user who logs yesterday's missed entry at 9 PM today can set
  -- the correct spent_at without losing the audit trail.
  spent_at TEXT NOT NULL,

  -- ISO timestamp of when the row was written to the DB. Set once
  -- at insert; never updated on edits. Paired with `updated_at` for
  -- the "recently edited" indicator in the entries list.
  created_at TEXT NOT NULL,

  -- ISO timestamp of the most recent edit, or NULL if never edited.
  updated_at TEXT
);

-- ------------------------------------------------------------
-- Extend daily_logs with the confirmation flag.
--
-- SQLite does not support `ADD COLUMN IF NOT EXISTS` prior to 3.35,
-- and even on newer versions the syntax is awkward. Instead we
-- rely on the fact that this migration runs exactly once per
-- installation (the migration runner persists schema_version and
-- short-circuits on re-entry). A fresh install runs 001 + 002
-- in sequence; 001 creates the table, 002 adds the column.
--
-- If `confirmed_at` is NULL the day's total is still considered
-- "fluid" and is kept in sync with `spend_entries` automatically.
-- Once set to an ISO timestamp, it means the user has explicitly
-- confirmed the day's total (usually from the 9 PM notification
-- sheet). Edits after confirmation update the total but leave
-- `confirmed_at` at its original value so we retain the audit
-- trail of "when did the user first say they were done".
-- ------------------------------------------------------------
ALTER TABLE daily_logs ADD COLUMN confirmed_at TEXT;

-- ------------------------------------------------------------
-- Indexes
--
-- The hot queries against `spend_entries` are:
--   (a) "all of today's entries, newest first"
--   (b) "sum(amount) for today"
--   (c) "all entries in a date range for the history expand-row"
--
-- A single compound index on (log_date, spent_at DESC) serves all
-- three: (a) and (c) scan the range, (b) scans and sums in one
-- pass, all without touching the base table for the common case.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_spend_entries_date_time
  ON spend_entries (log_date, spent_at DESC);

-- Covering index for the category pie chart on the Insights screen,
-- which sums by category over a rolling window. Kept separate from
-- the date-time index because the query shape is different enough
-- that combining them would not help the planner.
CREATE INDEX IF NOT EXISTS idx_spend_entries_category
  ON spend_entries (category);
