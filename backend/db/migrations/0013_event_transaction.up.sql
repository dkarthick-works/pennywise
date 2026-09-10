ALTER TABLE events
  ADD COLUMN converted_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX events_converted_transaction_idx
  ON events(converted_transaction_id)
  WHERE converted_transaction_id IS NOT NULL;
