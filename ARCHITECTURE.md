# ClubMitra — System Architecture

> Standalone running-club operating system. ClubMitra owns identity — no external
> auth dependency. A MarathonMitra product with its own backend, database, and app.
>
> **Status (June 2026):** Phases 1, 2 and 4 are **built and live** — club core,
> messaging (WhatsApp-grade chat + realtime), analytics, inventory, GPS run
> tracking (record + GPX import), GPS-native challenges, rolling + city
> leaderboards, streak freezes, race calendar (MarathonMitra-fed), and the
> Phase 5 **gamification core** (badges + XP + levels + achievement wall).
> **Phase 3 — real payments — is the big remaining build**, gated on Razorpay
> Route KYC; membership/challenge fees run a MOCK confirm step today.
>
> **Removed by design** (simpler product, GPS made them redundant):
> trust scoring (00027), manual run logging (client, June 2026), challenge
> proof + admin review (00031), finisher certificates (descoped).
>
> **Market:** India first (Razorpay + INR). Global-ready — provider-agnostic
> payments, multi-currency, country + timezone-aware chapters. Europe Month 7+
> (Stripe + EUR/USD).
>
> **Naming:** the Go module still ships as `RunMitra` paths (DB `virtualrun`,
> ports 8090/5433/6380 in dev). The ClubMitra rename is pending cleanup.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         MOBILE CLIENT                            │
│            React Native + Expo SDK 54 (Expo Router)              │
│      Android (EAS preview APK + OTA updates)   ·   iOS           │
└──────────────┬───────────────────────────┬───────────────────────┘
               │ HTTPS / REST (JWT bearer) │ WebSocket /ws?token=
               │                           │ (chat + typing, realtime)
┌──────────────┴───────────────────────────┴───────────────────────┐
│                        GO API (Chi) — Render :8090               │
│                                                                  │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌──────────────────┐ │
│  │ auth/    │ │ orgs/     │ │ challenges/│ │ messaging/       │ │
│  │ users/   │ │ chapters/ │ │ leaderboard│ │ realtime (hub)   │ │
│  │          │ │ members/  │ │ activities/│ │ races/           │ │
│  │          │ │ attendance│ │ runlog/    │ │ gamification/    │ │
│  └──────────┘ └───────────┘ └────────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ notifications/ · uploads/ · analytics/ · inventory/      │   │
│  └──────────────────────────────────────────────────────────┘   │
│  middleware: JWT auth · org_roles permission checks ·            │
│  soft-delete filters · public (guest) route group                │
└───────┬──────────────────────────┬───────────────────────────────┘
        │                          │
┌───────┴──────┐         ┌─────────┴────────┐
│ PostgreSQL   │         │  Redis (Upstash) │
│  + PostGIS   │         │                  │
│  Neon        │         │  challenge       │
│              │         │  leaderboards    │
│  all data    │         │  (sorted sets)   │
└───────┬──────┘         └──────────────────┘
        │
┌───────┴───────────────────────────────────────────────┐
│                External Services                       │
│                                                        │
│  Expo Notifications  push (chat, badges, club events)  │
│  Cloudinary          photos, logos, chat media, voice  │
│  MarathonMitra API   race calendar feed (lazy sync)    │
│  Razorpay + Route    INR payment + split     (Phase 3) │
│  Stripe + Connect    EUR/USD payment + split (Phase 3) │
└────────────────────────────────────────────────────────┘
```

> Everything in the API box is **built and deployed** except the payments rail.
> Migrations self-apply on boot (`database.Migrate`), so a Render deploy can
> never run against a stale schema.

---

## Mobile Architecture *(built)*

```
Expo Router (file-based, typed routes)
  (auth)/  (tabs)/  club/  challenge/  thread/  activity/  races/
  achievements/  profile/  schedule/  settings

State        React Context + hooks (auth, theme, unread) — no Redux/Zustand
HTTP         lib/api.ts — typed fetch wrapper, JWT bearer, auto-refresh
Realtime     lib/realtime.ts — app-wide WS client (backoff reconnect,
             typing throttle); poll fallback when the socket is down
Tokens       expo-secure-store (access + rotating refresh)
Theming      lib/theme.tsx — light/dark palettes (live bindings)
GPS          expo-location fg+bg (TaskManager) → lib/useRunRecorder
             accuracy gate · speed cap · autopause hysteresis
Offline      lib/runQueue — runs persist locally first, upload when online
Push         expo-notifications; deep links: chat thread / challenge / badge;
             foreground chat banner = custom in-app toast (OS banner muted)
Media        expo-image-picker / expo-audio (voice notes) → Cloudinary
Guest mode   all 5 tabs browsable logged-out; auth gates at commitment
             moments with pending-intent resume (join → register → joined)
Updates      EAS Update channel `preview` (runtime 1.0.0);
             native modules ride APK builds (expo-audio, expo-calendar)
```

> Design system: color/space/radius/type tokens, elevated cards, gradient
> heroes (GradientCard gloss), Ionicons, SVG visuals (RouteTrace pace
> gradient, ProgressRing, Podium3D, BadgeMedal, Confetti).
> Tabs: Home · Clubs · Challenges · Chat · Profile.

---

## Database Schema *(as deployed — migration 00032)*

> `users.id` is `TEXT` holding a generated UUID, kept compatible with every
> table that references `users(id)`. Club tables use native `uuid` PKs.
> All soft-deletable tables filter `deleted_at IS NULL` in the repositories.

### Identity — built

```sql
CREATE TABLE users (
    id              TEXT PRIMARY KEY,         -- UUID stored as text
    name            TEXT NOT NULL,
    email           CITEXT UNIQUE NOT NULL,   -- case-insensitive
    phone           TEXT UNIQUE,
    password_hash   TEXT NOT NULL,            -- bcrypt
    age             INT,
    tshirt_size     TEXT,
    city            TEXT,                     -- drives city visibility + boards
    running_level   TEXT,                     -- beginner|amateur|intermediate|advanced
    profile_photo   TEXT,                     -- Cloudinary URL
    is_verified     BOOLEAN DEFAULT false,
    announce_badges BOOLEAN NOT NULL DEFAULT true,  -- badge unlocks → club chat (00032)
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
-- trust_score / trust_tier were dropped in 00027 — trust scoring is REMOVED.

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

### Organisation + members + attendance — built

Unchanged from the original design: `organisations`, `chapters` (join policy,
membership fee fields, banner/logo, invite codes), `org_roles`
(org_admin | chapter_admin | co_admin, chapter_id NULL = org-wide),
`chapter_members` (status machine: active / lapsed / suspended / pending /
pending_payment / on_leave / injured / alumni), `runs` (scheduled group runs,
bulk recurrence, has_time) and `run_attendance` (self or admin check-in).
Razorpay/Stripe account columns exist on chapters, used in Phase 3.

### Activities (GPS runs) — built, the data backbone

```sql
CREATE TABLE activities (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at        TIMESTAMPTZ NOT NULL,
    ended_at          TIMESTAMPTZ NOT NULL,
    duration_s        INTEGER NOT NULL,        -- MOVING time (autopause subtracted)
    distance_m        DOUBLE PRECISION NOT NULL,  -- PostGIS geodesic length
    avg_pace_s_per_km DOUBLE PRECISION,
    elevation_gain_m  DOUBLE PRECISION NOT NULL DEFAULT 0,
    route             geography(LineStringZ, 4326) NOT NULL, -- 3D: lng/lat/alt
    point_offsets     double precision[],      -- seconds-from-start per vertex
                                               -- (pace-gradient colouring, 00023)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> Two write paths, one pipeline: live GPS recording and **GPX import**
> (multipart upload, trkpt parse, time-sorted) both go through `svc.Record`,
> so every run — recorded or imported — credits everything downstream.

```sql
-- Streak freeze (00028): up to 2 missed days per calendar month are bridged
-- automatically when computing the streak. Consumption is idempotent.
CREATE TABLE streak_freezes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frozen_on  DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, frozen_on)
);

-- Club rolling-leaderboard ledger: one run_log per active club membership
-- per recorded run (internal/runlog), aggregated on the fly with IST windows.
```

### Challenges — built, GPS-native

```sql
CREATE TABLE challenges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  TEXT REFERENCES users(id),
    org_id      UUID REFERENCES organisations(id),
    chapter_id  UUID REFERENCES chapters(id),
    title       TEXT NOT NULL,
    description TEXT,
    type        TEXT NOT NULL,   -- 'distance'|'days'|'streak'
    visibility  TEXT NOT NULL,   -- 'public'|'chapter'|'city'|'org'
    city        TEXT,            -- when visibility = 'city'
    target_km   NUMERIC(8,2),
    target_days INT,
    start_date  TIMESTAMPTZ NOT NULL,
    end_date    TIMESTAMPTZ NOT NULL,
    allow_teams BOOLEAN DEFAULT true,
    join_fee    NUMERIC(10,2),   -- MOCK payment until Phase 3
    lock_date   TIMESTAMPTZ,     -- leaving closes here (else at start)
    created_at  TIMESTAMPTZ DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE challenge_participants (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id   UUID REFERENCES challenges(id),
    user_id        TEXT REFERENCES users(id),     -- individual join
    chapter_id     UUID REFERENCES chapters(id),  -- club (team) join
    progress_km    NUMERIC(8,2) DEFAULT 0,
    progress_days  INT DEFAULT 0,   -- days type: run days; streak type: BEST streak
    current_streak INT DEFAULT 0,   -- streak type: live streak (display)
    fee_paid       BOOLEAN NOT NULL DEFAULT false,
    joined_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);
```

> **`challenge_proof` is GONE** (dropped in 00031). Progress is credited
> exclusively by the GPS hook — see *Run-recorded pipeline* below. Joining is
> open until `start_date`; the **organiser can edit** title/description/target/
> window via `PUT /challenges/:id` until the start, after which it locks
> (participants get a heads-up push on edit).

### Messaging — built (chat, WhatsApp-grade)

```sql
CREATE TABLE conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id  UUID REFERENCES chapters(id),  -- NULL for direct chats
    run_id      UUID REFERENCES runs(id),      -- set for an event (run) chat
    type        TEXT NOT NULL,                 -- 'chapter'|'event'|'direct'
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Participants of DIRECT chats only (club chats derive from chapter_members).
CREATE TABLE conversation_members (
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    user_id         TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    sender_id       TEXT NOT NULL REFERENCES users(id),
    kind            TEXT NOT NULL DEFAULT 'user', -- 'user'|'badge' (system chip)
    body            TEXT,
    media_url       TEXT,            -- Cloudinary (image/video/file/voice .m4a)
    media_type      TEXT,            -- 'image'|'video'|'file'|'audio'
    is_pinned       BOOLEAN NOT NULL DEFAULT false,
    is_announcement BOOLEAN NOT NULL DEFAULT false, -- admin broadcast (+push)
    reply_to_id     UUID REFERENCES messages(id),   -- WhatsApp-style quoting
    edited_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

CREATE TABLE message_reads (        -- per-user read marker (ticks + unread)
    user_id         TEXT, conversation_id UUID, last_read_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, conversation_id)
);

CREATE TABLE conversation_prefs (   -- per-user mute + archive
    conversation_id UUID, user_id TEXT,
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE message_reactions (    -- one emoji per user per message (upsert)
    message_id UUID, user_id TEXT, emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
```

### Race calendar — built (MarathonMitra-fed)

```sql
CREATE TABLE races (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE,        -- MarathonMitra id → repeat syncs upsert
    title       TEXT NOT NULL,
    city        TEXT NOT NULL,
    race_date   DATE NOT NULL,
    distances   TEXT NOT NULL DEFAULT '',   -- freeform: "5K · 10K · 21.1K"
    location    TEXT,
    url         TEXT,
    created_by  TEXT REFERENCES users(id),  -- NULL for synced races
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE race_interests (   -- "I'm going" toggle, live count
    race_id UUID, user_id TEXT, created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (race_id, user_id)
);
```

> Races flow in from MarathonMitra's events pages: each page embeds schema.org
> JSON-LD (SportsEvent ItemList — an SEO contract, stabler than markup), which
> a background sync walks (`/events?status=upcoming&page=N` until empty, 10-min
> throttle, best-effort) and upserts by URL slug (`external_id`). Tapping a race
> card opens its MarathonMitra event page; organisers are handed there to
> submit (approval there = appearance here). Client adds races to the phone
> calendar (expo-calendar native, Google-Calendar URL fallback).

### Gamification — built (Phase 5 core)

```sql
-- Badge CATALOG lives in code (internal/gamification/catalog.go — 26 badges,
-- 6 levels): award rules are code, so definitions stay next to them. The DB
-- records only what's earned.
CREATE TABLE user_badges (
    user_id   TEXT NOT NULL REFERENCES users(id),
    badge_id  TEXT NOT NULL,            -- catalog id, e.g. 'km_100', 'streak_7'
    earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);
```

> XP has **no ledger** — it's recomputed from verified work on every read:
> `10/km + 25/run-day + 150/challenge-completed + 50/check-in + badge bonuses`.
> Levels: Rookie 0 · Jogger 500 · Pacer 1.5k · Front Runner 4k · Podium Hunter
> 8k · Club Legend 16k. Award evaluation is **lazy**: every profile/wall fetch
> and every run save is an award pass (one batched `INSERT…unnest ON CONFLICT
> DO NOTHING RETURNING` decides which unlocks are "fresh" to celebrate), so
> badges that depend on external events — a challenge ending — land on the
> next look without a scheduler.

### Inventory, analytics, notifications — built

Unchanged: `inventory_items` + `inventory_transactions` (issue/return/restock;
paid purchase waits for Phase 3), analytics computed live from `run_logs` +
`run_attendance` (cache table deferred), `device_tokens` for Expo push.

> Push triggers today: run scheduled · join request/approval · challenge
> created/updated · chat messages (25s per-conversation throttle, mute-aware,
> deep-linked) · badge unlocked. Real delivery needs the EAS build (not Expo Go).

### Finance — Phase 3 (NOT built; planned design unchanged)

The provider-agnostic `pkg/payments` interface, Razorpay Route / Stripe Connect
flows, `transactions` + `subscriptions` tables, platform-cut model, KYC gating
and plan enforcement remain as designed (see *Payment Architecture* below) —
none of it exists in code yet. Membership and challenge fees use a MOCK
confirmation step today.

---

## Run-recorded pipeline *(the heart of the product)*

```
Mobile (lib/useRunRecorder)
  GPS points → accuracy gate (≤20m) → speed cap (12.5 m/s) → noise floor
  → autopause hysteresis (pause <0.7 m/s 4s, resume >1.3 m/s)
  → offline-first queue (enqueue → flush when online)

POST /activities  (or POST /activities/import-gpx)
  svc.Record: PostGIS LineStringZ + geodesic distance + elevation
  duration_s = moving time (elapsed − paused)
  point_offsets = seconds-from-start per vertex (pace gradient)

SetRecordedHook fires (composition root, main.go):
  1. challenges.RecordRunProgress   — ALL active memberships:
       distance → += km
       days     → recompute distinct IST run-days in window
       streak   → gaps-and-islands SQL → best + live streak
       → Redis leaderboard SetScore per challenge
  2. runlog.CreditActivity          — one run_log per active club
       → rolling boards (daily/weekly/monthly/all-time, IST)
  3. gamification.OnRun             — award pass:
       new badges → push to runner → club-chat 'badge' chip (opt-out)

Client, after save:
  badge(s) earned in the last few minutes → full-screen unlock modal
  (3D medal + confetti) → run detail
```

> Crediting is **best-effort by contract**: a leaderboard or badge hiccup is
> logged, never fails a run upload. The hook keeps `activities` unaware of the
> challenges/runlog/gamification packages.

---

## Realtime architecture *(built)*

```
internal/realtime — gorilla/websocket hub
  GET /ws?token=<access JWT>      (query param: WS can't carry the header)
  conns: map[userID]map[*conn]bool   ping 30s · read deadline 70s
  Publish(userIDs, event) — non-blocking; drops when a client is backed up

RTEvent {type: message|update|typing, scope: chapter|dm, id, payload}
  chapter events  → fan to all chapter member ids, keyed by chapter id
  DM events       → each end receives it keyed by THEIR PEER's id
  typing          → relayed via hub callback into messaging (membership-checked)

Client (lib/realtime.ts)
  one socket app-wide · exponential backoff 1s→16s · sendTyping throttled
  2.5s/conversation · poll fallback (20s live / 4s when socket down)

Push split:
  foreground  → custom in-app banner (MessageToast) via socket; OS banner
                suppressed for chat; active thread + own messages never notify
  background  → Expo push, throttled 25s per conversation+recipient,
                mute-aware, deep-links into the exact thread
```

---

## Gamification engine *(built)*

```
internal/gamification
  catalog.go   26 badges (id, emoji, desc, category, tier, xp, target, unit)
               + 6-level ladder. Pure data — display order = wall order.
  service.go   computeMetrics: 5 SQL round trips —
                 run aggregates (km, max single, time-of-day, monsoon, pace PRs)
                 distinct IST run-days (streak/weekend/consistency math in Go)
                 clubs + attendance counts
                 challenges joined/completed
                 final standings on ended challenges (RANK() window, score>0)
               Evaluate: metrics → statuses → batch-award new → XP → level
               OnRun: award pass + unlock push + club-chat announce (opt-out)

Anti-cheat by construction: every input is GPS-verified server data;
XP is derived (no ledger to inflate); badge inserts are PK-idempotent;
the announce respects users.announce_badges.

API:  GET /gamification            profile (also the award pass)
      PUT /gamification/announce   {enabled}
```

> **Wall UX is psychology-led**: identity (level + XP runway) → *Next up*
> (3 nearest unlocks with exact remaining — goal-gradient effect) → earned
> medals (proud, label-light) → locked grid (small, quiet). Medals render as
> crisp coins below 90px; the ribbon medal is reserved for ceremonial sizes
> (unlock modal, detail).

---

## Permission system *(built, unchanged)*

`org_roles` drives all permissions; `chapter_id = NULL` = org-wide. Most
specific role wins. `RequireChapterRole` / `RequireOrgRole` middleware guards;
guest browse lives in an unauthenticated `/public` route group (club directory,
city list, public challenge teasers — no leaderboards, no member data).

---

## Challenge visibility *(built, unchanged)*

```
Public    → everyone; any runner or club can join
City      → users whose profile city matches (checked at join)
Chapter   → that chapter's members only
Org-wide  → all members across the org's chapters
```

---

## Redis leaderboards *(built)*

```
Challenge boards (one sorted set per challenge) — BUILT:
  Key:    challenge:{challenge_id}:leaderboard
  Score:  progress_km (distance) | progress_days (days/streak best)
  Self-heal: empty board → rebuild from challenge_participants

Rolling club boards — BUILT differently than first designed:
  computed on the fly from run_logs with IST-aware windows
  (internal/runlog), raw km. The Redis/Lua rolling-key design is
  deferred — adopt only if Postgres aggregation gets slow.

City board — BUILT: live query over activities × users.city,
  periods week/month/today (IST midnight).
```

---

## Payment architecture *(Phase 3 — next big build)*

Design unchanged and ready to implement once Razorpay Route KYC clears
(build against test keys in parallel):

```
pkg/payments/        Provider interface (CreateOrder / VerifyWebhook /
  razorpay/          InitiateTransfer / CreateConnectedAccount)
  stripe/            Selection by chapter.payment_currency: INR → Razorpay,
                     USD|EUR → Stripe

Flow: initiate → provider order + pending transaction (gross/cut/net stored,
never derived) → mobile payment sheet → webhook (HMAC/signature verified) →
Route/Connect auto-split (90/10) → activate membership / challenge entry.

Replaces the three MOCK flows: membership fee, challenge join fee, paid
inventory. Adds: transactions + subscriptions + discount_codes tables, plan
enforcement at join time (Free 20 / Team 50 / Club 300 / Club+ unlimited),
finance dashboard. KYC gate: membership_fee_enabled requires a linked
razorpay_account_id / stripe_account_id.
```

---

## Folder responsibilities *(as built)*

```
backend/internal/
  auth/           register, login, JWT + rotating refresh, theft detection
  users/          profile CRUD, people search, display-name lookup
  organisations/  orgs + chapters CRUD, invite codes, roles, join flows
  permissions/    org_roles-backed middleware (org + chapter scope)
  attendance/     scheduled runs (single + recurring), check-ins, history
  activities/     GPS record + GPX import, routes, stats, splits, streaks
                  (+freezes), city leaderboard, chapter feed, recorded-hook
  challenges/     GPS-native challenge engine: CRUD + pre-start edit,
                  visibility, join/leave gates, day/streak recompute
  leaderboard/    Redis sorted-set ops (challenge boards, self-heal)
  runlog/         per-club run ledger + rolling boards (IST windows)
  messaging/      club/event/direct chat: reactions, replies, edit, voice,
                  read info, prefs (mute/archive), badge announce, push
  realtime/       websocket hub (connections, fanout, typing relay)
  races/          race calendar + MarathonMitra lazy sync + interests
  gamification/   badge catalog + award engine + XP/levels + announce
  notifications/  Expo push tokens + send helpers (throttled, deep-linked)
  analytics/      drop-off / engagement / volume (admin, live queries)
  inventory/      items, stock movements, issue/return
  uploads/        Cloudinary signed-upload params
  httpx/ config/ database/   shared plumbing (migrate-on-boot)

mobile/
  app/            Expo Router routes (tabs, club, challenge, thread,
                  activity, races, achievements, settings…)
  components/     design system + feature visuals (ChatThread, RouteTrace,
                  ProgressRing, Podium3D, BadgeMedal, Confetti, MessageToast…)
  lib/            typed API clients per domain + gps/queue/realtime/push/
                  unread/theme/gamification
```

---

## Build history & what's next

```
Phase 1  ✅ club core: auth, orgs/chapters/roles/members, attendance,
            challenges v1, Redis boards, push infra, tabs UI
Phase 2  ✅ messaging (→ later WhatsApp-grade + realtime + voice + push),
            rolling boards, analytics, inventory, member lifecycle
            (trust scoring built → REMOVED in 00027)
Phase 4  ✅ GPS engine: record + background + autopause + pace-gradient
            routes + replay; GPX import; streak freezes; city board;
            activity feed; race calendar (MarathonMitra); run share
Phase 5  ◐  gamification core ✅ (badges + XP + levels + wall + unlock
            celebrations + chat announce). Remaining: club XP / Member of
            the Week, follows, kudos, org-wide board, polls, explore.
Phase 3  ⏳ payments (Razorpay Route first — KYC is the gate), finance
            dashboard, plan enforcement, paid inventory; GPX on scheduled
            runs + nav deep-links; desktop admin panel; training fields.
Also queued: store readiness (icon/splash/listing), RunMitra→ClubMitra
            rename, chat search + voice waveforms, race-calendar extras.
```

---

## Environment variables

```env
# backend/.env
DATABASE_URL=postgres://clubmitra:clubmitra@localhost:5433/virtualrun?sslmode=disable
REDIS_URL=redis://localhost:6380
JWT_SECRET=...
PORT=8090
ENV=development

CLOUDINARY_CLOUD=... CLOUDINARY_KEY=... CLOUDINARY_SECRET=...

# Race calendar feed (optional — races sync only when set)
MARATHONMITRA_API_URL=https://api.marathonmitra.com/...

# Phase 3 (not yet used)
RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... RAZORPAY_WEBHOOK_SECRET=...
STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_CONNECT_CLIENT_ID=...
PLATFORM_CUT_PCT=10
SENDGRID_API_KEY=... EMAIL_FROM=noreply@clubmitra.in
```

---

## Deployment

| Service | Use | Notes |
|---|---|---|
| Render | Go API (auto-deploy on push to main) | free tier sleeps → cold starts |
| Neon | PostgreSQL + PostGIS | migrations self-apply on boot |
| Upstash | Redis (challenge boards) | |
| Cloudinary | photos, logos, chat media, voice notes | |
| Expo EAS | APK builds + OTA updates (channel `preview`) | `npm run update:preview` / `build:android` |
| MarathonMitra | race feed (read-only API) | env-gated, best-effort sync |

---

*ClubMitra — built for running clubs. India first, global-ready.*
