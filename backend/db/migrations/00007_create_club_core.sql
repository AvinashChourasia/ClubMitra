-- +goose Up

-- RunMitra's pivot: from a solo GPS tracker (identity verified by MarathonMitra)
-- to a STANDALONE running-club operating system. RunMitra now owns identity, so
-- the users table grows real account fields (password, full profile) and we add
-- the club layer on top: organisations -> chapters -> roles + members.
--
-- We keep users.id as TEXT (it stays the key every existing table — activities,
-- challenges, refresh_tokens — already references). New accounts get a UUID
-- generated as text, so nothing downstream has to change.

-- 1. Turn the old MarathonMitra profile cache into a real account.
ALTER TABLE users RENAME COLUMN display_name TO name;
ALTER TABLE users DROP COLUMN synced_at;
ALTER TABLE users
    ADD COLUMN phone         TEXT,
    ADD COLUMN password_hash TEXT NOT NULL DEFAULT '',
    ADD COLUMN age           INT,
    ADD COLUMN tshirt_size   TEXT,          -- XS / S / M / L / XL / XXL
    ADD COLUMN city          TEXT,
    ADD COLUMN profile_photo TEXT,          -- Cloudinary URL
    ADD COLUMN is_verified   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN deleted_at    TIMESTAMPTZ;    -- soft delete

-- Phone is optional at the column level but unique when present (two accounts
-- can't claim the same number). A partial UNIQUE index allows many NULLs.
CREATE UNIQUE INDEX idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- 2. Organisation: the top-level entity, e.g. "XYZ Running Academy".
CREATE TABLE organisations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    logo        TEXT,                                  -- Cloudinary URL
    created_by  TEXT NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ                            -- soft delete
);

CREATE TRIGGER organisations_set_updated_at
    BEFORE UPDATE ON organisations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Chapter: a city-level branch under an org. One admin can run Bangalore and
--    Pune as separate chapters of the same organisation.
CREATE TABLE chapters (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                 UUID NOT NULL REFERENCES organisations(id),
    name                   TEXT NOT NULL,
    city                   TEXT NOT NULL,
    description            TEXT NOT NULL DEFAULT '',
    logo                   TEXT,
    is_public              BOOLEAN NOT NULL DEFAULT true,

    -- The shareable invite code at the heart of onboarding: a runner opens the
    -- link, signs up, and auto-joins this chapter. UNIQUE so it maps to one
    -- chapter, and indexed for the join-by-code lookup.
    invite_code            TEXT NOT NULL UNIQUE,

    -- Membership-fee fields stay dormant until Phase 2 (Razorpay). Kept here so
    -- the schema is stable; the API refuses to enable fees before KYC.
    membership_fee_enabled BOOLEAN NOT NULL DEFAULT false,
    membership_fee_amount  NUMERIC(10,2),
    razorpay_account_id    TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ
);

CREATE INDEX idx_chapters_org ON chapters (org_id);

CREATE TRIGGER chapters_set_updated_at
    BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Roles: the table that drives every permission check. chapter_id NULL means
--    org-wide access; a set chapter_id scopes the role to that one chapter.
CREATE TABLE org_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organisations(id),
    chapter_id  UUID REFERENCES chapters(id),          -- nullable = org-wide
    user_id     TEXT NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL CHECK (role IN ('org_admin', 'chapter_admin', 'co_admin')),
    assigned_by TEXT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- The permission middleware looks up roles by (user_id, org/chapter), so index
-- the user side. A partial UNIQUE index stops duplicate active grants of the
-- same role to the same user in the same scope.
CREATE INDEX idx_org_roles_user ON org_roles (user_id);
CREATE UNIQUE INDEX idx_org_roles_unique_active
    ON org_roles (user_id, org_id, COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid), role)
    WHERE deleted_at IS NULL;

-- 5. Membership: a runner's place in a chapter.
CREATE TABLE chapter_members (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id     UUID NOT NULL REFERENCES chapters(id),
    user_id        TEXT NOT NULL REFERENCES users(id),
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'lapsed', 'suspended')),
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    fee_paid_until TIMESTAMPTZ,
    added_by       TEXT REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,

    -- One membership per (chapter, user).
    UNIQUE (chapter_id, user_id)
);

CREATE INDEX idx_chapter_members_chapter ON chapter_members (chapter_id);
CREATE INDEX idx_chapter_members_user ON chapter_members (user_id);

CREATE TRIGGER chapter_members_set_updated_at
    BEFORE UPDATE ON chapter_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS chapter_members;
DROP TABLE IF EXISTS org_roles;
DROP TABLE IF EXISTS chapters;
DROP TABLE IF EXISTS organisations;

DROP INDEX IF EXISTS idx_users_phone;
ALTER TABLE users
    DROP COLUMN phone,
    DROP COLUMN password_hash,
    DROP COLUMN age,
    DROP COLUMN tshirt_size,
    DROP COLUMN city,
    DROP COLUMN profile_photo,
    DROP COLUMN is_verified,
    DROP COLUMN deleted_at;
ALTER TABLE users ADD COLUMN synced_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users RENAME COLUMN name TO display_name;
