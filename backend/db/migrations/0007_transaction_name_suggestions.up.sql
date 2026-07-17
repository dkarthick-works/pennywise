-- Per-user, per-section learned transaction-name history for autocomplete.
-- The source value is transactions.category; settlement labels are synthetic
-- and deliberately excluded.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE transaction_name_suggestions (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section         section NOT NULL,
    normalized_name TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    use_count        BIGINT NOT NULL DEFAULT 1 CHECK (use_count >= 1),
    last_used_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, section, normalized_name),

    CHECK (display_name = btrim(display_name)),
    CHECK (display_name <> ''),
    CHECK (char_length(display_name) <= 200),
    CHECK (char_length(normalized_name) <= 200)
);

-- GIN serves contains/similarity searches; the two B-tree indexes serve short
-- prefix and empty-query popularity lookups respectively.
CREATE INDEX transaction_name_suggestions_trgm_idx
    ON transaction_name_suggestions
    USING GIN (normalized_name gin_trgm_ops);

CREATE INDEX transaction_name_suggestions_prefix_idx
    ON transaction_name_suggestions
    (user_id, section, normalized_name text_pattern_ops);

CREATE INDEX transaction_name_suggestions_ranking_idx
    ON transaction_name_suggestions
    (user_id, section, use_count DESC, last_used_at DESC, display_name);

-- Backfill the learned history before installing triggers. The most recently
-- updated spelling/casing is retained; UUID makes equal timestamps deterministic.
WITH eligible AS (
    SELECT
        id,
        user_id,
        section,
        regexp_replace(btrim(category), '[[:space:]]+', ' ', 'g') AS display_name,
        lower(regexp_replace(btrim(category), '[[:space:]]+', ' ', 'g')) AS normalized_name,
        updated_at
    FROM transactions
    WHERE kind <> 'settlement'
),
ranked AS (
    SELECT
        user_id,
        section,
        normalized_name,
        display_name,
        count(*) OVER (
            PARTITION BY user_id, section, normalized_name
        )::bigint AS use_count,
        max(updated_at) OVER (
            PARTITION BY user_id, section, normalized_name
        ) AS last_used_at,
        row_number() OVER (
            PARTITION BY user_id, section, normalized_name
            ORDER BY updated_at DESC, id DESC
        ) AS row_num
    FROM eligible
    WHERE display_name <> ''
      AND char_length(display_name) <= 200
      AND char_length(normalized_name) <= 200
)
INSERT INTO transaction_name_suggestions (
    user_id,
    section,
    normalized_name,
    display_name,
    use_count,
    last_used_at
)
SELECT
    user_id,
    section,
    normalized_name,
    display_name,
    use_count,
    last_used_at
FROM ranked
WHERE row_num = 1;

CREATE FUNCTION learn_transaction_name_suggestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    new_display_name    TEXT;
    new_normalized_name TEXT;
    old_display_name    TEXT;
    old_normalized_name TEXT;
BEGIN
    -- Blank, oversized and synthesized settlement labels remain valid
    -- transaction data, but do not enter autocomplete history.
    IF NEW.kind = 'settlement' THEN
        RETURN NEW;
    END IF;

    new_display_name := regexp_replace(btrim(NEW.category), '[[:space:]]+', ' ', 'g');
    new_normalized_name := lower(new_display_name);

    IF new_display_name = ''
       OR char_length(new_display_name) > 200
       OR char_length(new_normalized_name) > 200 THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.kind <> 'settlement' THEN
        old_display_name := regexp_replace(btrim(OLD.category), '[[:space:]]+', ' ', 'g');
        old_normalized_name := lower(old_display_name);

        -- Editing unrelated transaction fields or only correcting the visible
        -- spelling must not count as another use of the name.
        IF OLD.section = NEW.section AND old_normalized_name = new_normalized_name THEN
            IF old_display_name IS DISTINCT FROM new_display_name THEN
                UPDATE transaction_name_suggestions
                SET display_name = CASE
                        WHEN NEW.updated_at >= last_used_at THEN new_display_name
                        ELSE display_name
                    END,
                    last_used_at = GREATEST(last_used_at, NEW.updated_at)
                WHERE user_id = NEW.user_id
                  AND section = NEW.section
                  AND normalized_name = new_normalized_name;
            END IF;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO transaction_name_suggestions (
        user_id,
        section,
        normalized_name,
        display_name,
        use_count,
        last_used_at
    )
    VALUES (
        NEW.user_id,
        NEW.section,
        new_normalized_name,
        new_display_name,
        1,
        NEW.updated_at
    )
    ON CONFLICT (user_id, section, normalized_name)
    DO UPDATE SET
        display_name = CASE
            WHEN EXCLUDED.last_used_at >= transaction_name_suggestions.last_used_at
                THEN EXCLUDED.display_name
            ELSE transaction_name_suggestions.display_name
        END,
        use_count = transaction_name_suggestions.use_count + 1,
        last_used_at = GREATEST(
            transaction_name_suggestions.last_used_at,
            EXCLUDED.last_used_at
        );

    RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_learn_name_after_insert
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION learn_transaction_name_suggestion();

CREATE TRIGGER transactions_learn_name_after_update
AFTER UPDATE OF category, section, kind ON transactions
FOR EACH ROW
WHEN (
    (OLD.category, OLD.section, OLD.kind)
    IS DISTINCT FROM
    (NEW.category, NEW.section, NEW.kind)
)
EXECUTE FUNCTION learn_transaction_name_suggestion();
