-- Ingestion only. No AI worker is started until the next implementation phase.
CREATE TABLE sms_sender_config (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    version BIGINT NOT NULL CHECK (version > 0),
    senders TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sms_sender_config (version) VALUES (1); -- fail closed until maintainers populate it

CREATE TABLE sms_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
    token_hash TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    consent_version BIGINT NOT NULL DEFAULT 1,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_upload_at TIMESTAMPTZ,
    last_scan_end BIGINT,
    UNIQUE (id, user_id)
);
CREATE INDEX sms_devices_user_idx ON sms_devices(user_id);

CREATE TABLE sms_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL,
    consent_version BIGINT NOT NULL,
    fingerprint_version INTEGER NOT NULL CHECK (fingerprint_version = 1),
    fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    sender TEXT,
    received_at BIGINT,
    body TEXT,
    allowlist_version BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
        ('queued','classified','rejected','uncertain','pending_review','approved','ignored','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    result JSONB,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, fingerprint_version, fingerprint),
    FOREIGN KEY (device_id, user_id) REFERENCES sms_devices(id, user_id)
);
CREATE INDEX sms_suggestions_pending_idx ON sms_suggestions(id)
    WHERE status IN ('queued','classified');
CREATE INDEX sms_suggestions_user_idx ON sms_suggestions(user_id, created_at DESC);
