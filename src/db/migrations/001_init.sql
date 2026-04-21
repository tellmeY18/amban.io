-- ============================================================
-- amban.io — Migration 001: Initial schema
-- Source of truth: CLAUDE.md §5 (Data Models → SQLite Schema)
--
-- Conventions:
--   * Dates are stored as ISO 8601 strings (TEXT), never epoch numbers.
--   * Single-row tables (user, settings) are pinned to id = 1.
--   * Boolean flags are stored as INTEGER (0 / 1).
--   * Monetary amounts are stored as REAL in rupees (INR has no sub-unit
--     relevance for this app; rounding is handled at the formatter layer).
--
-- Never edit this file after it ships. Add a new numbered migration
-- (002_*.sql, 003_*.sql, …) per Appendix J.
-- ============================================================

-- Users table (single row app)
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY DEFAULT 1,
  name TEXT NOT NULL,
  emoji TEXT,                        -- Optional profile emoji (onboarding Step 2)
  currency TEXT DEFAULT 'INR',
  created_at TEXT NOT NULL,
  onboarding_complete INTEGER DEFAULT 0
);

-- Income sources
CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,               -- "Salary", "Freelance", "Rent Income"
  amount REAL NOT NULL,
  credit_day INTEGER NOT NULL,       -- Day of month: 1–31
  is_active INTEGER DEFAULT 1
);

-- Bank balance snapshots
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount REAL NOT NULL,
  recorded_at TEXT NOT NULL          -- ISO date string
);

-- Recurring payments
CREATE TABLE IF NOT EXISTS recurring_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,               -- "Room Rent", "LIC Premium", "Netflix"
  amount REAL NOT NULL,
  due_day INTEGER NOT NULL,          -- Day of month: 1–31
  category TEXT NOT NULL,            -- See Appendix C: housing | utilities | insurance | subscriptions | emi | food | transport | shopping | health | other
  is_active INTEGER DEFAULT 1
);

-- Daily spend logs
CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL UNIQUE,     -- ISO date: YYYY-MM-DD
  spent REAL NOT NULL DEFAULT 0,
  notes TEXT,
  category TEXT,                     -- Optional category key (Appendix C); null = uncategorised
  score_at_log REAL,                 -- Amban Score at time of logging
  logged_at TEXT NOT NULL
);

-- Manual income credits (non-recurring / one-off)
CREATE TABLE IF NOT EXISTS manual_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  credited_at TEXT NOT NULL          -- ISO date string
);

-- App settings (single row)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  notification_time TEXT DEFAULT '21:00',   -- HH:MM 24hr
  notifications_enabled INTEGER DEFAULT 1,
  theme TEXT DEFAULT 'system',              -- 'light', 'dark', 'system'
  onboarding_version INTEGER DEFAULT 1
);

-- ============================================================
-- Seed rows
--   The settings table is a singleton pinned to id = 1. Every read
--   expects a row to exist, so seed defaults here at migration time.
--   `INSERT OR IGNORE` makes this idempotent — a re-run (e.g. after
--   a partial-migration recovery) never overwrites user-edited
--   preferences.
--
--   The `user` row is NOT seeded here — onboarding Step 2 creates it
--   with the user-supplied name. Until then, `SELECT * FROM user`
--   returning zero rows is the signal to mount the onboarding stack.
-- ============================================================

INSERT OR IGNORE INTO settings (id, notification_time, notifications_enabled, theme, onboarding_version)
VALUES (1, '21:00', 1, 'system', 1);

-- ============================================================
-- Indexes
--   Reads we know will happen often:
--     * daily_logs by date range (history screen, avg window, streaks)
--     * balance_snapshots sorted by recorded_at DESC (latest snapshot lookup)
--     * recurring_payments / income_sources filtered by is_active
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_daily_logs_log_date
  ON daily_logs (log_date);

CREATE INDEX IF NOT EXISTS idx_balance_snapshots_recorded_at
  ON balance_snapshots (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_recurring_payments_active
  ON recurring_payments (is_active);

CREATE INDEX IF NOT EXISTS idx_income_sources_active
  ON income_sources (is_active);

CREATE INDEX IF NOT EXISTS idx_manual_credits_credited_at
  ON manual_credits (credited_at DESC);
