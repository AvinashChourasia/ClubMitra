# ClubMitra

A running club operating system for India. Member management, attendance, challenges, inventory, finances, and GPS run tracking — built for clubs of every size.

> **Primary customer: Running clubs.** Free for runners. Clubs pay for features.
> **A MarathonMitra product.** Standalone — separate backend, separate database, no shared auth.

---

## What ClubMitra Solves

Indian running clubs today run entirely on WhatsApp + spreadsheets + UPI screenshots. ClubMitra replaces that with:

- One place to manage all club members, attendance, fees, and inventory
- Challenges with leaderboards — public, chapter, city-wide, org-wide, and rolling daily/weekly/monthly
- Trust-scored activity validation — replacing screenshot chaos with a credibility system
- In-app payment collection with automatic platform split via Razorpay Route
- GPS run tracking replacing manual Strava proof
- Drop-off analytics so admins know who's drifting before they leave

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Mobile | React Native + Expo (SDK 54) | iOS + Android |
| Backend API | Go (Chi) | REST API |
| Primary DB | PostgreSQL + PostGIS | All relational data + GPS routes |
| Cache / Leaderboard | Redis (Upstash) | Real-time challenge + rolling leaderboards |
| Payments | Razorpay + Razorpay Route | Collections + automatic platform split |
| File Storage | Cloudinary | Profile photos, club logos, finisher certs, GPX previews |
| Push Notifications | Expo Notifications | Run reminders, challenge updates, fee alerts, rank changes |
| Deployment | Render (API) + Neon (DB) + Upstash (Redis) | Low cost, scalable |

**Estimated monthly infrastructure cost: $0–$7 at launch**

> **Naming note:** the product is now **ClubMitra**, but the current codebase still
> ships under the old `RunMitra` / `virtual-run-tracker` names (Go module, DB
> `virtualrun`, ports 8090/5433/6380). The rename is a tracked Phase 2 cleanup.

---

## Revenue Model

```
Club pays:
  ├── Subscription tier          based on member count (see tiers below)
  ├── Per-member overage         if club exceeds tier limit mid-cycle
  ├── Chapter fee                extra charge per additional chapter (org feature)
  └── Platform cut               % of every transaction processed through app:
        ├── Member joining fee   when club charges runners to join
        ├── Challenge join fee   when club runs paid challenges
        ├── Inventory purchases  when members buy merch from club
        └── Event registration   when club runs paid events

Runner pays:
  └── Nothing to ClubMitra directly
      (pays club membership fee if club enables it)
```

### Subscription Tiers

| Plan | Member Limit | Key Features | Price |
|---|---|---|---|
| Starter | Up to 50 | Club core, leaderboards, 2 challenges/month | Free |
| Growth | 50–200 | Full challenge engine, rolling leaderboards, analytics basics | ₹999/month |
| Pro | 200–1,000 | Advanced analytics, drop-off tracking, priority support | ₹2,999/month |
| Enterprise | 1,000+ | Custom scoring, dedicated support, SLA | Custom |

All money flows through **Razorpay Route** — automatic split at transaction time. No manual settlements. No compliance risk.

---

## Project Structure

```
clubmitra/
│
├── backend/
│   ├── cmd/
│   │   └── api/
│   │       └── main.go
│   ├── internal/
│   │   ├── auth/              # JWT, refresh tokens, registration
│   │   ├── users/             # Profiles, trust score, stats, aggregates
│   │   ├── organisations/     # Org + chapter + roles + membership
│   │   ├── permissions/       # Role-based access control middleware
│   │   ├── members/           # Member lifecycle, status, invites      [Phase 2]
│   │   ├── attendance/        # Run scheduling, post-run check-in
│   │   ├── challenges/        # Challenge engine, visibility rules, proof
│   │   ├── leaderboard/       # Redis sorted sets — challenge + rolling
│   │   ├── activities/        # Activity submission, trust pipeline, GPS (Phase 3)
│   │   ├── inventory/         # Items, stock, issue/return/purchase    [Phase 2]
│   │   ├── finance/           # Transactions, platform cut, settlements [Phase 2]
│   │   ├── analytics/         # Drop-off metrics, engagement dashboard  [Phase 2]
│   │   ├── badges/            # Milestones, achievement engine          [Phase 4]
│   │   └── notifications/     # Push notification service
│   ├── db/
│   │   └── migrations/        # goose SQL migrations
│   ├── pkg/
│   │   ├── geo/               # PostGIS helpers (Phase 3)
│   │   ├── razorpay/          # Payment + Route integration             [Phase 2]
│   │   └── middleware/        # Auth, permissions, soft-delete
│   ├── .env.example
│   ├── Makefile
│   └── go.mod
│
├── mobile/
│   ├── app/
│   │   ├── _layout.tsx        # ThemeProvider + AuthProvider, Inter font, push tap
│   │   ├── index.tsx          # auth gate → /home or /login
│   │   ├── (auth)/            # login, register (full mandatory profile)
│   │   ├── (tabs)/            # home, clubs, challenges, profile, settings
│   │   ├── club/              # [id] detail, new, join, edit
│   │   ├── challenge/         # [id] detail + leaderboard, new
│   │   ├── run/               # [id] detail, new, edit
│   │   ├── profile/           # edit (achievements, trust score → Phase 2/4)
│   │   ├── schedule.tsx       # personal + club run schedule
│   │   └── activity/          # GPS run screens (Phase 3)
│   ├── components/            # Avatar, ChipSelect, CityPicker, Calendar,
│   │                          # TimePicker, PhotoPicker, ProgressBar…
│   ├── lib/                   # api (typed fetch), auth (Context),
│   │                          # theme (light/dark + tokens), push,
│   │                          # clubs, challenges, attendance, profile…
│   ├── app.json
│   └── package.json
│
│   # State = React Context + hooks. HTTP = typed fetch wrapper in lib/api.ts.
│   # Auth tokens in expo-secure-store.
│
├── ARCHITECTURE.md
└── README.md
```

---

## Build Phases

### Phase 1 — Club Core ✅ COMPLETE

**Goal: A club admin can create their club, add members, schedule runs, and run challenges.**

> **Phase 1 status — backend + mobile both built and working end-to-end:**
> Standalone auth (register + login, bcrypt, JWT + refresh rotation/theft
> detection); full runner profile (view/edit, running level, searchable city,
> local photo picker); club core (organisations, chapters, invite codes,
> org_roles permissions, invite-first join, member management with status +
> soft-delete); attendance (recurring run scheduling, optional time, edit,
> check-in/out with reason, personal + club schedule with weekly list + month
> calendar); visibility-aware challenge engine (typed goals, scoping,
> individual/club join with date-gated join/leave, manual proof + admin verify,
> Redis leaderboard); light/dark mode; Inter brand font; push notification
> infrastructure.
>
> **Built ahead of schedule (Phase 2 structure, MOCK payments):** optional
> membership fees + subscriptions (monthly/annual + renewal), club join-approval
> layer, and challenge join fees — all wired with a MOCK payment step. Real money
> movement (Razorpay Route, platform cut, transactions table) is Phase 2.

#### Week 1–2: Identity + Organisation
- [x] User registration — name, age, phone, email, t-shirt size, city, running level
- [x] JWT auth + refresh tokens (rotation + theft detection)
- [x] Organisation create + update
- [x] Chapter create under org (multi-city supported)
- [x] Admin role assignment: org_admin, chapter_admin, co_admin
- [x] Invite link per chapter (unique code → auto-join)
- [x] Soft delete on all entities — `deleted_at` everywhere

#### Week 3–4: Members + Attendance + Challenges
- [x] Member management: add, view, status (active/lapsed/suspended/pending), soft delete
- [x] Member profile view for admins (t-shirt size, join date, attendance record)
- [x] Attendance: admin schedules group run (title, date, time, location, distance target)
- [x] Post-run check-in: member marks attendance (or admin marks them)
- [x] Attendance history per member and per run
- [x] Challenge create: title, type (distance/days/streak), duration, target, visibility
- [x] Challenge visibility: public / chapter-only / city-only / org-wide
- [x] Challenge join: individual runner or club joins
- [x] Leaderboard per challenge (Redis sorted sets)
- [x] Phase 1 proof: runner pastes Strava link or screenshot → admin verifies
- [x] Push notifications: run scheduled, join request, approval, challenge created, proof verified *(infra — real delivery needs an EAS build)*

#### Mobile (Phase 1)
- [x] Expo Router (file-based), React Context state, typed fetch client, secure-store tokens
- [x] Tabs: Home (dashboard), Clubs, Challenges, Profile, Settings
- [x] Design system — color/space/radius/type tokens, elevated cards, gradient heroes
- [x] Light / Dark mode — instant toggle, persisted, follows device on first run
- [x] Inter brand font app-wide
- [x] Push registration + tap deep-links
- [x] Photo picker, searchable city picker, calendar + time pickers, recurring run UI

---

### Phase 2 — Finance + Inventory + Trust `(Month 2)` 🚧 IN PROGRESS

> Membership + challenge fees already have structure (MOCK). Phase 2 wires real
> money and adds the trust system that makes activity validation scale.

#### Finance (real payments)
- [ ] Razorpay Route setup — KYC flow for chapter admin during onboarding
- [ ] Subscription tier enforcement (Starter/Growth/Pro) — gate features by plan
- [x] 🟡 Membership fee toggle per chapter (on/off, amount, monthly/annual) — MOCK
- [x] 🟡 In-app payment: runner pays chapter membership fee — MOCK
- [x] 🟡 Challenge join fee — MOCK payment to join, date-gated
- [ ] Platform cut calculated and stored at transaction time
- [ ] Automatic split via Razorpay Route (club gets net, ClubMitra gets cut)
- [ ] Transaction history: per runner, per chapter, per org
- [ ] Finance dashboard for chapter admin: collected, pending, platform cut
- [ ] Subscription billing: org pays ClubMitra monthly

#### Inventory
- [ ] Inventory CRUD: item name, category, quantity, size breakdown (JSONB)
- [ ] Inventory issue / return / purchase flow
- [ ] Platform cut on inventory purchases
- [ ] Inventory dashboard: stock levels, transaction history

#### Trust Score (new — from research)
- [ ] Trust score per runner: proof submission rate + approval rate + account age
- [ ] High trust (80+) → activity auto-approved; low trust → manual review queue
- [ ] Trust score visible on runner profile (badge tier: Basic / Trusted / Verified)
- [ ] Activity submission method tiers: Manual → Screenshot → Strava link → GPX file

#### Extended Member Lifecycle (new — from research)
- [ ] On Leave status: self-declared, paused from leaderboards temporarily
- [ ] Injured status: removed from performance comparisons
- [ ] Alumni status: departed member, read-only history, no active participation

#### Analytics — Drop-off Dashboard (new — from research)
- [ ] Members with no activity in 7 / 14 / 30 / 60 days — visible to chapter admin
- [ ] Weekly engagement rate: % of members who logged at least one activity
- [ ] Activity volume trend: total km logged per week/month across the club

#### Rolling Leaderboards (new — from research)
- [ ] Daily leaderboard: top runners by distance — resets each day
- [ ] Weekly leaderboard: rolling 7-day — resets every Monday
- [ ] Monthly leaderboard: full calendar month — primary competitive reference
- [ ] All-time leaderboard: cumulative lifetime performance
- [ ] All rolling leaderboards live at chapter level (independent of specific challenges)

#### Cloudinary (deferred from Phase 1)
- [ ] Profile photo upload — Cloudinary URL (currently local-only)
- [ ] Club logo + banner upload
- [ ] Certificate PDF storage

---

### Phase 3 — GPS Tracking `(Month 3)`

- [ ] GPS run recording: live route, distance, pace, elevation
- [ ] Offline run recording with auto-sync
- [ ] Server-side stats via PostGIS (geodesic distance, elevation gain)
- [ ] Route map + elevation chart per activity
- [ ] Run history with weekly summary
- [ ] GPX file upload: import from any GPS device (Garmin, Polar, Suunto)
- [ ] Runs auto-credit to active challenges (replaces manual Strava proof)
- [ ] Runs auto-credit to rolling leaderboards
- [ ] Trust score update on GPS-verified activity (highest trust tier)
- [ ] Personal stats: total km, streak, personal records
- [ ] Activity feed per chapter
- [ ] Streak freeze: 2 per month to protect streaks during planned rest
- [ ] Background GPS (requires EAS dev build)
- [ ] Finisher certificate generation (Cloudinary PDF)
- [ ] City leaderboard: all verified runners in a city ranked collectively

---

### Phase 4 — Social + Badges + Growth `(Month 4–5)`

- [ ] Public explore: discover clubs and challenges
- [ ] Club public profile page
- [ ] Follow individual runners
- [ ] Badges and milestones:
      - Distance: 50km, 100km, 500km, 1,000km, 5,000km
      - Streak: 7-day, 30-day, 90-day consecutive activity
      - Event: First Challenge, 5 Challenges, 10 Challenges
      - Speed: First sub-30 5K, sub-60 10K, sub-2hr Half Marathon
      - Club: Founding Member, Longest Serving, Club Record Holder
- [ ] Lightweight XP system: earn XP for activities, challenges completed, streaks
- [ ] Achievement wall on runner profile (all badges + certs earned)
- [ ] Org-wide challenge leaderboard (all chapters compete)
- [ ] Push notifications full suite — rank changes, milestone alerts, re-engagement

---

### Phase 5+ — Scale Features `(After soft launch feedback)`

- [ ] League system between clubs (needs 50+ clubs first)
- [ ] Coach role + training plan module
- [ ] Physical event timing partner integration
- [ ] Custom domain per club (clubname.clubmitra.in)
- [ ] Advanced scoring algorithms per club
- [ ] White-label for federations

---

## Key API Endpoints

```
# Auth + Users
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/users/me
PUT    /api/v1/users/me
GET    /api/v1/users/me/stats
GET    /api/v1/users/me/trust-score            # (Phase 2)

# Organisations + Chapters
POST   /api/v1/organisations
GET    /api/v1/organisations/:id
PUT    /api/v1/organisations/:id
DELETE /api/v1/organisations/:id              # soft delete, org admin
POST   /api/v1/organisations/:id/chapters
GET    /api/v1/organisations/:id/chapters
POST   /api/v1/organisations/:id/roles
GET    /api/v1/chapters/:id
PUT    /api/v1/chapters/:id
DELETE /api/v1/chapters/:id                   # soft delete, org admin

# Members + Membership
GET    /api/v1/chapters/mine
POST   /api/v1/chapters/join                  # via invite code
POST   /api/v1/chapters/:id/members
GET    /api/v1/chapters/:id/members
GET    /api/v1/chapters/:id/members/:uid
PUT    /api/v1/chapters/:id/members/:uid      # set status (on_leave/injured/alumni → Phase 2)
DELETE /api/v1/chapters/:id/members/:uid      # soft delete
POST   /api/v1/chapters/:id/members/:uid/approve
POST   /api/v1/chapters/:id/pay               # pay/renew membership fee (MOCK — Phase 2)

# Attendance
POST   /api/v1/runs
POST   /api/v1/runs/bulk                      # recurring series
GET    /api/v1/runs?chapter_id=:id
GET    /api/v1/runs/:id
PUT    /api/v1/runs/:id
POST   /api/v1/runs/:id/checkin
POST   /api/v1/runs/:id/checkout
GET    /api/v1/runs/:id/attendance
GET    /api/v1/members/:uid/attendance

# Challenges
GET    /api/v1/challenges
POST   /api/v1/challenges
GET    /api/v1/challenges/:id
POST   /api/v1/challenges/:id/join
POST   /api/v1/challenges/:id/leave
GET    /api/v1/challenges/:id/leaderboard
POST   /api/v1/challenges/:id/proof
GET    /api/v1/challenges/:id/proof
POST   /api/v1/challenges/:id/proof/:pid/verify

# Push Notifications
POST   /api/v1/push/token
DELETE /api/v1/push/token

# ─── Phase 2/3 (planned, NOT built) ───────────────────────────────
# Activities (Phase 3 — code present, unused by club core)
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/:id
GET    /api/v1/activities/:id/geojson
POST   /api/v1/activities/gpx                 # GPX file upload (Phase 3)

# Rolling leaderboards (Phase 2)
GET    /api/v1/chapters/:id/leaderboard/daily
GET    /api/v1/chapters/:id/leaderboard/weekly
GET    /api/v1/chapters/:id/leaderboard/monthly
GET    /api/v1/chapters/:id/leaderboard/alltime
GET    /api/v1/city/:city/leaderboard         # city-wide (Phase 3)

# Analytics (Phase 2)
GET    /api/v1/chapters/:id/analytics/dropoff
GET    /api/v1/chapters/:id/analytics/engagement
GET    /api/v1/chapters/:id/analytics/activity-volume

# Inventory (Phase 2)
GET    /api/v1/chapters/:id/inventory
POST   /api/v1/chapters/:id/inventory
PUT    /api/v1/inventory/:id
POST   /api/v1/inventory/:id/issue
POST   /api/v1/inventory/:id/return
POST   /api/v1/inventory/:id/purchase

# Finance (Phase 2)
POST   /api/v1/payments/initiate
POST   /api/v1/payments/webhook               # Razorpay webhook
GET    /api/v1/chapters/:id/finance/summary
GET    /api/v1/chapters/:id/transactions
```

---

## Permission Rules

| Action | Platform Admin | Org Admin | Chapter Admin | Co-Admin | Member |
|---|---|---|---|---|---|
| Create organisation | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create chapter | ✅ | ✅ | ❌ | ❌ | ❌ |
| Assign chapter admin | ✅ | ✅ | ❌ | ❌ | ❌ |
| Assign co-admin | ✅ | ✅ | ✅ | ❌ | ❌ |
| Add / remove member | ✅ | ✅ | ✅ | ✅ | ❌ |
| Set member status (incl. on_leave/injured/alumni) | ✅ | ✅ | ✅ | ✅ | ❌ |
| Set own status to on_leave | ✅ | ✅ | ✅ | ✅ | ✅ |
| Soft delete member | ✅ | ✅ | ✅ | ✅ | ❌ |
| Soft delete chapter | ✅ | ✅ | ❌ | ❌ | ❌ |
| Soft delete org | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create challenge | ✅ | ✅ | ✅ | ✅ | ❌ |
| Verify activity proof | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage inventory | ✅ | ✅ | ✅ | ✅ | ❌ |
| View finances | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage billing / subscription | ✅ | ✅ | ❌ | ❌ | ❌ |
| View drop-off analytics | ✅ | ✅ | ✅ | ❌ | ❌ |
| Hard delete anything | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Core Design Rules

1. **Soft delete everywhere** — every table has `deleted_at`. No org or admin can permanently delete data. Platform admin only, for legal/compliance.
2. **One transaction table** — every money movement goes through `transactions`. Platform cut stored at transaction time, never derived later.
3. **Razorpay Route only** — no manual splits. Every club collecting money must complete Razorpay KYC before enabling fees.
4. **Invite-first onboarding** — each chapter gets a unique invite link. Runner clicks → signs up with full profile → auto-joins chapter.
5. **Trust-first activity validation** — every submitted activity flows through the trust pipeline. High trust auto-approves. Proof method sets the trust weight.
6. **Redis leaderboard** — self-heals from Postgres. Sorted sets per challenge AND per rolling period (daily/weekly/monthly/all-time).
7. **Standalone** — ClubMitra owns identity. No external auth dependency, no shared DB, no linked accounts required with MarathonMitra.
8. **Quality over quantity** — every new feature must justify itself: does this help a club admin save time or a runner stay engaged?

---

## Getting Started

### Prerequisites

- Go 1.22+
- Node.js 18+
- PostgreSQL 15+ with PostGIS
- Redis (local or Upstash)
- Expo CLI: `npm install -g expo`
- Razorpay account with Route enabled (Phase 2)

### Backend setup

```bash
cd backend
cp .env.example .env
go mod tidy
make migrate-up
make run
```

### Mobile setup

```bash
cd mobile
npm install
npx expo start
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

> The current dev setup still uses the `virtualrun` DB / ports 5433 + 6380 and
> module `virtual-run-tracker` until the ClubMitra rename lands.

---

## Deployment

| Service | Use | Cost |
|---|---|---|
| Render | Go API | Free / $7 mo |
| Neon | PostgreSQL + PostGIS | Free (0.5 GB) |
| Upstash | Redis | Free (10k req/day) |
| Cloudinary | File storage | Free (25 GB) |
| Expo EAS | App builds | Free |

**Estimated monthly cost at launch: $0–$7**

---

## Roadmap Summary

| Phase | Focus | Timeline |
|---|---|---|
| 1 | Club core — members, attendance, challenges | Month 1 ✅ |
| 2 | Finance, inventory, trust score, rolling leaderboards, analytics | Month 2 |
| 3 | GPS tracking, GPX upload, city leaderboard, streak freeze | Month 3 |
| 4 | Social, badges, XP, achievements, public profiles | Month 4–5 |
| 5+ | League system, coaches, physical events, white-label | Post soft launch |
