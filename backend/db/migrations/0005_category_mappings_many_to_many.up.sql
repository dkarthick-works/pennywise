-- Allow a transaction category text to belong to multiple category groups.

ALTER TABLE category_mappings
    DROP CONSTRAINT category_mappings_user_id_normalized_category_key;

ALTER TABLE category_mappings
    ADD CONSTRAINT category_mappings_user_group_norm_key
    UNIQUE (user_id, group_id, normalized_category);
