-- +goose Up

-- Phase 2 — Messaging. One conversation per context: a chapter's group chat, or
-- a single run's event chat. Members post; admins can broadcast announcements
-- (which also fan out as push). Delivery is pull-on-open (no websockets yet).
CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id  UUID NOT NULL REFERENCES chapters(id),
    run_id      UUID REFERENCES runs(id),          -- set for an event (run) chat
    type        TEXT NOT NULL CHECK (type IN ('chapter', 'event')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One chapter chat per chapter; one event chat per run.
CREATE UNIQUE INDEX uq_conversation_chapter ON conversations (chapter_id) WHERE type = 'chapter';
CREATE UNIQUE INDEX uq_conversation_run ON conversations (run_id) WHERE run_id IS NOT NULL;

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    sender_id       TEXT NOT NULL REFERENCES users(id),
    body            TEXT,
    media_url       TEXT,                          -- Cloudinary URL
    media_type      TEXT,                          -- image|video|file
    is_pinned       BOOLEAN NOT NULL DEFAULT false,
    is_announcement BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at DESC) WHERE deleted_at IS NULL;

-- Per-user read marker, for unread badges later.
CREATE TABLE message_reads (
    user_id         TEXT NOT NULL REFERENCES users(id),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, conversation_id)
);

-- +goose Down
DROP TABLE IF EXISTS message_reads;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
