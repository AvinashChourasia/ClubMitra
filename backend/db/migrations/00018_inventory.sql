-- +goose Up

-- Phase 2 — Inventory. Clubs track gear (t-shirts, medals, bibs, equipment):
-- how much they own (total_quantity) and how much is on hand (available_qty).
-- Issuing hands stock out; returning brings it back; restocking acquires more.
-- Paid purchases (with a platform cut) arrive in Phase 3 alongside payments.
CREATE TABLE inventory_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id     UUID NOT NULL REFERENCES chapters(id),
    name           TEXT NOT NULL,
    category       TEXT,                         -- apparel|equipment|medals|bibs|other
    total_quantity INT NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
    available_qty  INT NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
    size_breakdown JSONB,                        -- {"S":10,"M":25,...} (informational)
    unit_price     NUMERIC(10,2),
    currency       TEXT NOT NULL DEFAULT 'INR',
    image_url      TEXT,                         -- Cloudinary URL
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
CREATE INDEX idx_inventory_items_chapter ON inventory_items (chapter_id) WHERE deleted_at IS NULL;

CREATE TRIGGER inventory_items_set_updated_at
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventory_transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID NOT NULL REFERENCES inventory_items(id),
    chapter_id  UUID NOT NULL REFERENCES chapters(id),
    user_id     TEXT REFERENCES users(id),       -- recipient (issue) / returner, optional
    type        TEXT NOT NULL CHECK (type IN ('issue', 'return', 'restock', 'purchase')),
    quantity    INT NOT NULL CHECK (quantity > 0),
    size        TEXT,
    amount      NUMERIC(10,2),                   -- set for paid purchases (Phase 3)
    currency    TEXT NOT NULL DEFAULT 'INR',
    notes       TEXT,
    created_by  TEXT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);
CREATE INDEX idx_inventory_txn_item ON inventory_transactions (item_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS inventory_items;
