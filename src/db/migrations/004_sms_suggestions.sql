-- ============================================================
-- amban.io — Migration 004: SMS suggestions table
-- Source of truth: CLAUDE.md §15.7 (SMS Capture — Storage Schema)
--
-- Why this migration exists
-- -------------------------
-- v0.2.0 introduces on-device SMS capture for Android users. The
-- app reads transactional SMS from the system inbox, parses them
-- locally, and presents debit/credit suggestions the user can
-- confirm with one tap. This table stores the parsed results —
-- never the original SMS body.
--
-- Privacy contract: the original SMS body is NEVER persisted. Only
-- the extracted structured fields (amount, direction, counterparty,
-- account last-4, reference ID) land in this table. See §15.8.
--
-- Design rules reflected in this schema
-- -------------------------------------
--   * `message_id` is the stable ID from the Android Telephony
--     provider's `_id` combined with a body hash. The UNIQUE
--     constraint makes upserts idempotent — the same SMS scanned
--     twice produces no duplicate suggestion.
--   * `direction` is restricted to 'debit' | 'credit' via CHECK.
--   * `status` tracks the suggestion lifecycle: pending → accepted
--     or dismissed. Accepted suggestions link back to the daily_logs
--     or manual_credits row they spawned via the nullable FK columns.
--   * `confidence` is a 0..1 float assigned by the parser. Low-
--     confidence results are filtered out before insertion (see
--     SMS_MIN_CONFIDENCE in constants/insightThresholds.ts).
--   * The compound index on (status, received_at DESC) serves the
--     "show me pending suggestions, newest first" hot query that
--     the Home screen and Log tab both run on every resume.
--
-- Migration safety
-- ----------------
-- This migration is pure-additive: a new table and a new index.
-- No existing rows are touched. A freshly-installed device runs
-- 001 → 002 → 004 in one pass; an upgrading device runs only 004.
-- Either way, the end state is identical. Per §14.3, this file is
-- immutable once shipped — any future change lives in 005_*.sql.
-- ============================================================

-- SMS suggestions parsed from bank/UPI transactional messages.
-- One row per unique SMS, identified by message_id.
CREATE TABLE IF NOT EXISTS sms_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Stable identifier: Telephony provider _id + body hash.
  -- UNIQUE ensures idempotent upserts on repeated scans.
  message_id TEXT NOT NULL UNIQUE,

  -- ISO timestamp of when the SMS was received by the device.
  received_at TEXT NOT NULL,

  -- Sender address as reported by Android (e.g. 'HDFCBK', 'AX-PHONPE').
  sender TEXT NOT NULL,

  -- Transaction direction: money out or money in.
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),

  -- Transaction amount in rupees. Must be strictly positive.
  amount REAL NOT NULL CHECK (amount > 0),

  -- Merchant, UPI handle, or person name. Nullable — some messages
  -- only carry amount + direction without a clear counterparty.
  counterparty TEXT,

  -- Last 4 digits of the account or card involved. Nullable.
  account_last4 TEXT,

  -- Bank reference or UPI reference ID. Nullable.
  reference_id TEXT,

  -- Parser confidence score, 0..1. Higher = more fields captured.
  confidence REAL NOT NULL,

  -- Suggestion lifecycle: pending → accepted | dismissed.
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'dismissed')),

  -- When accepted as a spend, links to the daily_logs row it created.
  linked_log_id INTEGER,

  -- When accepted as income, links to the manual_credits row it created.
  linked_credit_id INTEGER,

  -- ISO timestamp of when this row was inserted.
  created_at TEXT NOT NULL
);

-- Hot query: "pending suggestions, newest first" for Home + Log tab.
CREATE INDEX IF NOT EXISTS idx_sms_suggestions_status
  ON sms_suggestions (status, received_at DESC);
