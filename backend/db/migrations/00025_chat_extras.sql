-- +goose Up

-- Chat, WhatsApp-grade. Three independent pieces:
--
-- 1. Per-user conversation prefs — mute (no badges) and archive (tucked away).
CREATE TABLE conversation_prefs (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    muted           BOOLEAN NOT NULL DEFAULT FALSE,
    archived        BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

-- 2. Reactions — one per user per message (re-reacting replaces the emoji).
CREATE TABLE message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

-- 3. Reply-quoting — a message may quote an earlier one in the same conversation.
ALTER TABLE messages ADD COLUMN reply_to_id UUID REFERENCES messages(id);

-- +goose Down
ALTER TABLE messages DROP COLUMN reply_to_id;
DROP TABLE message_reactions;
DROP TABLE conversation_prefs;
