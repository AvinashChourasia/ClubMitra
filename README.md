# RunMitra

A **MarathonMitra** product — a GPS run-tracking app for Indian runners. Track real runs, join virtual challenges, compete on leaderboards, and earn finisher badges linked to your MarathonMitra race registrations.

> **V1 Goal:** Ship fully tested by end of June 2026. One shared MarathonMitra account across app and website.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo (SDK 54), Expo Router |
| Backend API | Go (Chi router) |
| Database | PostgreSQL + PostGIS |
| Cache / Leaderboard | Redis |
| Deployment | Render (API + Redis) + Neon (Postgres) |
| Maps | react-native-maps (Apple Maps via Expo Go) |

---

## Project Structure

```
runmitra/
│
├── backend/                  # Go API
│   ├── cmd/api/main.go       # Entry point (self-migrates on startup)
│   ├── internal/
│   │   ├── auth/             # JWT access + rotating refresh tokens
│   │   ├── activities/       # Run recording, stats, GeoJSON
│   │   ├── challenges/       # Virtual run / challenge engine
│   │   ├── leaderboard/      # Redis sorted sets
│   │   ├── users/            # Profiles
│   │   ├── database/         # pgx pool, Redis, migration runner
│   │   ├── httpx/            # Shared HTTP helpers (JSON, decode, context)
│   │   └── config/           # Env-based config
│   ├── db/migrations/        # goose SQL migrations (embedded in binary)
│   ├── pkg/geo/              # GPS helpers, EWKT, elevation, duration
│   ├── Dockerfile            # Multi-stage prod image (~41 MB)
│   ├── render.yaml           # Render deploy blueprint
│   ├── DEPLOY.md             # Step-by-step deploy guide
│   └── Makefile
│
├── mobile/                   # React Native (Expo)
│   ├── app/
│   │   ├── (auth)/           # Login, Register
│   │   ├── (tabs)/           # Home, Challenges, Profile
│   │   ├── activity/         # Live run + run detail
│   │   └── challenge/        # Challenge detail + create
│   ├── components/           # StatCard, ProgressBar, ElevationChart
│   └── lib/                  # api, auth, activities, challenges, runQueue, gpsFilter
│
└── README.md
```

---

## V1 Delivery — June 2026

### Phase 1 — Project setup & auth ✅ DONE
- [x] Go project structure, modules, linter, Makefile
- [x] PostgreSQL + PostGIS setup, migrations with goose
- [x] Auth API: login via MarathonMitra (shared account), JWT + refresh tokens (rotation + theft detection), logout, protected `/users/me`
- [x] React Native + Expo init (SDK 54), Expo Router navigation shell
- [x] Login UI wired to auth API — tested on a physical iPhone via Expo Go

### Phase 2 — GPS run recording ✅ MOSTLY DONE
- [x] Activities DB schema with PostGIS geometry column (`geography(LineStringZ,4326)` + GiST index)
- [x] `POST /activities` — accept coordinate array, store route
- [x] Server-side stats: distance (PostGIS geodesic), avg pace, elevation gain
- [x] Live run screen: timer, pace, distance HUD (+ GPS noise filtering for accurate distance)
- [x] Upload run to API on finish + offline queue (persist-first, auto-sync)
- [ ] **Background GPS recording** — foreground done; needs EAS dev build (Expo Go limitation). Also bundle in-progress-run checkpoint/resume here.

### Phase 3 — Map & activity history ✅ DONE
- [x] `GET /activities` with pagination, `GET /activities/:id` (ownership-checked)
- [x] GeoJSON endpoint for route polyline (`GET /activities/:id/geojson`, 3D LineString)
- [x] Route map view (react-native-maps, Apple Maps)
- [x] Activity detail: stats cards + elevation chart (altitude stored as route Z dimension)
- [x] Run history list with weekly summary

### Phase 4 — Virtual run / challenge engine ✅ DONE
- [x] Challenge schema: target distance + time window + memberships (durable progress)
- [x] Challenge API: create, join, list, get, progress tracking (runs auto-credit all joined challenges)
- [x] Per-run opt-out ("don't count toward challenges") for warm-ups / test runs
- [x] Redis leaderboard: sorted set per challenge (self-heals from Postgres)
- [x] Challenge browse + join screen (All / Joined filter, create form)
- [x] My challenges + detail: progress bar, %, leaderboard with your rank highlighted

### Phase 5 — Profile, MarathonMitra integration & deployment 🔧 IN PROGRESS
- [x] User stats API: total km, total runs, longest run, best pace, current streak (`GET /activities/stats`)
- [x] Profile screen + personal stats dashboard (+ Home dashboard: this-week, streak, records, active challenges, recent runs)
- [x] Deploy prep: Dockerfile, `render.yaml`, self-migrating binary, `DEPLOY.md` (verified locally; not yet deployed)
- [ ] Deploy Go API on Render, Postgres on Neon, Redis on Render — **action: accounts + deploy**
- [~] **MarathonMitra account integration** — shared-account auth refactor DONE (login verifies via MarathonMitra; no RunMitra passwords; user ids are MarathonMitra ObjectIds; dev stub built). Remaining: wire the real MarathonMitra `/auth/login` contract.
- [ ] **Finisher certificate** — auto-issued on challenge completion
- [ ] **MarathonMitra badge sync** — race registered on website → badge on app profile (read MarathonMitra `participation`)
- [ ] EAS dev build (unlocks background GPS + push notifications)
- [ ] Push notifications via Expo Notifications — challenge milestones, run reminders
- [ ] TestFlight / internal Android test track

### Phase 6 — Testing & V1 sign-off 🎯 THIS MONTH
- [ ] End-to-end: register on MM website → log in on app → join virtual run → complete → get badge
- [ ] GPS accuracy test across 3+ real outdoor runs
- [ ] Offline sync test: run without internet, verify auto-upload on reconnect
- [ ] Load test leaderboard with 50+ simulated users
- [ ] Fix all crashes, edge cases, empty states
- [ ] Internal beta: 20 real runners from existing MM WhatsApp groups

---

## V1 Feature Scope

### ✅ In V1
- GPS run tracking (foreground now; background after EAS build)
- Offline run recording with auto-sync
- Route map + elevation chart per run
- Run history with weekly summary
- Virtual challenge join + progress tracking (with per-run opt-out)
- Live leaderboard per challenge
- Finisher certificate on challenge completion
- User profile: total km, streak, personal records
- MarathonMitra badge sync (website race → app profile)
- Shared MarathonMitra account across website + app
- Push notifications for challenge milestones

### ❌ Not in V1 → V2 and beyond
- Social feed (follow runners, activity feed) — V2
- Running clubs and club leaderboards — V2
- Stories / run highlights — V2
- Coach profiles — V3
- Garmin / Apple Watch / Fitbit sync — V3
- Segments (fastest on a route) — V3
- Premium subscription / Stripe — post-V2

---

## Key API Endpoints

```
# Auth
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

# Activities
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/stats
GET    /api/v1/activities/:id
GET    /api/v1/activities/:id/geojson

# Challenges
GET    /api/v1/challenges
POST   /api/v1/challenges
GET    /api/v1/challenges/:id
POST   /api/v1/challenges/:id/join
GET    /api/v1/challenges/:id/leaderboard

# Users
GET    /api/v1/users/me

# Planned (Phase 5)
GET    /api/v1/users/me/badges       # MarathonMitra finisher badges
GET    /api/v1/challenges/:id/certificate
```

---

## Getting Started

### Prerequisites
- Go 1.22+
- Node.js 18+
- Docker (runs Postgres + Redis locally)
- Expo Go app on your iPhone (same Wi-Fi as your Mac)

### Backend setup
```bash
cd backend
cp .env.example .env        # DATABASE_URL, REDIS_URL, JWT secrets
docker compose up -d        # Postgres (5433) + Redis (6380)
make run                    # starts API on :8090 (auto-migrates on startup)
```

### Mobile setup
```bash
cd mobile
npm install
npx expo start              # scan QR with iPhone Camera → opens in Expo Go
```

---

## Environment Variables

```env
# backend/.env
# Local dev uses non-default ports to avoid clashes:
#   Postgres on 5433, Redis on 6380, API on 8090
DATABASE_URL=postgres://virtualrun:virtualrun@localhost:5433/virtualrun?sslmode=disable
REDIS_URL=redis://localhost:6380
JWT_SECRET=your-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here
PORT=8090
ENV=development
```

---

## Deployment (V1 — low cost)

| Service | Use | Cost |
|---|---|---|
| Render | Go API hosting | Free / $7 mo |
| Render Key Value | Redis leaderboard | Free |
| Neon | PostgreSQL + PostGIS | Free (0.5 GB) |
| Expo EAS | App builds + TestFlight | Free |

**Estimated monthly cost: $0–$7.** See `backend/DEPLOY.md` for the step-by-step guide. The API self-migrates on startup, so deploys never run against a stale schema.

---

## Post-V1 Roadmap

### V2 — Community (Month 2–3)
- Running clubs: home page, captain, club leaderboard
- Activity feed: see your club's runs
- Follow individual runners
- City-based leaderboards (Bangalore, Pune, Delhi…)
- Club challenges: club runs X km together

### V3 — Social & Scale (Month 4–6)
- Explore feed: public runs, top performers
- Stories / run highlights
- Coach profiles + connect
- Segment leaderboards (fastest on a route)
- Garmin / Apple Watch sync

---

## About

RunMitra is built under the **MarathonMitra** brand — India's running ecosystem platform.

- Website (event discovery + registration): [marathonmitra.com](https://marathonmitra.com)
- One shared account across website and app
- Race registered on website → finisher badge appears on RunMitra profile

Built with Go + React Native. AI pair-programmed with Claude.
