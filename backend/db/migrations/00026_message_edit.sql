-- +goose Up

-- WhatsApp-style message editing: senders may rewrite their own message's text;
-- edited_at marks it so clients show an "edited" label.
ALTER TABLE messages ADD COLUMN edited_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE messages DROP COLUMN edited_at;
