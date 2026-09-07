CREATE TABLE events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 5000),
 target_date DATE,
 status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
 suggestions_enabled BOOLEAN NOT NULL DEFAULT true,
 version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ
);
CREATE INDEX events_active_user_idx ON events(user_id, created_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX events_candidates_idx ON events(user_id, target_date, id) WHERE deleted_at IS NULL AND status = 'planned' AND suggestions_enabled;
CREATE TABLE event_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 expected_cost NUMERIC(14,2) CHECK (expected_cost BETWEEN 0 AND 999999999999.99),
 actual_cost NUMERIC(14,2) CHECK (actual_cost BETWEEN 0 AND 999999999999.99),
 position INTEGER NOT NULL CHECK (position >= 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(event_id, position) DEFERRABLE INITIALLY DEFERRED
);
