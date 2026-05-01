-- ============================================================
-- amban.io — Migration 003: schema_migrations tracker table
-- Source of truth: CLAUDE.md §14.2 (Versioning Model)
--
-- Why this migration exists
-- -------------------------
-- Prior to v0.2.0, migration tracking lived exclusively in Capacitor
-- Preferences (a key-value store backed by SharedPreferences on
-- Android and UserDefaults on iOS). That single integer — the
-- highest applied version — was the only record of which migrations
-- had run. If Preferences were cleared (OS storage pressure, user
-- clearing app data without uninstalling, or a bug in the reset
-- pipeline), the runner would silently re-apply every migration,
-- which is safe for idempotent DDL but dangerous for data-mutating
-- migrations we may ship in the future.
--
-- This migration creates a proper `schema_migrations` table inside
-- the SQLite database itself. Each row records a version number,
-- the migration's name, a checksum of its normalised SQL, and the
-- timestamp at which it was applied. The runner backfills this table
-- on the first v0.2.0 launch for installations upgrading from
-- v0.1.x, so neither the table nor Preferences can disagree about
-- what's been applied.
--
-- Migration safety
-- ----------------
-- Pure-additive: one new table, no existing rows touched. The
-- `IF NOT EXISTS` guard makes the DDL idempotent — safe to replay
-- if a partial failure leaves the runner mid-transaction.
-- ============================================================

-- The tracker table. One row per applied migration.
-- `version` is the PRIMARY KEY so the runner can do a single
-- `SELECT version FROM schema_migrations` to build its applied set.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
