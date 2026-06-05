# RunMitra Architecture

How RunMitra is built, and how it integrates with the MarathonMitra platform.

> **Status:** Phases 1–4 complete and device-tested; Phase 5 (deploy + MarathonMitra integration) in progress. This document reflects the code as it exists today, plus the integration design that is still **to be decided** (see [§7](#7-marathonmitra-integration--to-decide)).

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT                                  │
│   ┌────────────────────────────────────────────────────┐     │
│   │  RunMitra Mobile App  (React Native + Expo, iOS)    │     │
│   │  • GPS recording  • Maps  • Challenges  • Profile   │     │
│   └───────────────────────┬────────────────────────────┘     │
└───────────────────────────┼──────────────────────────────────┘
                            │ HTTPS (JWT bearer)
┌───────────────────────────┼──────────────────────────────────┐
│                    RUNMITRA BACKEND (Go + Chi)                │
│   handler → service → repository  (per feature)              │
│   auth · activities · challenges · leaderboard · users      │
└───────┬───────────────────────────────────┬──────────────────┘
        │                                    │
┌───────┼──────────────┐          ┌──────────┼──────────────────┐
│  PostgreSQL+PostGIS   │          │         Redis              │
│  • users (RunMitra)   │          │  • leaderboard ZSETs       │
│  • activities (routes)│          │  (fast, rebuildable)       │
│  • challenges         │          └────────────────────────────┘
└───────────────────────┘
        ╎ (integration — to decide, §7)
┌───────╎──────────────────────────────────────────────────────┐
│  MARATHONMITRA PLATFORM (separate product, already live)      │
│  Next.js web + Express API + **MongoDB** + Redis             │
│  • users/accounts • events • participation (race registrations)│
└───────────────────────────────────────────────────────────────┘
```

**Key fact:** MarathonMitra is **Node/Express + MongoDB**. RunMitra is **Go + PostgreSQL/PostGIS**. They are two different database engines — see [§7](#7-marathonmitra-integration--to-decide) for how shared-account + badges actually work across that boundary.

---

## 2. Design Principles

1. **Layered backend**: every feature is `handler (HTTP) → service (business logic) → repository (SQL)`. Handlers never touch SQL; repositories never hold business rules. (Same discipline as MarathonMitra's controller/service/repository split.)
2. **Postgres is the source of truth; Redis is a disposable cache.** Leaderboards live in Redis for speed but rebuild from Postgres if lost.
3. **Small, named packages — no `utils` junk drawer.** Shared web helpers live in `httpx`; geo math in `pkg/geo`.
4. **Offline-first mobile**: a finished run is persisted locally *before* any upload, then synced.
5. **Self-contained deploys**: migrations are embedded in the binary and run on startup.
6. **Stateless API**: JWT-based; horizontally scalable (no server-side session state except the Redis leaderboard cache).

---

## 3. Backend Architecture (Go)

**Location:** `backend/` · **Stack:** Go 1.25, Chi router, pgx, go-redis, goose

### Module layout

```
backend/
├── cmd/api/main.go            # Entry point: config → DB → migrate → Redis → wire → serve
├── internal/
│   ├── auth/                  # Register/login, JWT access + rotating refresh tokens,
│   │                          #   bcrypt, RequireAuth middleware
│   ├── activities/            # Run recording, server-side stats, GeoJSON, /stats
│   ├── challenges/            # Challenge CRUD, join, progress, leaderboard read
│   ├── leaderboard/           # Redis sorted-set operations
│   ├── users/                 # Profile, batch display-name lookup
│   ├── database/              # pgx pool, Redis client, startup migrator
│   ├── httpx/                 # JSON encode/decode, error responses, request-context user id
│   └── config/                # Env-based typed config (fail-fast)
├── db/
│   ├── migrations.go          # go:embed of the SQL files (ships inside the binary)
│   └── migrations/*.sql       # goose migrations (extensions, users, activities, challenges…)
├── pkg/geo/                   # Pure helpers: EWKT LineString, elevation gain, duration
├── Dockerfile                 # Multi-stage → ~41 MB static image
├── render.yaml                # Render deploy blueprint
└── DEPLOY.md                  # Deploy walkthrough
```

### Request flow

```
HTTP request → Chi router → [RequireAuth middleware] → Handler → Service → Repository → Postgres/Redis
```

### Why these choices (vs. MarathonMitra's Node/Mongo)
| Concern | RunMitra | Why different |
|---|---|---|
| Language | Go | Strong concurrency + a single static binary for cheap deploys |
| DB | PostgreSQL + **PostGIS** | Geospatial routes/geodesic distance — the core of run tracking. Mongo's geo is weaker for this. |
| Leaderboard | Redis ZSET | O(log n) ranking without re-sorting |

---

## 4. Data Model (PostgreSQL)

```
users
  id (uuid, pk) · email (citext, unique) · password_hash · display_name · timestamps

refresh_tokens
  id · user_id → users · token_hash (sha256) · expires_at · revoked_at
  (rotation + theft detection)

activities                                   ← a recorded run
  id · user_id → users · started_at · ended_at · duration_s
  distance_m · avg_pace_s_per_km · elevation_gain_m
  route  geography(LineStringZ, 4326)         ← lat/lng/altitude path; GiST indexed

challenges
  id · creator_id → users · name · description
  target_distance_m · starts_at · ends_at

challenge_members                            ← who joined + durable progress
  (challenge_id, user_id) pk · progress_distance_m · joined_at
```

**Redis:** `leaderboard:challenge:<id>` → sorted set of `user_id → total_distance_m`.

---

## 5. Mobile Architecture (React Native + Expo)

**Location:** `mobile/` · **Stack:** Expo SDK 54, Expo Router, react-native-maps, expo-location, expo-secure-store, AsyncStorage

```
mobile/
├── app/                       # Expo Router (file = route)
│   ├── (auth)/                # login, register
│   ├── (tabs)/                # home (dashboard), challenges, profile
│   ├── activity/              # record (live HUD), [id] (detail + map + elevation)
│   └── challenge/             # [id] (detail + leaderboard), new (create)
├── components/                # StatCard, ProgressBar, ElevationChart
└── lib/                       # The shared "service" layer:
    ├── api.ts                 # fetch wrapper: base URL, JWT header, error parsing
    ├── auth.tsx               # AuthContext; tokens in SecureStore (Keychain)
    ├── activities.ts          # activities + stats API client
    ├── challenges.ts          # challenges API client
    ├── runQueue.ts            # OFFLINE QUEUE: persist-first, auto-sync (AsyncStorage)
    ├── useRunRecorder.ts      # GPS watch + timer + live distance
    ├── gpsFilter.ts           # noise filtering (accuracy gate, speed sanity, floor)
    ├── mapRegion.ts           # frame a route on the map
    └── format.ts / theme.ts   # display formatters + MarathonMitra-branded styles
```

**Principles:** screens render, `lib/` holds logic (the RN mirror of handler/service). Tokens are secrets → Keychain; runs are data → AsyncStorage. Auth state via React Context (no heavyweight store until needed).

---

## 6. Cross-Cutting Concerns

| Concern | How |
|---|---|
| **Auth** | JWT access (15 min) + DB-stored rotating refresh tokens (30 d). Bearer header. |
| **Offline** | Run saved locally first; queue flushes on finish, on Home focus, on app launch. |
| **GPS accuracy** | Per-fix accuracy gate, speed-sanity, noise floor vs. last *accepted* point. |
| **Migrations** | Embedded in binary; `goose.Up` on startup → deploys can't run a stale schema. |
| **Resilience** | Leaderboard self-heals from Postgres if Redis is empty. |
| **Config/secrets** | Env vars only; `.env` gitignored; platform injects prod secrets. |

---

## 7. MarathonMitra Integration — TO DECIDE

The V1 goal is **one shared MarathonMitra account** + **finisher badges** synced from website race registrations. But the two systems use **different databases** (Mongo vs. Postgres), so "literally share one DB" isn't possible. Here are the realistic options.

### The accounts problem
- MarathonMitra users live in **MongoDB**, passwords hashed by their Node backend.
- RunMitra currently has its **own** `users` table + bcrypt in Postgres.

**Options for shared login:**

| Option | How it works | Trade-offs |
|---|---|---|
| **A. RunMitra calls MarathonMitra's auth API** (recommended) | App sends email/password (or OAuth) to MarathonMitra's `/auth/login`. MM verifies and returns identity. RunMitra issues its *own* JWT for app use, keyed to the MM user id. | True single account. No password duplication. Needs MM to expose an auth/verify endpoint (you control the API — §3 of their doc). Must match MM's password-hash scheme only on *their* side. |
| **B. Token federation / SSO** | MM issues a token the app trusts (shared secret or JWKS); RunMitra validates it. | Cleanest long-term; more upfront work (token exchange, key rotation). |
| **C. Mirror users into Postgres** | Sync MM users → RunMitra `users` on first login. | Duplicate data, sync drift, password-hash mismatch risk. **Not recommended.** |

### The badges/certificates problem
Race registrations live in MarathonMitra's **`participation`** collection (MongoDB). To show a finisher badge on the RunMitra profile, RunMitra must **read** that — via an MM API endpoint (e.g. `GET /users/:id/participations`), **not** by touching their database directly.

### Proposed integration shape (pending your confirmation)
```
RunMitra app
   │  login (email/pw or OAuth)
   ▼
RunMitra API ──HTTPS──► MarathonMitra API  (verify identity, fetch race participations)
   │  issues RunMitra JWT (keyed to MM user_id)
   ▼
Postgres: RunMitra owns activities/challenges, keyed by MM user_id
          (no RunMitra-owned passwords; MM is the identity source)
```

**Open questions for you:**
1. Does MarathonMitra expose (or can we add) an **auth/verify endpoint** the app can call? (Their doc shows `POST /auth/login`, `GET /auth/me` — likely yes.)
2. Login method: **email/password**, **Google OAuth**, or **phone/OTP**? (Their doc mentions Google/Facebook OAuth + email magic-link.)
3. Is the MM user id a Mongo **ObjectId** (string)? RunMitra's `user_id` columns are currently `uuid` — we'd switch them to `text` to hold an ObjectId.
4. For badges: what identifies a "finisher" in `participation` (a status field? a result?), and can we read it via an API?

Once these are answered, the migration is modest: drop RunMitra's own auth/passwords, key everything on the MM user id, and add a thin MarathonMitra API client on the Go side.

---

## 8. Deployment

| Service | Host | Notes |
|---|---|---|
| RunMitra API | Render (Docker) | Self-migrating; `/api/v1/health` health check |
| Postgres + PostGIS | Neon | Supports postgis + citext (verified) |
| Redis | Render Key Value | Free; non-persistent OK (leaderboard self-heals) |
| Mobile builds | Expo EAS | Dev build needed for background GPS + push |

See `backend/DEPLOY.md`. The MarathonMitra platform deploys separately (their own Docker/K8s + MongoDB).

---

*Last updated: 2026-06 · reflects code through Phase 4; Phase 5 integration design pending.*
