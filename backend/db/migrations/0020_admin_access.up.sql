-- App-level authorization. Goauth proves identity; Pennywise owns this flag so
-- access can be revoked immediately and stays scoped to this application.
ALTER TABLE users
    ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
