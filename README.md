# RunMitra

A running club operating system for India. Member management, attendance, challenges, inventory, and finances — with GPS run tracking built in.

> **Primary customer: Running clubs.** Free for runners. Clubs pay for features.

---

## What RunMitra Solves

Indian running clubs today run entirely on WhatsApp + spreadsheets + UPI screenshots. RunMitra replaces that with:

- One place to manage all club members, attendance, and fees
- Challenges with leaderboards (public, private, city-wide, org-wide)
- Inventory tracking (t-shirts, medals, bibs, gear)
- In-app payment collection with automatic platform split via Razorpay Route
- GPS run tracking (Phase 3) replacing manual Strava screenshots

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Mobile | React Native + Expo (SDK 54) | iOS + Android |
| Backend API | Go (Chi) | REST API |
| Primary DB | PostgreSQL + PostGIS | All relational data + GPS routes |
| Cache / Leaderboard | Redis (Upstash) | Real-time challenge rankings |
| Payments | Razorpay + Razorpay Route | Collections + automatic platform split |
| File Storage | Cloudinary | Profile photos, club logos, finisher certs |
| Push Notifications | Expo Notifications | Run reminders, challenge updates, fee alerts |
| Deployment | Render (API) + Neon (DB) + Upstash (Redis) | Low cost, scalable |

**Estimated monthly infrastructure cost: $0–$7 at launch**

---

## Revenue Model

```
Club pays:
  ├── Base subscription       flat monthly fee per chapter
  ├── Per-member fee          variable, after free member limit
  ├── Chapter fee             extra charge per additional chapter (org feature)
  └── Platform cut            % of every transaction processed through app:
        ├── Member joining fee (when club charges runners)
        ├── Inventory purchases
        └── Any future in-app payment

Runner pays:
  └── Nothing to RunMitra directly
      (pays club membership fee if club enables it)
```

All money flows through **Razorpay Route** — automatic split at transaction time. No manual settlements. No compliance risk.

---

## Project Structure

```
runmitra/
│
├── backend/
│   ├── cmd/
│   │   └── api/
│   │       └── main.go
│   ├── internal/
│   │   ├── auth/              # JWT, refresh tokens, registration
│   │   ├── users/             # Profiles, stats, aggregates
│   │   ├── organisations/     # Org + chapter + roles + membership
│   │   ├── permissions/       # Role-based access control middleware
│   │   ├── members/           # Member CRUD, status, invites (future split)
│   │   ├── attendance/        # Run scheduling, post-run check-in
│   │   ├── challenges/        # Challenge engine, visibility rules
│   │   ├── leaderboard/       # Redis sorted sets
│   │   ├── inventory/         # Items, stock, issue/return/purchase
│   │   ├── finance/           # Transactions, platform cut, settlements
│   │   ├── notifications/     # Push notification service
│   │   └── activities/        # GPS run recording (Phase 3)
│   ├── db/
│   │   └── migrations/        # goose SQL migrations
│   ├── pkg/
│   │   ├── geo/               # PostGIS helpers (Phase 3)
│   │   ├── razorpay/          # Payment + Route integration
│   │   └── middleware/        # Auth, permissions, soft-delete
│   ├── .env.example
│   ├── Makefile
│   └── go.mod
│
├── mobile/                    # Expo Router app (file-based routing)
│   ├── app/
│   │   ├── _layout.tsx        # ThemeProvider + AuthProvider, Inter font, push tap
│   │   ├── index.tsx          # auth gate → /home or /login
│   │   ├── (auth)/            # login, register (full mandatory profile)
│   │   ├── (tabs)/            # home, clubs, challenges, profile, settings
│   │   ├── club/              # [id] detail (tabs), new, join, edit/[id]
│   │   ├── challenge/         # [id] detail + leaderboard, new
│   │   ├── run/               # [id] detail, new, edit/[id]
│   │   ├── profile/           # edit
│   │   ├── schedule.tsx       # personal + club run schedule
│   │   └── activity/          # GPS run screens (Phase 3, parked)
│   ├── components/            # Avatar, ChipSelect, CityPicker, Calendar,
│   │                          # TimePicker, PhotoPicker, ProgressBar, ClubFeeFields…
│   ├── lib/                   # api (typed fetch client), auth (Context),
│   │                          # theme (light/dark + tokens), push, clubs,
│   │                          # challenges, attendance, profile, applyFont…
│   ├── app.json
│   └── package.json
│
│   # State = React Context + hooks (no Redux/Zustand). HTTP = a small typed
│   # fetch wrapper in lib/api.ts (no axios). Auth tokens in expo-secure-store.
│
├── ARCHITECTURE.md
└── README.md
```

---

## Build Phases

### Phase 1 — Club Core `(Month 1)` ✅ COMPLETE

**Goal: A club admin can create their club, add members, schedule runs, and run challenges.**

> **Phase 1 status — backend + mobile both built and working end-to-end:**
> standalone auth (register + login, bcrypt, JWT + refresh rotation/theft
> detection — no external identity dependency); full runner profile (view/edit,
> running level, searchable city, local-only photo picker); club core
> (organisations, chapters, invite codes, `org_roles` permissions, invite-first
> join, member management with status + soft-delete); attendance (recurring run
> scheduling, optional time, edit, check-in/out with reason, personal + club
> schedule with weekly list + month calendar); and the visibility-aware challenge
> engine (typed goals, scoping, individual/club join with date-gated join/leave,
> manual proof + admin verify, Redis leaderboard). Mobile app fully rebuilt for
> the club API (Clubs / Challenges / Profile tabs + all flows). Every admin action
> is role-gated; soft-delete everywhere.
>
> **Push notifications:** built — device-token storage + Expo Push sender +
> event triggers (run scheduled → members; join request → admins; approval →
> member; chapter challenge → members; proof verified → submitter), and the app
> registers/​unregisters tokens + deep-links on tap. **Real delivery needs a
> dev/prod build** (Expo Go can't receive remote push on current SDKs); the
> pipeline is production-ready for when an EAS build runs. The old GPS Home
> dashboard hasn't been reframed for the club product (cosmetic, optional).
>
> **⚠️ Built AHEAD of schedule (these are Phase 2 features, see below):** optional
> membership fees + subscriptions (monthly/annual + renewal), a club join-approval
> layer, and challenge join fees — all wired with a **MOCK payment step**. Real
> money movement (Razorpay Route, platform cut, transactions table) is still
> Phase 2 and NOT built. Consider these "structure done, real payments pending."

#### Week 1–2: Identity + Organisation
- [x] User registration — name, age, phone, email, t-shirt size, city, running level (photo: local-only until Phase 2 Cloudinary)
- [x] JWT auth + refresh tokens (rotation + theft detection)
- [x] Organisation create + update
- [x] Chapter create under org (same admin, multiple cities supported)
- [x] Admin role assignment: org_admin, chapter_admin, co_admin
- [x] Invite link per chapter (unique code, runner signs up via link → auto-joins chapter)
- [x] Soft delete on all entities — `deleted_at` everywhere, no hard delete for any org/admin action

#### Week 3–4: Members + Attendance + Challenges
- [x] Member management: add, view, status (active / lapsed / suspended), soft delete
- [x] Member profile view for admins (t-shirt size, join date, attendance record)
- [x] Attendance: admin schedules group run (title, date, time, location, distance target)
- [x] Post-run check-in: member marks attendance after run (or admin marks them)
- [x] Attendance history per member and per run
- [x] Challenge create: title, type (distance / days / streak), duration, target, visibility
- [x] Challenge visibility: public / chapter-only / city-only / org-wide
- [x] Challenge join: individual runner or club joins
- [x] Leaderboard per challenge (Redis sorted sets)
- [x] Phase 1 proof: runner pastes Strava link or screenshot → admin verifies manually
- [x] Basic push notifications: run scheduled, join request, approval, challenge created, proof verified *(infra complete — see note)*

#### Mobile app + design (Phase 1)
- [x] Expo Router (file-based), React Context state, typed `fetch` client, secure-store tokens
- [x] Tabs: **Home** (club dashboard), **Clubs**, **Challenges**, **Profile**, **Settings**
- [x] Design system in `lib/theme` — color/space/radius/type tokens, elevated cards, gradient heroes, Ionicons throughout
- [x] **Light / Dark mode** — instant toggle (Settings), persisted, first-run follows device
- [x] **Inter** brand font applied app-wide (weight→family patch; splash-gated load)
- [x] Push registration (Expo token register/unregister) + tap deep-links
- [x] Photo picker (local), searchable city picker, calendar + time pickers, recurring-run UI

---

### Phase 2 — Finance + Inventory `(Month 2)`

> Some of this was started early during Phase 1 with a **MOCK payment** (no real
> gateway yet). Marked 🟡 = structure/flow done, real money still pending.

- [ ] Razorpay Route setup — KYC flow for chapter admin during onboarding
- [x] 🟡 Membership fee toggle per chapter (on/off, set amount, monthly/annual)
- [x] 🟡 In-app payment: runner pays chapter membership fee — **mock** (confirm → activate)
- [x] 🟡 Club join-approval layer (request → admin approve → pay) — *new, not in original plan*
- [x] 🟡 Subscription + renewal: fee_paid_until, renewal window, renew-from-expiry math
- [x] 🟡 Challenge join fee — **mock** payment to join, date-gated join/leave
- [ ] Platform cut calculated and stored at transaction time
- [ ] Automatic split via Razorpay Route (club gets net, RunMitra gets cut)
- [ ] Transaction history: per runner, per chapter, per org (no `transactions` table yet)
- [ ] Finance dashboard for chapter admin: collected, pending, platform cut
- [ ] Subscription billing: org pays RunMitra for base + per-member fee
- [ ] Inventory CRUD: item name, category, quantity, size breakdown (JSONB)
- [ ] Inventory issue / return / purchase flow
- [ ] Platform cut on inventory purchases (member buys merch from club)
- [ ] Inventory dashboard: stock levels, transaction history

---

### Phase 3 — GPS Tracking `(Month 3)`

- [ ] GPS run recording: live route, distance, pace, elevation
- [ ] Offline run recording with auto-sync
- [ ] Server-side stats via PostGIS (geodesic distance, elevation gain)
- [ ] Route map + elevation chart per activity
- [ ] Run history with weekly summary
- [ ] Runs auto-credit to active challenges (replaces manual Strava proof)
- [ ] Personal stats: total km, streak, personal records
- [ ] Activity feed per chapter
- [ ] Background GPS (requires EAS dev build)
- [ ] Finisher certificate generation (Cloudinary PDF)

> The existing GPS/activities, leaderboard, and PostGIS code from the earlier
> solo-tracker build is kept in place and unused by the club core until Phase 3.

---

### Phase 4 — Social + Growth `(Month 4–5)`

- [ ] Public explore: discover clubs and challenges
- [ ] Club public profile page
- [ ] Follow individual runners
- [ ] Badges and achievements
- [ ] Org-wide challenge leaderboard (all chapters compete)
- [ ] Push notifications full suite

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

# Organisations + Chapters
POST   /api/v1/organisations
GET    /api/v1/organisations/:id
PUT    /api/v1/organisations/:id             # org admin
DELETE /api/v1/organisations/:id             # soft delete, org admin
POST   /api/v1/organisations/:id/chapters
GET    /api/v1/organisations/:id/chapters
POST   /api/v1/organisations/:id/roles       # assign org/chapter admin role
GET    /api/v1/chapters/:id
PUT    /api/v1/chapters/:id                   # chapter admin
DELETE /api/v1/chapters/:id                   # soft delete, org admin

# Members + membership
GET    /api/v1/chapters/mine                  # my chapters + my role/status in each
POST   /api/v1/chapters/join                  # join via invite code -> active | pending | pending_payment
POST   /api/v1/chapters/:id/members           # admin adds a member
GET    /api/v1/chapters/:id/members
GET    /api/v1/chapters/:id/members/:uid      # admin: member detail
PUT    /api/v1/chapters/:id/members/:uid      # admin: set status
DELETE /api/v1/chapters/:id/members/:uid      # soft delete, admin
POST   /api/v1/chapters/:id/members/:uid/approve  # admin approves a pending join
POST   /api/v1/chapters/:id/pay               # self: pay/renew membership fee (MOCK — Phase 2)

# Attendance
POST   /api/v1/runs                           # schedule one run (chapter_id in body; admin)
POST   /api/v1/runs/bulk                      # schedule a recurring series (admin)
GET    /api/v1/runs?chapter_id=:id            # a chapter's runs
GET    /api/v1/runs/:id
PUT    /api/v1/runs/:id                        # admin: edit a run
POST   /api/v1/runs/:id/checkin               # self check-in (or admin marks a member)
POST   /api/v1/runs/:id/checkout              # undo / mark left early
GET    /api/v1/runs/:id/attendance
GET    /api/v1/members/:uid/attendance        # member's attendance history

# Challenges
GET    /api/v1/challenges                      # browse visible (or ?joined=true)
POST   /api/v1/challenges                      # supports join_fee + lock_date
GET    /api/v1/challenges/:id
POST   /api/v1/challenges/:id/join             # {paid?, chapter_id?} — 402 if fee unpaid; date-gated
POST   /api/v1/challenges/:id/leave            # before lock_date / start
GET    /api/v1/challenges/:id/leaderboard
POST   /api/v1/challenges/:id/proof            # submit Strava link / screenshot (+ proof_date)
GET    /api/v1/challenges/:id/proof            # creator: review queue
POST   /api/v1/challenges/:id/proof/:pid/verify # creator: verify -> credits progress

# Push notifications
POST   /api/v1/push/token                      # register this device's Expo token
DELETE /api/v1/push/token                      # unregister (on logout)

# Activities (Phase 3 — code present, unused by the club core)
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/:id
GET    /api/v1/activities/:id/geojson

# Inventory (Phase 2 — NOT built yet)
#   /chapters/:id/inventory, /inventory/:id/{issue,return,purchase}, …
# Finance (Phase 2 — NOT built; membership/challenge fees are MOCK today)
#   /payments/initiate, /payments/webhook (Razorpay), /chapters/:id/finance/summary, …
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
| Soft delete member | ✅ | ✅ | ✅ | ✅ | ❌ |
| Soft delete chapter | ✅ | ✅ | ❌ | ❌ | ❌ |
| Soft delete org | ✅ | ❌ | ❌ | ❌ | ❌ |
| Create challenge | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage inventory | ✅ | ✅ | ✅ | ✅ | ❌ |
| View finances | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage billing | ✅ | ✅ | ❌ | ❌ | ❌ |
| Hard delete anything | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Core Design Rules

1. **Soft delete everywhere** — every table has `deleted_at`. No org or admin can permanently delete data. Only platform admin for legal/compliance only.
2. **One transaction table** — every money movement goes through `transactions`. Platform cut stored at transaction time, never derived later.
3. **Razorpay Route only** — no manual splits. Every club collecting money must complete Razorpay KYC before enabling fees.
4. **Invite-first onboarding** — each chapter gets a unique invite link. Runner clicks → signs up with full profile → auto-joins chapter.
5. **Redis leaderboard** — self-heals from Postgres. Sorted sets per challenge. Challenge progress updates on every run log.
6. **Standalone** — RunMitra owns identity. No external auth dependency, no shared DB, no linked accounts required.

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

DATABASE_URL=postgres://runmitra:runmitra@localhost:5433/runmitra?sslmode=disable
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
| 1 | Club core — members, attendance, challenges | Month 1 |
| 2 | Finance + inventory + Razorpay Route | Month 2 |
| 3 | GPS tracking + auto challenge credit | Month 3 |
| 4 | Social, explore, public profiles | Month 4–5 |
