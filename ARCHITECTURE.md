# ClubMitra — System Architecture

> Standalone running-club operating system for India. ClubMitra owns identity —
> no external auth dependency. A MarathonMitra product with its own backend,
> database, and app. Phase 1 (club core) is complete; Phase 2 adds real payments,
> trust scoring, rolling leaderboards, and analytics.
>
> **Naming:** the code still ships as `RunMitra` / `virtual-run-tracker`
> (DB `virtualrun`, ports 8090/5433/6380). The ClubMitra rename is a Phase 2 task.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MOBILE CLIENT                            │
│                React Native + Expo (SDK 54)                     │
│         iOS                              Android                │
└────────────────────────┬────────────────────────────────────────┘
                         │  HTTPS / REST (JWT bearer)
                         │
┌────────────────────────┼────────────────────────────────────────┐
│                      GO API (Chi)                               │
│                    Render · :8090                               │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  auth/   │  │  orgs/   │  │challenge/│  │  finance/     │  │
│  │  users/  │  │ chapters/│  │leaderb'd │  │  razorpay/    │  │
│  │  trust   │  │ members/ │  │activities│  │  inventory/   │  │
│  │          │  │attendance│  │  badges/ │  │  analytics/   │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
│                                                                 │
│  middleware: JWT auth · permission checks · soft-delete filter  │
└──────┬──────────────────────────┬───────────────────────────────┘
       │                          │
┌──────┴──────┐          ┌────────┴─────────┐
│ PostgreSQL  │          │  Redis (Upstash) │
│  + PostGIS  │          │                  │
│  Neon       │          │  challenge lb    │
│             │          │  rolling lb      │
│  all data   │          │  (daily/wk/mo)   │
└──────┬──────┘          └──────────────────┘
       │
┌──────┴──────────────────────────────────────┐
│          External Services                   │
│                                              │
│  Razorpay + Route   payment + auto-split     │
│  Cloudinary         photos, certs, logos     │
│  Expo Notifications push notifications       │
└──────────────────────────────────────────────┘
```

> Modules shown in the API box that are **not built yet**: trust, activities,
> badges, finance/razorpay, inventory, analytics, rolling leaderboards. They are
> the Phase 2–4 design targets documented below.

---

## Mobile Architecture *(Phase 1 — built)*

```
Expo Router (file-based routes)
  (auth)/  (tabs)/  club/  challenge/  run/  profile/  schedule/  activity/

State          React Context + hooks (auth, theme) — no Redux/Zustand
HTTP           lib/api.ts — typed fetch wrapper, JWT bearer, auto-refresh
Tokens         expo-secure-store (access + rotating refresh)
Theming        lib/theme.tsx — light/dark palettes (live bindings), ThemeProvider
Fonts          Inter, applied globally (Text.render patch maps weight → family)
Push           expo-notifications — register token → POST /push/token; tap deep-links
Media          expo-image-picker (local Phase 1; Cloudinary Phase 2)
```

> Design system: color/space/radius/type tokens, elevated cards, gradient heroes,
> Ionicons. Tabs: Home (dashboard), Clubs, Challenges, Profile, Settings (light/dark toggle).

---

## Database Schema

> **Implementation note.** `users.id` is `TEXT` holding a generated UUID
> (`gen_random_uuid()::text`), kept compatible with the GPS/challenge/refresh-token
> tables that reference `users(id)`. Club tables use native `uuid` PKs.

### Identity Layer — Built

```sql
CREATE TABLE users (
    id              TEXT PRIMARY KEY,         -- UUID stored as text
    name            TEXT NOT NULL,
    email           CITEXT UNIQUE NOT NULL,   -- case-insensitive
    phone           TEXT UNIQUE,
    password_hash   TEXT NOT NULL,            -- bcrypt
    age             INT,
    tshirt_size     TEXT,                     -- XS/S/M/L/XL/XXL
    city            TEXT,
    running_level   TEXT,                     -- beginner|amateur|intermediate|advanced
    profile_photo   TEXT,                     -- local URI now; Cloudinary URL (Phase 2)
    is_verified     BOOLEAN DEFAULT false,
    -- Trust Score (Phase 2 — columns not yet added)
    trust_score     NUMERIC(5,2) DEFAULT 50,  -- 0–100, starts at 50
    trust_tier      TEXT DEFAULT 'basic',     -- basic|trusted|verified
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

### Organisation Layer — Built

```sql
CREATE TABLE organisations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    logo            TEXT,
    created_by      TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ              -- platform admin only
);

CREATE TABLE chapters (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID REFERENCES organisations(id),
    name                    TEXT NOT NULL,
    city                    TEXT NOT NULL,
    description             TEXT,
    logo                    TEXT,
    is_public               BOOLEAN DEFAULT true,
    invite_code             TEXT UNIQUE NOT NULL,
    -- Join + fee controls (built)
    requires_approval       BOOLEAN NOT NULL DEFAULT true,
    membership_fee_enabled  BOOLEAN DEFAULT false,
    membership_fee_amount   NUMERIC(10,2),
    membership_period       TEXT,            -- 'monthly'|'annual'
    renewal_window_days     INT NOT NULL DEFAULT 5,
    -- Subscription plan (Phase 2 — not yet added)
    plan                    TEXT NOT NULL DEFAULT 'starter', -- starter|growth|pro|enterprise
    -- Razorpay (Phase 2)
    razorpay_account_id     TEXT,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    deleted_at              TIMESTAMPTZ
);

-- chapter_id NULL = org-wide access; chapter_id SET = that chapter only
CREATE TABLE org_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organisations(id),
    chapter_id      UUID REFERENCES chapters(id),   -- nullable
    user_id         TEXT REFERENCES users(id),
    role            TEXT NOT NULL,                  -- org_admin|chapter_admin|co_admin
    assigned_by     TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
```

---

### Member Layer — Built + Phase 2 extension

```sql
CREATE TABLE chapter_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID REFERENCES chapters(id),
    user_id         TEXT REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'active',
    -- 'active'          — engaged, appears on leaderboards
    -- 'lapsed'          — fee overdue or no activity
    -- 'suspended'       — admin action, limited access
    -- 'pending'         — awaiting admin approval (requires_approval = true)
    -- 'pending_payment' — approved, awaiting fee payment
    -- 'on_leave'        — self-declared break, paused from leaderboards (Phase 2)
    -- 'injured'         — removed from performance comparisons (Phase 2)
    -- 'alumni'          — departed, read-only history (Phase 2)
    joined_at       TIMESTAMPTZ DEFAULT now(),
    fee_paid_until  TIMESTAMPTZ,            -- set on pay/renew (renew counts from expiry)
    added_by        TEXT REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    UNIQUE (chapter_id, user_id)
);
```

> **Built today:** active / lapsed / suspended / pending / pending_payment.
> **Phase 2:** on_leave / injured / alumni + the self-service status endpoint.

---

### Attendance Layer — Built

```sql
-- Recurring runs created as one row per occurrence (bulk schedule endpoint).
-- has_time = false means date-only (app shows "Time TBD").
CREATE TABLE runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID REFERENCES chapters(id),
    created_by      TEXT REFERENCES users(id),
    title           TEXT NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    has_time        BOOLEAN NOT NULL DEFAULT true,
    location        TEXT,
    location_lat    NUMERIC,
    location_lng    NUMERIC,
    distance_target NUMERIC(6,2),
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
    marked_by       TEXT REFERENCES users(id),   -- null = self check-in
    notes           TEXT,
    deleted_at      TIMESTAMPTZ,

    UNIQUE (run_id, user_id)
);
```

---

### Challenge Layer — Built

```sql
CREATE TABLE challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by      TEXT REFERENCES users(id),
    org_id          UUID REFERENCES organisations(id),
    chapter_id      UUID REFERENCES chapters(id),
    title           TEXT NOT NULL,
    description     TEXT,
    banner          TEXT,
    type            TEXT NOT NULL,   -- 'distance'|'days'|'streak'
    visibility      TEXT NOT NULL,   -- 'public'|'chapter'|'city'|'org'
    city            TEXT,            -- used when visibility = 'city'
    target_km       NUMERIC(8,2),
    target_days     INT,
    start_date      TIMESTAMPTZ NOT NULL,
    end_date        TIMESTAMPTZ NOT NULL,
    allow_teams     BOOLEAN DEFAULT true,
    join_fee        NUMERIC(10,2),   -- MOCK payment until Phase 2
    lock_date       TIMESTAMPTZ,     -- leaving closes here (else at start)
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE challenge_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id    UUID REFERENCES challenges(id),
    user_id         TEXT REFERENCES users(id),
    chapter_id      UUID REFERENCES chapters(id),
    progress_km     NUMERIC(8,2) DEFAULT 0,
    progress_days   INT DEFAULT 0,
    current_streak  INT DEFAULT 0,
    fee_paid        BOOLEAN NOT NULL DEFAULT false,
    joined_at       TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ,

    UNIQUE (challenge_id, user_id)
);

-- Manual proof (Phase 1). Replaced by GPS auto-credit in Phase 3.
-- submission_method + trust_weight columns land in Phase 2.
CREATE TABLE challenge_proof (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id      UUID REFERENCES challenges(id),
    user_id           TEXT REFERENCES users(id),
    submission_method TEXT NOT NULL DEFAULT 'screenshot',  -- (Phase 2)
    -- 'manual'     — distance/time entered by runner, no proof (trust 0.70)
    -- 'screenshot' — image from any fitness app          (trust 0.85)
    -- 'strava'     — Strava activity URL, data extracted  (trust 1.00)
    -- 'gpx'        — GPS trace file uploaded              (trust 1.10, Phase 3)
    strava_link     TEXT,
    screenshot_url  TEXT,
    gpx_url         TEXT,            -- Cloudinary URL (Phase 3)
    km_claimed      NUMERIC(6,2),
    proof_date      DATE,
    verified        BOOLEAN DEFAULT false,
    verified_by     TEXT REFERENCES users(id),
    trust_weight    NUMERIC(3,2),    -- (Phase 2)
    created_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);
```

> **Built today:** challenges, participants (`fee_paid`), proof
> (`strava_link`/`screenshot_url`/`km_claimed`/`proof_date`/`verified`).
> `submission_method`, `gpx_url`, and `trust_weight` are Phase 2 additions.

---

### Notifications Layer — Built

```sql
CREATE TABLE device_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,   -- ExponentPushToken[...]
    platform   TEXT,                   -- ios|android
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> Triggers (async, best-effort): run scheduled → chapter members; join request →
> admins; approval → member; challenge created → chapter members; proof verified →
> submitter; rank change → displaced runner (Phase 2); milestone earned → member (Phase 4).
> Real delivery requires an EAS dev/prod build (Expo Go can't receive remote push).

---

### Activity Layer *(Phase 3 — present from earlier build, unused by club core)*

```sql
CREATE TABLE activities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT REFERENCES users(id),
    chapter_id        UUID REFERENCES chapters(id),
    title             TEXT,
    submission_method TEXT NOT NULL DEFAULT 'gps',  -- gps|gpx|strava (Phase 3)
    route             geography(LineString, 4326),  -- PostGIS
    distance_m        DOUBLE PRECISION,
    avg_pace_s_per_km DOUBLE PRECISION,
    elevation_gain_m  DOUBLE PRECISION,
    duration_s        INT,
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ,
    -- Trust pipeline (Phase 2/3)
    trust_weight      NUMERIC(3,2),  -- set by submission_method
    auto_approved     BOOLEAN,       -- true if trust_score >= 80 at submit time
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activities_route   ON activities USING GIST (route);
CREATE INDEX idx_activities_user    ON activities (user_id, started_at DESC);
CREATE INDEX idx_activities_chapter ON activities (chapter_id, started_at DESC);
```

---

### Trust Score System *(Phase 2 — new)*

```
Trust score is a per-runner credibility metric (0–100, starts at 50).
It determines whether an activity is auto-approved or queued for review.

Components:
  Proof submission rate    30%   % of activities submitted with proof (not manual)
  Approval rate            40%   % of submitted activities approved without dispute
  Account age              30%   Longer history builds baseline credibility
                                 (0–30 days = 0pts, 31–90 = 5pts, 91–180 = 15pts,
                                  181–365 = 20pts, 365+ = 30pts)

Tier mapping:
  0–49    Basic     → all activities go to manual review queue
  50–79   Trusted   → screenshot/strava auto-approved; manual entry queued
  80–100  Verified  → all proof methods auto-approved

Recalculated after every activity approval or rejection. Stored on
users.trust_score; trust_tier updated atomically.

Trust weight per proof method (applied to leaderboard scoring):
  Manual entry  0.70   — no external proof
  Screenshot    0.85   — image from any fitness app
  Strava link   1.00   — URL extracted, data verified by system
  GPX upload    1.10   — full GPS trace, highest confidence
```

```sql
-- Audit trail for trust score changes
CREATE TABLE trust_score_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT REFERENCES users(id),
    old_score    NUMERIC(5,2),
    new_score    NUMERIC(5,2),
    reason       TEXT,          -- 'activity_approved'|'activity_rejected'|'manual_adjust'
    triggered_by TEXT,          -- activity_id or admin user_id
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

---

### Rolling Leaderboard System *(Phase 2 — new)*

```
Independent of challenges. Runs at chapter level. Four rolling periods in Redis.

Redis key pattern:
  chapter:{chapter_id}:lb:daily:{YYYY-MM-DD}
  chapter:{chapter_id}:lb:weekly:{YYYY-Www}
  chapter:{chapter_id}:lb:monthly:{YYYY-MM}
  chapter:{chapter_id}:lb:alltime

Score = distance_km × trust_weight (from the proof method used).
GPS-verified activities count at 1.1×. Manual entry at 0.7×.

Daily    — resets each calendar day (midnight IST)
Weekly   — resets Monday 00:00 IST, key includes ISO week
Monthly  — resets 1st of month
All-time — never resets; rebuilt from Postgres if Redis goes down

On activity approved:
  ZINCRBY chapter:{id}:lb:daily:{today}    {km × weight}  user:{id}
  ZINCRBY chapter:{id}:lb:weekly:{week}    {km × weight}  user:{id}
  ZINCRBY chapter:{id}:lb:monthly:{month}  {km × weight}  user:{id}
  ZINCRBY chapter:{id}:lb:alltime          {km × weight}  user:{id}

On fetch:
  ZREVRANGE chapter:{id}:lb:weekly:{week}  0 49 WITHSCORES   -- top 50

Self-heal (Redis down):
  Rebuild from challenge_participants + activities in Postgres
```

---

### Streak Freeze *(Phase 3 — new)*

```sql
-- 2 freezes per member per calendar month. A freeze day counts as "active".
CREATE TABLE streak_freezes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT REFERENCES users(id),
    chapter_id  UUID REFERENCES chapters(id),
    freeze_date DATE NOT NULL,
    used_at     TIMESTAMPTZ DEFAULT now(),

    UNIQUE (user_id, chapter_id, freeze_date)
);
```

---

### Analytics Layer *(Phase 2 — new)*

```
Drop-off metrics — queried from chapter_members + activities + run_attendance.
Cached, not recomputed per request.

Key metrics per chapter:
  Members with 0 activity in 7 days   → re-engagement alert
  Members with 0 activity in 14 days  → at-risk flag
  Members with 0 activity in 30 days  → likely churned
  Members with 0 activity in 60 days  → dormant

Engagement rate:
  weekly_active / total_active_members × 100

Activity volume trend:
  Total km logged per day/week/month; computed cache refreshed every 6 hours.
```

```sql
CREATE TABLE chapter_analytics_cache (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id          UUID REFERENCES chapters(id),
    period              TEXT NOT NULL,      -- 'daily'|'weekly'|'monthly'
    period_key          TEXT NOT NULL,      -- '2026-06-07'|'2026-W23'|'2026-06'
    total_km            NUMERIC(10,2),
    active_members      INT,
    total_members       INT,
    engagement_rate     NUMERIC(5,2),
    dropoff_7d          INT,
    dropoff_14d         INT,
    dropoff_30d         INT,
    dropoff_60d         INT,
    computed_at         TIMESTAMPTZ DEFAULT now(),

    UNIQUE (chapter_id, period, period_key)
);
```

---

### Badges + Milestones *(Phase 4 — new)*

```sql
CREATE TABLE badge_definitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT UNIQUE NOT NULL,   -- 'dist_100km', 'streak_30d', etc.
    name        TEXT NOT NULL,
    description TEXT,
    category    TEXT NOT NULL,          -- 'distance'|'streak'|'event'|'speed'|'club'
    icon_url    TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT REFERENCES users(id),
    badge_code  TEXT REFERENCES badge_definitions(code),
    chapter_id  UUID REFERENCES chapters(id),  -- nullable (global badge)
    earned_at   TIMESTAMPTZ DEFAULT now(),
    context     JSONB,   -- e.g. {"challenge_id": "...", "km": 100}

    UNIQUE (user_id, badge_code)
);
```

---

### Inventory Layer *(Phase 2 — NOT built yet)*

```sql
CREATE TABLE inventory_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id      UUID REFERENCES chapters(id),
    name            TEXT NOT NULL,
    category        TEXT,               -- 'apparel'|'equipment'|'medals'|'bibs'|'other'
    total_quantity  INT NOT NULL DEFAULT 0,
    available_qty   INT NOT NULL DEFAULT 0,
    size_breakdown  JSONB,              -- {"S":10,"M":25,"L":15,"XL":8}
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
    type            TEXT NOT NULL,      -- 'issue'|'return'|'purchase'|'restock'
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

### Finance Layer *(Phase 2 — NOT built; planned design)*

> Today membership + challenge fees use a MOCK step (confirm → activate). No
> `transactions` or `subscriptions` tables, Razorpay, or platform cut exist yet.

```sql
-- Every money movement. Platform cut stored at transaction time — never derived.
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL,
    -- 'membership_fee'|'inventory_purchase'|'challenge_fee'|'subscription'|'chapter_fee'
    payer_id            TEXT REFERENCES users(id),
    chapter_id          UUID REFERENCES chapters(id),
    org_id              UUID REFERENCES organisations(id),
    reference_id        TEXT,           -- Razorpay order/payment ID
    razorpay_route_id   TEXT,           -- Route transfer ID
    gross_amount        NUMERIC(10,2) NOT NULL,
    platform_cut_pct    NUMERIC(5,2) NOT NULL,
    platform_cut_amount NUMERIC(10,2) NOT NULL,
    net_amount          NUMERIC(10,2) NOT NULL,
    currency            TEXT DEFAULT 'INR',
    status              TEXT NOT NULL DEFAULT 'pending',
    -- 'pending'|'completed'|'failed'|'refunded'
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    deleted_at          TIMESTAMPTZ     -- audit trail only
);

CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID REFERENCES organisations(id),
    chapter_id          UUID REFERENCES chapters(id),
    plan                TEXT NOT NULL,            -- 'starter'|'growth'|'pro'|'enterprise'
    member_limit        INT,                      -- enforced at join time
    amount              NUMERIC(10,2),
    billing_start       TIMESTAMPTZ,
    billing_end         TIMESTAMPTZ,
    status              TEXT DEFAULT 'active',    -- 'active'|'cancelled'|'expired'
    razorpay_sub_id     TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);
```

---

## Permission System

### How it works

`org_roles` drives all permissions. `chapter_id = NULL` = org-wide access.

```sql
-- Most-specific role wins (chapter-scoped over org-wide):
SELECT r.role FROM org_roles r
JOIN chapters c ON c.id = $chapterID
WHERE r.user_id = $userID AND r.deleted_at IS NULL
  AND (r.chapter_id = c.id OR (r.chapter_id IS NULL AND r.org_id = c.org_id))
ORDER BY r.chapter_id NULLS LAST
LIMIT 1
```

```go
// Guards a route carrying {chapterID}
func (c *Checker) RequireChapterRole(allowed ...string) func(http.Handler) http.Handler

// Guards a route carrying {orgID}
func (c *Checker) RequireOrgRole(allowed ...string) func(http.Handler) http.Handler
```

### Member self-service *(Phase 2)*

Members will set their own status to `on_leave` via
`PUT /api/v1/chapters/:id/members/me/status`. Only admins can set `injured`,
`suspended`, or `alumni`.

---

## Payment Architecture *(Phase 2)*

### Razorpay Route — full flow

```
Runner pays ₹500 membership fee to Bangalore Runners chapter

Step 1: POST /api/v1/payments/initiate
        → backend creates Razorpay Order
        → inserts pending transaction:
             gross=500, platform_cut_pct=10, platform_cut=50, net=450

Step 2: Razorpay payment sheet opens on mobile

Step 3: Razorpay webhook → POST /api/v1/payments/webhook
        → verify HMAC signature
        → Razorpay Route auto-transfers:
             ₹450 → chapter's linked bank account
             ₹50  → ClubMitra's Razorpay account
        → transaction.status = 'completed'

Step 4: chapter_members.status = 'active'
        chapter_members.fee_paid_until = now + membership_period
```

### KYC gate

`membership_fee_enabled` cannot be set `true` while `razorpay_account_id IS NULL`.
Enforced at the API layer — not just the DB.

---

## Challenge Visibility Logic

```
Public    → explore feed for all ClubMitra users; any runner or chapter can join
City      → only users whose profile city matches; checked at join time
Chapter   → only that chapter's members; hidden from explore
Org-wide  → all members across the org's chapters; chapters compete
```

---

## Activity Trust Pipeline *(Phase 2)*

```
Every submitted activity flows through this pipeline before hitting leaderboards:

Stage 1 — Method classification
  Identify submission_method and assign base trust_weight.

Stage 2 — Format validation
  Required fields present. Pace not faster than 2:30/km (world-record guard).
  Distance within believable range for time claimed.

Stage 3 — Trust tier routing
  user.trust_score >= 80 (Verified)   → auto-approve, skip to Stage 5
  user.trust_score 50–79 (Trusted)    → proof method check:
      screenshot/strava → auto-approve
      manual entry      → Stage 4
  user.trust_score < 50 (Basic)       → Stage 4 for all methods

Stage 4 — Admin review queue
  Activity sits in pending queue. Chapter admin/co-admin reviews within 24h.
  Approve → Stage 5. Reject → trust score decremented.

Stage 5 — Scoring + leaderboard update
  progress_km += km_claimed × trust_weight (challenge_participants)
  ZINCRBY challenge leaderboard
  ZINCRBY all rolling leaderboards (daily/weekly/monthly/alltime)
  trust_score recalculated, trust_score_log entry written
```

---

## Redis Leaderboard Architecture

```
Challenge leaderboards (one per challenge) — BUILT:
  Key:    challenge:{challenge_id}:leaderboard
  Score:  progress_km (× trust_weight in Phase 2)
  Member: user:{id} or chapter:{id}

Rolling leaderboards (four per chapter) — Phase 2:
  chapter:{chapter_id}:lb:daily:{YYYY-MM-DD}
  chapter:{chapter_id}:lb:weekly:{YYYY-Www}
  chapter:{chapter_id}:lb:monthly:{YYYY-MM}
  chapter:{chapter_id}:lb:alltime
  Score:  km × trust_weight (cumulative for period)

City leaderboard (Phase 3, one per city):
  city:{city_slug}:lb:monthly:{YYYY-MM}

On activity approved:
  ZINCRBY all relevant sorted sets atomically (Lua script for consistency)

Self-heal (Redis down):
  Rebuild challenge lb from challenge_participants in Postgres
  Rebuild rolling lb   from activities + challenge_proof in Postgres
  Rebuild city lb      from activities WHERE chapter.city = city

Expiry:
  Daily keys     expire after 48 hours
  Weekly keys    expire after 14 days
  Monthly keys   expire after 60 days
  All-time keys  never expire
```

---

## Soft Delete Strategy

```
Who can soft delete what:
  Platform admin   → anything; hard delete only for legal/GDPR
  Org admin        → org, chapters under org, members
  Chapter admin    → members, runs, inventory in their chapter
  Co-admin         → members, runs, inventory in their chapter
  Member           → their own account only

All queries append WHERE deleted_at IS NULL via the repositories.
Platform admin may pass ?include_deleted=true (logged + rate-limited).
Hard deletes logged to audit_log before execution.
```

---

## Subscription Plan Enforcement *(Phase 2)*

```
Plan limits enforced at chapter join time (not just billing):

  Starter (free)     → block join when active member count >= 50
  Growth (₹999/mo)   → block join when active count >= 200
  Pro (₹2,999/mo)    → block join when active count >= 1,000
  Enterprise         → custom limit set on subscription record

When limit is hit:
  → 403 with error code MEMBER_LIMIT_REACHED
  → Admin notified via push: "Upgrade your plan to add more members"
  → Runner shown: "This club has reached its member limit. Contact the admin."
```

---

## Folder Responsibilities

```
internal/auth/           Register, login, JWT + refresh, logout,
                         token rotation + theft detection                [built]
internal/users/          Profile CRUD; trust score calc + log (Phase 2);
                         stats aggregation (Phase 3)
internal/organisations/  Org + chapter CRUD, invite codes, role assignment,
                         membership (join by invite, list);
                         plan enforcement (Phase 2)                       [built]
internal/permissions/    org_roles-backed role middleware (org + chapter) [built]
internal/attendance/     Schedule runs (single + recurring), edit,
                         check-in/out, attendance history                 [built]
internal/challenges/     Challenge CRUD, visibility, join/leave (fee + date
                         gated), proof + admin verify, leaderboard sync   [built]
internal/leaderboard/    Redis sorted-set ops — challenge (built); rolling +
                         Lua atomic updates (Phase 2)
internal/notifications/  Expo push tokens, send helpers, event triggers   [built]
internal/activities/     GPS recording, GPX upload, trust pipeline,
                         challenge + leaderboard auto-credit              [Phase 3]
internal/members/        Member lifecycle state machine, self-service
                         on_leave endpoint                                [Phase 2]
internal/inventory/      Item CRUD, size breakdown, issue/return/purchase [Phase 2]
internal/finance/        Transactions, platform cut, Razorpay + webhook,
                         dashboards, subscriptions                        [Phase 2]
internal/analytics/      Drop-off metrics, engagement, volume, cache      [Phase 2]
internal/badges/         Badge definitions, milestone engine, XP          [Phase 4]
pkg/middleware/          JWT validation, permission checks, rate limiting
pkg/razorpay/            Razorpay client, Route transfer, webhook verify   [Phase 2]
pkg/geo/                 PostGIS distance + elevation, coordinate validation [Phase 3]
```

---

## Phase 2 Build Sequence

```
Week 1 — Real payments
  Razorpay Route client in pkg/razorpay/
  payments/initiate + payments/webhook endpoints
  transactions + subscriptions tables
  Replace MOCK membership + challenge-fee flows with real Razorpay
  Finance dashboard API (collected/pending/platform cut)
  Subscription plan enforcement at join time

Week 2 — Trust + Activity pipeline
  trust_score + trust_tier on users; trust_score_log table
  submission_method + trust_weight on challenge_proof
  Trust pipeline (Stage 1–5) + admin activity review queue
  Trust recalculation after each approve/reject

Week 3 — Rolling leaderboards + Analytics
  Rolling Redis keys (daily/weekly/monthly/alltime) + Lua atomic ZINCRBY
  Rolling leaderboard API (4 per chapter)
  Analytics cache table + drop-off / engagement / volume endpoints

Week 4 — Extended member states + Inventory + Cloudinary
  on_leave/injured/alumni + self-service endpoint
  Inventory tables + CRUD + issue/return/purchase + platform cut
  Cloudinary for profile photos + logos
  ClubMitra rename (module, DB, env) · E2E testing · soft-launch prep
```

---

## Environment Variables

```env
# backend/.env

DATABASE_URL=postgres://clubmitra:clubmitra@localhost:5433/clubmitra?sslmode=disable
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
PORT=8090
ENV=development

# Phase 2
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
PLATFORM_CUT_PCT=10

CLOUDINARY_URL=cloudinary://your-cloudinary-url
```

> Current dev setup still uses `virtualrun` DB / ports 5433 + 6380 until the rename.

---

## Deployment

| Service | Use | Cost |
|---|---|---|
| Render | Go API | Free / $7 mo |
| Neon | PostgreSQL + PostGIS | Free (0.5 GB) |
| Upstash | Redis | Free (10k req/day) |
| Cloudinary | Photos, certs, logos | Free (25 GB) |
| Expo EAS | App builds | Free |

---

*ClubMitra — Built for Indian running clubs.*
