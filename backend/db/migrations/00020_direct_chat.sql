-- +goose Up

-- Extend messaging with 1:1 direct messages. A direct conversation has no chapter
-- (chapter_id NULL) and its participants live in conversation_members. Club group
-- chats keep deriving their membership from chapter_members, so this table is only
-- populated for direct chats.
ALTER TABLE conversations ALTER COLUMN chapter_id DROP NOT NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_type_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
    CHECK (type IN ('chapter', 'event', 'direct'));

CREATE TABLE conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    user_id         TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_conversation_members_user ON conversation_members (user_id);

-- +goose Down
DROP TABLE IF EXISTS conversation_members;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_type_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_type_check
    CHECK (type IN ('chapter', 'event'));
-- (chapter_id stays nullable on rollback — harmless, and direct rows are gone.)
