CREATE TABLE reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name = btrim(name) AND name <> ''),
  is_general BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reserves_user_name_unique_idx ON reserves (user_id, lower(name));
CREATE UNIQUE INDEX reserves_one_general_per_user_idx ON reserves (user_id) WHERE is_general;
CREATE INDEX reserves_user_status_idx ON reserves (user_id, archived_at, created_at);

CREATE TABLE reserve_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('deposit', 'reserve_spend', 'move_to_income', 'funded_expense', 'transfer')),
  occurred_on DATE NOT NULL,
  description TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reserve_operations_user_history_idx
  ON reserve_operations (user_id, occurred_on DESC, created_at DESC, id DESC);

CREATE TABLE reserve_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES reserve_operations(id) ON DELETE CASCADE,
  reserve_id UUID NOT NULL REFERENCES reserves(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation_id, reserve_id, direction)
);

CREATE INDEX reserve_entries_reserve_history_idx ON reserve_entries (reserve_id, created_at, id);
CREATE INDEX reserve_entries_operation_idx ON reserve_entries (operation_id);

CREATE FUNCTION reserve_balance(target_reserve_id UUID) RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(SUM(CASE direction WHEN 'deposit' THEN amount ELSE -amount END), 0)::numeric
  FROM reserve_entries
  WHERE reserve_id = target_reserve_id
$$;

CREATE TABLE reserve_operation_transactions (
  reserve_operation_id UUID NOT NULL REFERENCES reserve_operations(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('funding_income', 'funded_expense')),
  PRIMARY KEY (reserve_operation_id, transaction_id),
  UNIQUE (transaction_id)
);
