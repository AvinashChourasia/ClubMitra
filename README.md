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
├── mobile/
│   ├── app/
│   │   ├── (auth)/            # Login, Register (with full profile)
│   │   ├── (tabs)/            # Home, Clubs, Challenges, Profile
│   │   ├── club/              # Club detail, members, attendance
│   │   ├── challenge/         # Challenge detail, leaderboard
│   │   ├── inventory/         # Club inventory screens
│   │   ├── finance/           # Admin finance dashboard
│   │   └── activity/          # GPS run screens (Phase 3)
│   ├── components/
│   ├── hooks/
│   ├── services/              # API client (axios)
│   ├── store/                 # Zustand state management
│   ├── app.json
│   └── package.json
│
├── ARCHITECTURE.md
└── README.md
```

---

## Build Phases

### Phase 1 — Club Core `(Month 1)` 🚧 IN PROGRESS

**Goal: A club admin can create their club, add members, schedule runs, and run challenges.**

> **Foundation built so far (this pass):** standalone auth (register + login with
> bcrypt, JWT + refresh-token rotation/theft detection — the MarathonMitra
> identity dependency has been removed); the `users` table now holds the full
> runner profile; the club core is live — organisations, city-level chapters with
> unique invite codes, the `org_roles` permission model (`org_admin` /
> `chapter_admin` / `co_admin`), invite-first join, and member listing — all
> gated by role-checking middleware. Attendance, challenge-visibility rules, and
> the proof flow are the next slice.

#### Week 1–2: Identity + Organisation
- [x] User registration — name, age, phone, email, t-shirt size, city, profile photo
- [x] JWT auth + refresh tokens (rotation + theft detection)
- [x] Organisation create (update: pending)
- [x] Chapter create under org (same admin, multiple cities supported)
- [x] Admin role assignment: org_admin, chapter_admin, co_admin
- [x] Invite link per chapter (unique code, runner signs up via link → auto-joins chapter)
- [x] Soft delete on all entities — `deleted_at` everywhere, no hard delete for any org/admin action

#### Week 3–4: Members + Attendance + Challenges
- [x] Member management: add, view, status (active / lapsed / suspended), soft delete
- [ ] Member profile view for admins (t-shirt size, join date, fee status, attendance record)
- [ ] Attendance: admin schedules group run (title, date, time, location, distance target)
- [ ] Post-run check-in: member marks attendance after run
- [ ] Attendance history per member and per run
- [ ] Challenge create: title, type (distance / days / streak), duration, target, visibility
- [ ] Challenge visibility: public / chapter-only / city-only / org-wide
- [ ] Challenge join: individual runner or club joins
- [ ] Leaderboard per challenge (Redis sorted sets)
- [ ] Phase 1 proof: runner pastes Strava link or screenshot → admin verifies manually
- [ ] Basic push notifications: run scheduled, challenge update

---

### Phase 2 — Finance + Inventory `(Month 2)`

- [ ] Razorpay Route setup — KYC flow for chapter admin during onboarding
- [ ] Membership fee toggle per chapter (on/off, set amount)
- [ ] In-app payment: runner pays chapter membership fee
- [ ] Platform cut calculated and stored at transaction time
- [ ] Automatic split via Razorpay Route (club gets net, RunMitra gets cut)
- [ ] Transaction history: per runner, per chapter, per org
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
POST   /api/v1/organisations/:id/chapters
GET    /api/v1/organisations/:id/chapters
POST   /api/v1/organisations/:id/roles      # assign org/chapter admin role
GET    /api/v1/chapters/:id                  # (planned)
PUT    /api/v1/chapters/:id                  # (planned)
DELETE /api/v1/chapters/:id                  # soft delete only (planned)

# Members
POST   /api/v1/chapters/join                 # join via invite code
POST   /api/v1/chapters/:id/members          # admin adds a member
GET    /api/v1/chapters/:id/members
PUT    /api/v1/chapters/:id/members/:uid     # (planned)
DELETE /api/v1/chapters/:id/members/:uid     # soft delete only (planned)

# Attendance (planned)
POST   /api/v1/chapters/:id/runs
GET    /api/v1/chapters/:id/runs
POST   /api/v1/runs/:id/checkin
GET    /api/v1/runs/:id/attendance
GET    /api/v1/members/:id/attendance

# Challenges
GET    /api/v1/challenges
POST   /api/v1/challenges
GET    /api/v1/challenges/:id
POST   /api/v1/challenges/:id/join
GET    /api/v1/challenges/:id/leaderboard
GET    /api/v1/challenges/:id/progress

# Inventory (Phase 2)
GET    /api/v1/chapters/:id/inventory
POST   /api/v1/chapters/:id/inventory
PUT    /api/v1/inventory/:id
POST   /api/v1/inventory/:id/issue
POST   /api/v1/inventory/:id/return
POST   /api/v1/inventory/:id/purchase

# Finance (Phase 2)
GET    /api/v1/chapters/:id/transactions
GET    /api/v1/chapters/:id/finance/summary
POST   /api/v1/payments/initiate
POST   /api/v1/payments/webhook           # Razorpay webhook

# Activities (Phase 3)
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/:id
GET    /api/v1/activities/:id/geojson
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
