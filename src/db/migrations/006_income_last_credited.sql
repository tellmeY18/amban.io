-- 006_income_last_credited.sql
--
-- Tracks when an income source was last manually marked as received
-- (credited). This enables the "early salary" flow: when a user
-- receives their income before the configured credit_day, they can
-- mark it as credited early. The scoring engine then skips this
-- source for the current cycle and targets next month's credit day.
--
-- Mirrors the pattern from 005_recurring_last_paid.sql.
-- The column is nullable: NULL means "never manually credited".
-- The value is an ISO date string (YYYY-MM-DD) in local time.

ALTER TABLE income_sources ADD COLUMN last_credited_date TEXT;
