# RunMitra — System Architecture

> Standalone running-club operating system. RunMitra owns identity (no external
> auth dependency). Phase 1 is the club core; finance, inventory, and GPS land in
> later phases.

---

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        MOBILE CLIENT                            │
│                   React Native + Expo                          │
│         iOS                          Android                    │
└────────────────────────┬───────────────────────────────────────┘
                         │  HTTPS / REST (JWT bearer)
                         │
┌────────────────────────┼───────────────────────────────────────┐
│                      GO API (Chi)                              │
│                    Render · :8090                              │
│                                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  auth/   │ │  orgs/   │ │challenge/│ │    finance/      │  │
│  │  users/  │ │ chapters/│ │leaderb'd │ │  razorpay/       │  │
│  │          │ │ members/ │ └──────────┘ └──────────────────┘  │
│  │          │ │attendance│                                     │
│  │          │ │inventory │                                     │
│  └──────────┘ └──────────┘                                     │
│                                                                │
│  middleware: JWT auth · permission checks · soft-delete filter │
└──────┬──────────────────────────┬──────────────────────────────┘
       │                          │
┌──────┴──────┐          ┌────────┴────────┐
│ PostgreSQL  │          │  Redis (Upstash) │
│  + PostGIS  │          │                 │
│  Neon       │          │  leaderboards   │
│             │          │  sessions       │
│  all data   │          │  rate limiting  │
└──────┬──────┘          └─────────────────┘
       │
┌──────┴──────────────────────────────────────┐
│          External Services                   │
│                                              │
│  Razorpay + Route   payment + auto-split     │
│  Cloudinary         photos, certs, logos     │
│  Expo Notifications push notifications       │
└──────────────────────────────────────────────┘
```

---

## Mobile Architecture *(Phase 1 — built)*

```
Expo Router (file-based routes)        app/_layout → ThemeProvider + AuthProvider
  (auth)/  (tabs)/  club/  challenge/   Inter font loaded at boot (splash-gated)
  run/  profile/  schedule  activity/

State          React Context + hooks (auth, theme) — no Redux/Zustand
HTTP           lib/api.ts — small typed fetch wrapper, JWT bearer, auto-refresh
Tokens         expo-secure-store (access + rotating refresh)
Theming        lib/theme.tsx — light/dark palettes as LIVE module bindings;
               ThemeProvider swaps them + screens subscribe via useThemeMode()
Fonts          Inter, applied globally by patching Text.render (weight→family)
Push           expo-notifications — register token → POST /push/token; tap deep-links
Media          expo-image-picker (local), expo-clipboard (invite codes)
```

> Design system (color/space/radius/type tokens, elevated cards, gradient heroes,
> Ionicons) lives in `lib/theme`. Tabs: Home (dashboard), Clubs, Challenges,
> Profile, Settings (light/dark toggle).

---

## Database Schema

> **Implementation note.** `users.id` is stored as `TEXT` holding a generated
> UUID (`gen_random_uuid()::text`). This keeps the column compatible with the
> existing GPS/challenge/refresh-token tables (which all reference `users(id)`),
> while still being a UUID value. The club tables below use native `uuid` for
> their own primary keys and reference `users(id)` as text.

### Identity Layer

```sql
-- Every person using the app (RunMitra owns identity and the password hash).
CREATE TABLE users (
    id              TEXT PRIMARY KEY,        -- UUID stored as text
    name            TEXT NOT NULL,
    email           CITEXT UNIQUE NOT NULL,  -- case-insensitive
    phone           TEXT UNIQUE,             -- unique when present
    password_hash   TEXT NOT NULL,           -- bcrypt
    age             INT,
    tshirt_size     TEXT,                    -- XS / S / M / L / XL / XXL
    city            TEXT,
    running_level   TEXT,                    -- beginner|amateur|intermediate|advanced
    profile_photo   TEXT,                    -- local URI today; Cloudinary in Phase 2
    is_verified     BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ              -- soft delete
);

-- JWT refresh tokens with rotation + theft detection.
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,    -- SHA-256 of the raw token
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,             -- set on rotation/logout
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

### Organisation Layer

```sql
-- Top-level entity (e.g. "XYZ Running Academy")
CREATE TABLE organisations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    logo            TEXT,                       -- Cloudinary URL
    created_by      TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ                 -- platform admin only
);

-- City-level chapter under an org. Same admin can run Bangalore + Pune as
-- separate chapters.
CREATE TABLE chapters (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID REFERENCES organisations(id),
    name                    TEXT NOT NULL,
    city                    TEXT NOT NULL,
    description             TEXT,
    logo                    TEXT,
    is_public               BOOLEAN DEFAULT true,
    invite_code             TEXT UNIQUE NOT NULL,   -- for invite link
    -- Join-flow + fee controls (migration 00013). Fees are MOCK until Phase 2.
    requires_approval       BOOLEAN NOT NULL DEFAULT true,   -- admin approves joins
    membership_fee_enabled  BOOLEAN DEFAULT false,
    membership_fee_amount   NUMERIC(10,2),
    membership_period       TEXT,                   -- 'monthly' | 'annual'
    renewal_window_days     INT NOT NULL DEFAULT 5, -- renew this many days before expiry
    razorpay_account_id     TEXT,                   -- linked after KYC (Phase 2)
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    deleted_at              TIMESTAMPTZ
);

-- Who controls what. chapter_id NULL = org-wide access; chapter_id SET = that
-- chapter only.
CREATE TABLE org_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organisations(id),
    chapter_id      UUID REFERENCES chapters(id),   -- nullable
    user_id         TEXT REFERENCES users(id),
    role            TEXT NOT NULL,
    -- 'org_admin' | 'chapter_admin' | 'co_admin'
    assigned_by     TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
```

---

### Member Layer

```sql
-- Runner's membership in a chapter
CREATE TABLE chapter_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID REFERENCES chapters(id),
    user_id         TEXT REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'active',
    -- 'active' | 'lapsed' | 'suspended' | 'pending' (awaiting approval)
    -- | 'pending_payment' (approved, awaiting the fee)
    joined_at       TIMESTAMPTZ DEFAULT now(),
    fee_paid_until  TIMESTAMPTZ,            -- set on pay/renew (renew counts from expiry)
    added_by        TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    UNIQUE (chapter_id, user_id)
);
```

---

### Attendance Layer *(Phase 1 — built)*

> Recurring runs are created as one `runs` row per occurrence (bulk schedule);
> there is no separate recurrence table. `has_time = false` means only the date
> is meaningful (the app shows "Time TBD").

```sql
CREATE TABLE runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID REFERENCES chapters(id),
    created_by      TEXT REFERENCES users(id),
    title           TEXT NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    has_time        BOOLEAN NOT NULL DEFAULT true,  -- false = date only
    location        TEXT,
    location_lat    NUMERIC,
    location_lng    NUMERIC,
    distance_target NUMERIC(6,2),   -- km
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE run_attendance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID REFERENCES runs(id),
    user_id         TEXT REFERENCES users(id),
    chapter_id      UUID REFERENCES chapters(id),
    checked_in_at   TIMESTAMPTZ DEFAULT now(),
    marked_by       TEXT REFERENCES users(id),  -- null = self check-in
    notes           TEXT,
    deleted_at      TIMESTAMPTZ,

    UNIQUE (run_id, user_id)
);
```

---

### Challenge Layer

```sql
CREATE TABLE challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by      TEXT REFERENCES users(id),
    org_id          UUID REFERENCES organisations(id),    -- nullable
    chapter_id      UUID REFERENCES chapters(id),         -- nullable
    title           TEXT NOT NULL,
    description     TEXT,
    banner          TEXT,           -- Cloudinary URL
    type            TEXT NOT NULL,  -- 'distance' | 'days' | 'streak'
    visibility      TEXT NOT NULL,  -- 'public' | 'chapter' | 'city' | 'org'
    city            TEXT,           -- used when visibility = 'city'
    target_km       NUMERIC(8,2),
    target_days     INT,
    start_date      TIMESTAMPTZ NOT NULL,
    end_date        TIMESTAMPTZ NOT NULL,
    allow_teams     BOOLEAN DEFAULT true,
    join_fee        NUMERIC(10,2),  -- optional; MOCK payment until Phase 2
    lock_date       TIMESTAMPTZ,    -- leaving closes here (else at start)
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE challenge_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id    UUID REFERENCES challenges(id),
    user_id         TEXT REFERENCES users(id),       -- nullable if team
    chapter_id      UUID REFERENCES chapters(id),    -- nullable if solo
    progress_km     NUMERIC(8,2) DEFAULT 0,
    progress_days   INT DEFAULT 0,
    current_streak  INT DEFAULT 0,
    fee_paid        BOOLEAN NOT NULL DEFAULT false,  -- join-fee paid (MOCK)
    joined_at       TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    UNIQUE (challenge_id, user_id)
);

-- Phase 1 only — manual proof before GPS is built.
CREATE TABLE challenge_proof (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id    UUID REFERENCES challenges(id),
    user_id         TEXT REFERENCES users(id),
    strava_link     TEXT,
    screenshot_url  TEXT,
    km_claimed      NUMERIC(6,2),
    proof_date      DATE,           -- the day the run happened
    verified        BOOLEAN DEFAULT false,
    verified_by     TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Redis: one sorted set per challenge
--   Key:    challenge:{challenge_id}:leaderboard
--   Score:  progress_km or progress_days
--   Member: user:{id} or chapter:{id}
```

> ✅ Built. The earlier solo-tracker `challenges` schema was migrated to this
> visibility-aware model (migration 00009) and extended with join fees + lock
> dates (00013) and proof dates (00012).

---

### Notifications Layer *(Phase 1 — built)*

```sql
-- Expo push tokens, one per device install (migration 00014). The notifier
-- joins these to chapter_members / org_roles to fan an event to the right users.
CREATE TABLE device_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,   -- ExponentPushToken[...]
    platform   TEXT,                   -- ios | android
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> Triggers (best-effort, async): run scheduled → chapter members; join request →
> chapter admins; approval → the member; chapter challenge created → members;
> proof verified → the submitter. Sends go to the Expo Push API. **Real delivery
> needs a dev/prod build** (Expo Go can't receive remote push on current SDKs).

---

### Inventory Layer *(Phase 2 — NOT built yet)*

```sql
CREATE TABLE inventory_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID REFERENCES chapters(id),
    name            TEXT NOT NULL,
    category        TEXT,           -- 'apparel'|'equipment'|'medals'|'bibs'|'other'
    total_quantity  INT NOT NULL DEFAULT 0,
    available_qty   INT NOT NULL DEFAULT 0,
    size_breakdown  JSONB,          -- {"S":10,"M":25,"L":15,"XL":8}
    unit_price      NUMERIC(10,2),
    image_url       TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE inventory_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID REFERENCES inventory_items(id),
    chapter_id      UUID REFERENCES chapters(id),
    user_id         TEXT REFERENCES users(id),
    type            TEXT NOT NULL,  -- 'issue'|'return'|'purchase'|'restock'
    quantity        INT NOT NULL,
    size            TEXT,
    amount          NUMERIC(10,2),
    notes           TEXT,
    created_by      TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
```

---

### Finance Layer *(Phase 2 — NOT built; tables below are the planned design)*

> Today membership + challenge fees use a **MOCK** step (confirm → activate); no
> `transactions`/`subscriptions` tables, Razorpay, or platform cut exist yet.

```sql
-- Every money movement. Platform cut stored at transaction time, never derived.
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL,
    -- 'membership_fee'|'inventory_purchase'|'subscription'|'chapter_fee'
    payer_id            TEXT REFERENCES users(id),
    chapter_id          UUID REFERENCES chapters(id),
    org_id              UUID REFERENCES organisations(id),
    reference_id        TEXT,       -- Razorpay order/payment ID
    razorpay_route_id   TEXT,       -- Route transfer ID
    gross_amount        NUMERIC(10,2) NOT NULL,
    platform_cut_pct    NUMERIC(5,2) NOT NULL,
    platform_cut_amount NUMERIC(10,2) NOT NULL,
    net_amount          NUMERIC(10,2) NOT NULL,  -- goes to club
    currency            TEXT DEFAULT 'INR',
    status              TEXT NOT NULL DEFAULT 'pending',
    -- 'pending'|'completed'|'failed'|'refunded'
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    deleted_at          TIMESTAMPTZ  -- audit trail only
);

CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID REFERENCES organisations(id),
    chapter_id          UUID REFERENCES chapters(id),  -- nullable = org plan
    plan                TEXT NOT NULL,        -- 'free'|'basic'|'pro'
    member_count_billed INT DEFAULT 0,
    amount              NUMERIC(10,2),
    billing_start       TIMESTAMPTZ,
    billing_end         TIMESTAMPTZ,
    status              TEXT DEFAULT 'active', -- 'active'|'cancelled'|'expired'
    razorpay_sub_id     TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);
```

---

### GPS Tracking Layer *(Phase 3 — already present from the earlier build)*

```sql
CREATE TABLE activities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT REFERENCES users(id),
    chapter_id      UUID REFERENCES chapters(id),  -- nullable (to be added)
    title           TEXT,
    route           geography(LineString, 4326),   -- PostGIS
    distance_m      DOUBLE PRECISION,
    avg_pace_s_per_km DOUBLE PRECISION,
    elevation_gain_m  DOUBLE PRECISION,
    duration_s      INT,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activities_route ON activities USING GIST (route);
CREATE INDEX idx_activities_user_started ON activities (user_id, started_at DESC);
```

---

## Permission System

### How it works

The `org_roles` table drives all permissions. The middleware checks it on every
protected request.

```
org_roles row:
  org_id     = ABC
  chapter_id = null      → user has org-wide access to org ABC
  role       = org_admin

org_roles row:
  org_id     = ABC
  chapter_id = XYZ       → user only controls chapter XYZ
  role       = chapter_admin
```

### Middleware (implemented in internal/permissions)

```go
// RequireChapterRole guards a route carrying {chapterID}. The caller passes if
// they hold an allowed role on that chapter OR an org-wide role on its org.
func (c *Checker) RequireChapterRole(allowed ...string) func(http.Handler) http.Handler

// Lookup (most-specific role wins: chapter-scoped over org-wide):
//   SELECT r.role FROM org_roles r
//   JOIN chapters c ON c.id = $chapterID
//   WHERE r.user_id = $userID AND r.deleted_at IS NULL
//     AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id))
//   ORDER BY r.chapter_id NULLS LAST
//   LIMIT 1
```

`RequireOrgRole(...)` is the org-scoped equivalent for routes carrying `{orgID}`.
No applicable role → `403`; a query failure → `500`.

### Soft delete filter

Every table has `deleted_at`; queries append `WHERE deleted_at IS NULL` unless a
platform admin explicitly requests deleted records.

---

## Payment Architecture *(Phase 2)*

### Razorpay Route — how every transaction flows

```
Runner pays ₹500 membership fee to Bangalore Runners chapter

Step 1: POST /api/v1/payments/initiate
        → backend creates a Razorpay Order
        → pending transaction: gross=500, cut_pct=10, cut=50, net=450

Step 2: Razorpay payment sheet opens on mobile; runner pays

Step 3: Razorpay webhook → POST /api/v1/payments/webhook
        → verify signature
        → Route auto-transfers ₹450 → chapter bank, ₹50 → RunMitra
        → transaction status = 'completed'

Step 4: membership status = 'active', fee_paid_until = now + period
```

### Before KYC

`membership_fee_enabled` cannot be set true while `razorpay_account_id` is null —
enforced at the API level.

---

## Challenge Visibility Logic

```
Public    → explore feed for all users; any runner/chapter can join
City      → only users whose profile city matches; city checked at join
Chapter   → only that chapter's members; hidden from explore
Org-wide  → all members across the org's chapters; chapters compete
```

---

## Redis Leaderboard

```
One sorted set per challenge:
  Key:    challenge:{uuid}:leaderboard
  Score:  progress_km (float) or progress_days (int)
  Member: user:{uuid} or chapter:{uuid}

On proof verified (Phase 1) / run logged (Phase 3):
  ZINCRBY challenge:{id}:leaderboard {km} user:{id}

On fetch:
  ZREVRANGE challenge:{id}:leaderboard 0 49 WITHSCORES   -- top 50

Self-heal (Redis down):
  Rebuild from challenge_participants.progress_km in Postgres
```

---

## Soft Delete Strategy

```
Who can soft delete what:
  Platform admin → anything
  Org admin      → org, chapters under org, members
  Chapter admin  → members, runs, inventory in their chapter
  Co-admin       → members, runs, inventory in their chapter
  Member         → their own account only

Hard delete:
  Platform admin only, only for legal/GDPR, logged in audit_log

Queries:
  All append WHERE deleted_at IS NULL automatically
  Platform admin may pass ?include_deleted=true (logged + rate-limited)
```

---

## Folder Responsibilities

```
internal/auth/           Register, login, JWT issue + refresh, logout,
                         token rotation + theft detection
internal/users/          Account + profile, stats aggregation (Phase 3)
internal/organisations/  Org + chapter CRUD, invite codes, role assignment,
                         membership (join by invite, list) [Phase 1]
internal/permissions/    org_roles-backed role middleware (org + chapter scope)
internal/attendance/     Schedule runs (single + recurring), edit, check-in/out,
                         attendance history
internal/challenges/     Challenge CRUD, visibility rules, join/leave (fee+date
                         gated), proof, progress updates, leaderboard sync
internal/leaderboard/    Redis sorted-set operations, self-heal from Postgres
internal/notifications/  Expo push tokens, send helpers, event triggers [built]
internal/activities/     GPS recording (Phase 3), PostGIS routes, challenge credit
-- NOT built yet --
internal/members/        (membership currently lives in organisations; may split)
internal/inventory/      Item CRUD, size breakdown (JSONB), issue/return/purchase  [Phase 2]
internal/finance/        Transactions, platform cut, Razorpay order + webhook,
                         finance dashboards, subscriptions                          [Phase 2]
pkg/middleware/          JWT validation, permission checks, soft-delete, rate limit
pkg/razorpay/            Razorpay client, Route transfer helpers, webhook verify
pkg/geo/                 PostGIS distance calc (Phase 3), coordinate validation
```

---

## Build Sequence (Phase 1)

```
Week 1
  DB schema + migrations · standalone auth (register/login, JWT, refresh)
  Org + chapter CRUD, invite codes · role assignment + permission middleware

Week 2
  Member add + list, status · invite-link join flow
  Soft delete on all entities + middleware filter · mobile: auth + club screens

Week 3
  Run scheduling API + screen · post-run check-in
  Attendance history · challenge CRUD + visibility rules

Week 4
  Challenge join (solo + club) · Redis leaderboard
  Phase 1 proof (Strava link / screenshot + admin verify)
  Mobile challenge screens · push notifications · E2E testing + beta
```

---

## Environment Variables

```env
# backend/.env
DATABASE_URL=postgres://runmitra:runmitra@localhost:5433/runmitra?sslmode=disable
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
PORT=8090
ENV=development

# Phase 2
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
PLATFORM_CUT_PCT=10
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

---

## Deployment

| Service | Use | Cost |
|---|---|---|
| Render | Go API | Free / $7 mo |
| Neon | PostgreSQL + PostGIS | Free (0.5 GB) |
| Upstash | Redis leaderboard | Free (10k req/day) |
| Cloudinary | Photos, certs, logos | Free (25 GB) |
| Expo EAS | App builds | Free |

---

*RunMitra — Built for Indian running clubs.*
