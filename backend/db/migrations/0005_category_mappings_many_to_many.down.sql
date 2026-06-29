-- Roll back many-to-many category mappings to the prior one-group-per-label model.
-- This is destructive: overlapping memberships are dropped, keeping the earliest
-- mapping per (user_id, normalized_category).

DELETE FROM category_mappings cm
WHERE cm.id NOT IN (
    SELECT DISTINCT ON (user_id, normalized_category) id
    FROM category_mappings
    ORDER BY user_id, normalized_category, created_at ASC, id ASC
);

ALTER TABLE category_mappings
    DROP CONSTRAINT category_mappings_user_group_norm_key;

ALTER TABLE category_mappings
    ADD CONSTRAINT category_mappings_user_id_normalized_category_key
    UNIQUE (user_id, normalized_category);
