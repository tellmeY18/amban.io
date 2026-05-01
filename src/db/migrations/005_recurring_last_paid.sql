-- 005_recurring_last_paid.sql
--
-- Tracks when a recurring payment was last marked as paid so the
-- "Upcoming this week" strip and the scoring engine can exclude
-- payments the user already handled this billing cycle. Without
-- this column, "mark as paid" only adjusted the balance — the
-- payment still showed as upcoming and was double-deducted from
-- the score.
--
-- The column is nullable: NULL means "never marked as paid".
-- The value is an ISO date string (YYYY-MM-DD) in local time.

ALTER TABLE recurring_payments ADD COLUMN last_paid_date TEXT;
