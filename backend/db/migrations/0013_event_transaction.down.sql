DROP INDEX IF EXISTS events_converted_transaction_idx;
ALTER TABLE events DROP COLUMN IF EXISTS converted_transaction_id;
