-- High-level category groups and mappings from raw transaction category text.

CREATE TABLE category_groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, normalized_name)
);

CREATE TABLE category_mappings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_category        TEXT NOT NULL,
    normalized_category TEXT NOT NULL,
    group_id            UUID NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, normalized_category)
);

CREATE INDEX category_groups_user_idx ON category_groups (user_id);
CREATE INDEX category_mappings_user_norm_idx ON category_mappings (user_id, normalized_category);
CREATE INDEX category_mappings_group_idx ON category_mappings (group_id);
