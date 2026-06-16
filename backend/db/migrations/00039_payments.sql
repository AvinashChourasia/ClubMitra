-- +goose Up

-- Payments (Phase 3): real money collection via Razorpay. Replaces the MOCK
-- pay-flows (membership / challenge / inventory / subscription) with a verified
-- gateway. DORMANT until RAZORPAY_KEY_ID/SECRET are configured (orders 503).
--
-- One ledger row per payment attempt. Money is stored as INTEGER PAISE
-- (amount_paise) — never floats — so totals are exact. Single platform account
-- for now: platform_cut_paise is recorded at transaction time (never derived)
-- so a future Razorpay Route split can pay out the rest to the club.
CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- the payer
    purpose             TEXT NOT NULL CHECK (purpose IN ('membership', 'challenge', 'inventory', 'subscription')),
    target_id           TEXT NOT NULL,                       -- chapter/challenge/item/chapter(sub) id the payment is for
    chapter_id          UUID REFERENCES chapters(id) ON DELETE SET NULL, -- revenue attribution (nullable)
    amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0),
    currency            TEXT NOT NULL DEFAULT 'INR',
    platform_cut_paise  BIGINT NOT NULL DEFAULT 0,
    quantity            INT NOT NULL DEFAULT 1,               -- units (inventory); 1 otherwise
    notes               JSONB NOT NULL DEFAULT '{}',          -- purpose-specific context

    provider            TEXT NOT NULL DEFAULT 'razorpay',
    provider_order_id   TEXT NOT NULL UNIQUE,                 -- idempotency: one order per row
    provider_payment_id TEXT,                                 -- set once captured

    -- status is the money state; applied_at is the ENTITLEMENT state. Separating
    -- them lets verify + webhook race safely: whoever claims applied_at (the
    -- UPDATE ... WHERE applied_at IS NULL) is the single caller that grants the
    -- entitlement, and a failed grant resets applied_at so a retry re-claims it.
    status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
    applied_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at             TIMESTAMPTZ
);
CREATE INDEX idx_payments_user ON payments (user_id, created_at DESC);
CREATE INDEX idx_payments_chapter ON payments (chapter_id, created_at DESC);
CREATE INDEX idx_payments_status ON payments (status);

-- Club → platform subscription tier (the B2B billing surface). One-time per
-- period, manual renewal (no mandates): each tier payment extends subscription_until.
-- 'free' is the default; member-count limits are enforced against this tier.
ALTER TABLE chapters
    ADD COLUMN subscription_tier  TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'team', 'club', 'club_plus')),
    ADD COLUMN subscription_until TIMESTAMPTZ;

-- +goose Down
ALTER TABLE chapters DROP COLUMN subscription_until, DROP COLUMN subscription_tier;
DROP TABLE IF EXISTS payments;
