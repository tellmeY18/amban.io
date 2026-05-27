-- 007_ledger.sql
--
-- Unified balance ledger — records every event that changes the user's
-- effective balance. Acts as an audit trail / bank statement view.
-- Each row represents a single transaction with a signed delta and the
-- resulting balance_after. Editing a historical entry triggers a cascade
-- recomputation of all subsequent balance_after values.
--
-- Types:
--   income_credit  — recurring income marked as received
--   spend          — daily spend log entry
--   balance_set    — manual balance update from Settings
--   manual_credit  — one-off income (freelance, refund, gift)

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income_credit', 'spend', 'balance_set', 'manual_credit')),
  delta REAL NOT NULL,
  balance_after REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  reference_type TEXT,
  reference_id INTEGER,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_occurred_at
  ON ledger (occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_reference
  ON ledger (reference_type, reference_id);
