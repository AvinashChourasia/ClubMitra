# ClubMitra

A running club operating system for endurance communities. Member management,
attendance, challenges, payments, inventory, finances, messaging, and GPS run
tracking — built for running clubs of every size.

> **Primary customer: Running clubs.** Free for runners. Clubs pay for features.
> **A MarathonMitra product.** Standalone — separate backend, separate database, no shared auth.
> **Market:** India first (Razorpay + INR). Global-ready from day one; Europe expansion Month 7+ (Stripe + EUR/USD).

---

## What ClubMitra Solves

Running clubs today run on WhatsApp + spreadsheets + UPI screenshots. ClubMitra
replaces that stack with:

- One place to manage all club members, attendance, fees, and inventory
- Challenges with leaderboards — public, chapter, city-wide, org-wide, and rolling daily/weekly/monthly
- GPS-verified activity — recorded runs credit challenges and leaderboards automatically
- Private group messaging — per-club, per-event chats replacing WhatsApp (Phase 2)
- In-app payment collection with automatic platform split — Razorpay Route in India, Stripe Connect globally (Phase 3)
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
| Payments (India) | Razorpay + Razorpay Route | INR collections + automatic platform split (Phase 3) |
| Payments (Global) | Stripe + Stripe Connect | EUR/USD collections + automatic platform split (Phase 3) |
| File Storage | Cloudinary | Profile photos, club logos, GPX previews |
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

Epeak-aligned for competitive parity in Europe. Prices shown in INR (India) and
EUR (Global). India pricing is value-adjusted, not a direct FX conversion.
Annual billing = 20% off.

| Plan | Members | Admins | Key Features | India (INR) | Global (EUR) |
|---|---|---|---|---|---|
| Free | Up to 20 | 1 | Club core, schedule, messaging, 2 challenges/mo | ₹0 | €0 |
| Team | Up to 50 | 2 | Full challenge engine, rolling leaderboards, training plans | ₹749/mo | €9/mo |
| Club | Up to 300 | 10 | + Group management, desktop access, drop-off analytics | ₹2,499/mo | €34/mo |
| Club+ | 300+ | Unlimited | Unlimited members (+₹800/100), extra admins (+₹400) | ₹2,499 base | €34 base |
| Enterprise | Custom | Custom | White-label, custom scoring, dedicated support, SLA | Custom | Custom |

All money flows through **Razorpay Route** (India) or **Stripe Connect** (Global)
— automatic split at transaction time. No manual settlements. No compliance risk.

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
│   │   ├── users/             # Profiles, stats, aggregates, search
│   │   ├── organisations/     # Org + chapter + roles + membership
│   │   ├── permissions/       # Role-based access control middleware
│   │   ├── members/           # Member lifecycle, status, invites      [Phase 2]
│   │   ├── attendance/        # Run scheduling, post-run check-in
│   │   ├── challenges/        # Challenge engine, visibility rules, proof
│   │   ├── leaderboard/       # Redis sorted sets — challenge + rolling
│   │   ├── activities/        # GPS runs: record, stats, routes        [Phase 4]
│   │   ├── inventory/         # Items, stock, issue/return            [Phase 2]
│   │   ├── messaging/         # Club + event chats, announcements      [Phase 2]
│   │   ├── analytics/         # Drop-off metrics, engagement dashboard  [Phase 2]
│   │   ├── finance/           # Transactions, platform cut, settlements [Phase 3]
│   │   ├── payments/          # Routes to pkg/payments provider        [Phase 3]
│   │   ├── schedule/          # Training plan builder, pace groups      [Phase 3]
│   │   ├── racecalendar/      # Race discovery, external events         [Phase 4]
│   │   ├── badges/            # Milestones, achievement engine          [Phase 5]
│   │   └── notifications/     # Push notification service
│   ├── db/
│   │   └── migrations/        # goose SQL migrations
│   ├── pkg/
│   │   ├── geo/               # PostGIS helpers (Phase 4)
│   │   ├── payments/          # Provider-agnostic interface            [Phase 3]
│   │   │   ├── razorpay/      #   India — Razorpay + Route
│   │   │   └── stripe/        #   Global — Stripe + Connect
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
│   │   ├── profile/           # edit (achievements → Phase 5)
│   │   ├── schedule.tsx       # personal + club run schedule
│   │   └── activity/          # GPS run screens (Phase 4)
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

> **Scope philosophy:** order by dependency, not feature area. Phase 2 is
> self-contained backend + in-app messaging — no external setup, builds today.
> Real payments wait for Phase 3 because they're gated by merchant KYC (Razorpay
> Route in India, Stripe Connect globally) — start that paperwork in parallel so
> Phase 3 isn't blocked. GPS tracking and the race calendar follow in Phase 4.

### Phase 1 — Club Core ✅ COMPLETE

**Goal: A club admin can create their club, add members, schedule runs, and run challenges.**

> **Phase 1 status — backend + mobile both built and working end-to-end:**
> Standalone auth (register + login, bcrypt, JWT + refresh rotation/theft
> detection); full runner profile (view/edit, running level, searchable city,
> profile photo, club logo + banner via Cloudinary); club core (organisations, chapters, invite codes,
> org_roles permissions, invite-first join, member management with status +
> soft-delete); attendance (recurring run scheduling, optional time, edit,
> check-in/out with reason, personal + club schedule with weekly list + month
> calendar); visibility-aware challenge engine (typed goals, scoping,
> individual/club join with date-gated join/leave, manual proof + admin verify,
> Redis leaderboard); light/dark mode; Inter brand font; push notification
> infrastructure.
>
> **Built ahead of schedule (Phase 3 structure, MOCK payments):** optional
> membership fees + subscriptions (monthly/annual + renewal), club join-approval
> layer, and challenge join fees — all wired with a MOCK payment step. Real money
> movement (Razorpay/Stripe, platform cut, transactions table) is Phase 3.

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
- [x] Photo picker (Cloudinary upload), searchable city picker, calendar + time pickers, recurring run UI

---

### Phase 2 — Leaderboards + Analytics + Inventory + Messaging `(Month 2)` ✅ COMPLETE

> Self-contained work with no external setup — builds immediately. Real payments
> moved to Phase 3 (gated by Razorpay/Stripe merchant KYC). Start the merchant
> account + KYC paperwork now, in parallel, so Phase 3 isn't blocked.

#### Rolling Leaderboards — built ahead (Postgres-computed from run logs)
- [x] Members log a run (km) → `run_logs`, the data source for the boards
- [x] Daily / weekly / monthly / all-time boards per chapter (IST), in the club screen
- [x] Boards live at chapter level, independent of specific challenges
- [ ] _(Deferred)_ Redis sorted-set + Lua ZINCRBY — Postgres aggregation is fine at current scale; revisit if it gets slow

#### Trust Score — REMOVED (June 2026)
> Built in Phase 2, retired once GPS verification shipped: recorded runs are
> self-verifying, so a separate credibility score added complexity without
> value. Backend package, profile endpoint, and user columns dropped
> (migration 00027). Proof-method evidence weighting (manual .70 → gpx 1.10)
> survives inside challenges — that's proof math, not trust scoring.

#### Analytics — Drop-off Dashboard
- [x] Members with no activity in 7 / 14 / 30 / 60 days — visible to chapter admin
- [x] Weekly engagement rate: % of members who logged at least one activity
- [x] Activity volume trend: total km logged per week across the club
- [ ] Analytics cache table — refreshed every 6 hours (computed live for now; cheap at this scale)

#### Extended Member Lifecycle
- [x] On Leave status: self-declared (members/me/status), paused from leaderboards
- [x] Injured status (admin-set): removed from the leaderboard
- [x] Alumni status (admin-set): departed member, excluded from the leaderboard

#### Inventory
- [x] Inventory CRUD: item name, category, quantity, size breakdown (JSONB)
- [x] Inventory issue / return / restock flow with atomic stock tracking
- [x] Inventory dashboard: stock levels (mobile manage screen) + transaction history (API)
- [ ] _(Paid purchase + platform cut depends on payments → Phase 3)_

#### Messaging — upgraded to WhatsApp-grade (June 2026)
- [x] Club-wide group chat (one per chapter) + 1:1 direct messages
- [x] Event chat (one per run, members of the chapter)
- [x] Club-wide announcement broadcast (push; email via SendGrid → Phase 3)
- [x] **Realtime delivery + typing indicators** (WebSocket hub, poll fallback)
- [x] Inbox: pinned club chats, unread badges (+ tab badge), "You:" previews, search
- [x] Swipe actions: mute (silences badges) + archive (collapsed section)
- [x] Photo / camera / document attachments, fullscreen viewer
- [x] **Voice notes** (record → upload → in-bubble player) — needs APK rebuild (expo-audio)
- [x] Reactions (one per person, live), reply-quoting (+ tap-quote-to-jump), edit, delete
- [x] Forward to any conversation; WhatsApp-style long-press overlay menu
- [x] Per-message info: "Read by X of Y" with reader times (sender-only)
- [x] Read receipts: sent ✓ → read ✓✓ (sky blue); WhatsApp bubble palette + wallpaper
- [ ] Push notifications for new chat messages (announcements already push)
- [ ] Message search inside a conversation; voice-note waveforms
- [ ] _(Desktop admin web panel → Phase 3)_

#### 🧪 Chat test checklist — ✅ verified on two accounts (June 12, 2026)
- [x] Realtime: send from device A → lands on B instantly (no refresh)
- [x] Typing: type on A → B's thread header + chat-list row show "typing…"
- [x] Inbox: clubs pinned on top, unread badge counts, "You:" prefix, search filters
- [x] Tab badge: unread total on the Chat tab; clears after reading
- [x] Swipe a row → Mute (badge goes grey + tab total drops) and Archive (bottom section)
- [x] Long-press a message → overlay: emoji pill above, menu below (spring + haptic)
- [x] React from the pill → chip appears live on both devices; tap chip to clear
- [x] Swipe a message right → reply bar arms; send → quote block; tap quote → jumps + flashes
- [x] Edit your own message → "edited" label on both sides
- [x] Forward a message (text + a photo) to another conversation
- [x] Voice note: mic → record (timer) → send → playable bubble both sides; "🎤 Voice note" preview
- [x] Message info (long-press your msg → Info): "Read by X of Y" updates after B opens the chat
- [x] Delete for everyone; scroll up while B sends → jump-FAB with count (no yank)
- [x] Attachments: photo library, camera, document; staged preview + caption

#### Cleanup
- [ ] ClubMitra rename (Go module, DB name, env vars, ports) — see naming note

---

### Phase 3 — Payments + GPX + Desktop Admin `(Month 3)`

> Real money on both rails — gated by merchant onboarding (Razorpay Route KYC in
> India, Stripe Connect onboarding globally), so the account setup should already
> be underway from Phase 2. Plus the remaining Epeak-parity surface.

#### Payments — Real money (provider-agnostic, replaces MOCK)
- [ ] `pkg/payments/` — provider-agnostic interface (Provider)
- [ ] Razorpay Route (India): KYC flow, order creation, webhook, auto-split
- [ ] Stripe Connect (Global): Express onboarding, payment intent, webhook, auto-split
- [ ] Currency detection: INR → Razorpay, EUR/USD → Stripe (set on chapter)
- [ ] Platform cut calculated and stored at transaction time — never derived later
- [x] 🟡 Membership fee toggle per chapter (on/off, amount, monthly/annual) — MOCK
- [x] 🟡 In-app payment: runner pays chapter membership fee — MOCK
- [x] 🟡 Challenge join fee — MOCK payment to join, date-gated
- [ ] Replace MOCK membership fee with real Razorpay/Stripe flow
- [ ] Replace MOCK challenge join fee with real flow
- [ ] Subscription tier enforcement (Free/Team/Club/Club+/Enterprise) — gate features + member count
- [ ] Transaction history: per runner, per chapter, per org
- [ ] Finance dashboard for chapter admin: collected, pending, platform cut
- [ ] Discount codes: fixed or % off, single-use or multi-use
- [ ] Paid inventory purchases + platform cut (builds on Phase 2 inventory)

#### GPX + Navigation
- [ ] GPX file upload on any run / community event (attaches to `runs`)
- [ ] Auto-generate route map + elevation profile from GPX (Cloudinary)
- [ ] Deep-link to Waze / Google Maps / Apple Maps for meeting-point navigation
- [ ] GPX download for Garmin / Polar / Suunto sync

#### Desktop Admin
- [ ] Web admin panel at admin.clubmitra.in (manage members, finances, runs)

#### Training Sessions *(extend `runs` in place — no schema refactor)*
- [ ] Add training-session fields to runs: sport type, workout summary, duration
- [ ] Pace / training groups per run (e.g. 5:00/km, 6:00/km)
- [ ] PDF upload per session (e.g. strength training visuals)
- [ ] Run RSVP: member taps Join or Decline

#### Join Flows
- [ ] Club rules: admin sets rules text → member must accept on join
- [ ] Waitlist: auto-promote when capacity opens up
- [ ] Scheduled registration open: set a future date/time for registration to open
- [ ] Bulk invite: admin uploads CSV of emails → auto-sends invitations

---

### Phase 4 — GPS Tracking + Race Calendar `(Month 4)`

- [x] GPS run recording: live route, distance, pace, elevation
- [x] Offline run recording with auto-sync
- [x] Server-side stats via PostGIS (geodesic distance, elevation gain)
- [x] Interactive map (Apple Maps) — dark style, satellite toggle, recenter
- [x] Pace-coloured route + per-km split markers + tappable splits
- [x] Route map + elevation chart per activity
- [x] Animated route replay (retrace the run)
- [x] Auto-pause detection (moving vs elapsed time)
- [x] Run history + all-time stats (runs, distance, time, streak)
- [x] GPX file import from any GPS device (Garmin, Polar, Suunto)
- [x] Runs auto-credit to active challenges (replaces manual Strava proof)
- [x] Runs auto-credit to rolling leaderboards
- [x] Personal stats: total km, streak, personal records
- [x] Activity feed per chapter (club page Feed tab)
- [x] Streak freeze: 2 per month, auto-applied to bridge missed days
- [x] Background GPS (requires EAS dev build)
- [x] City leaderboard: all verified runners in a city ranked collectively
- [x] Race calendar: community-listed races by city, "I'm going", add to phone/Google calendar
- [ ] Race calendar map view (interactive, search by location)
- [ ] Similar races list / race recommendations
- [ ] Calendar embed widget for club websites

---

### Phase 5 — Social + Badges + Growth `(Month 5)`

- [ ] Public explore: discover clubs and challenges by city and sport
- [ ] Club public profile page (discoverability for non-members)
- [ ] Global club directory (searchable)
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
- [ ] Polls: admin creates quick polls for club members

---

### Phase 6+ — Scale + Europe Launch `(Month 7+, post soft-launch feedback)`

- [ ] Europe go-live: Stripe Connect production, EUR pricing, EU data residency
- [ ] GDPR: right-to-erasure export (soft delete already in place)
- [ ] Multi-language support (i18n on mobile)
- [ ] League system between clubs (needs 50+ clubs first)
- [ ] Coach role + training plan marketplace
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
POST   /api/v1/chapters/:id/pay               # pay/renew membership fee (MOCK — real Phase 2)

# Attendance (runs — unified into sessions in Phase 3)
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

# ─── Phase 2 (planned) ────────────────────────────────────────────
# Rolling leaderboards
GET    /api/v1/chapters/:id/leaderboard/daily
GET    /api/v1/chapters/:id/leaderboard/weekly
GET    /api/v1/chapters/:id/leaderboard/monthly
GET    /api/v1/chapters/:id/leaderboard/alltime

# Analytics
GET    /api/v1/chapters/:id/analytics/dropoff
GET    /api/v1/chapters/:id/analytics/engagement
GET    /api/v1/chapters/:id/analytics/activity-volume

# Inventory (CRUD — paid purchase is Phase 3)
GET    /api/v1/chapters/:id/inventory
POST   /api/v1/chapters/:id/inventory
PUT    /api/v1/inventory/:id
POST   /api/v1/inventory/:id/issue
POST   /api/v1/inventory/:id/return

# Messaging
GET    /api/v1/chapters/:id/messages
POST   /api/v1/chapters/:id/messages
GET    /api/v1/runs/:id/messages              # per-run event chat
POST   /api/v1/runs/:id/messages
POST   /api/v1/chapters/:id/announce          # broadcast push (+ email)

# ─── Phase 3 (planned) ────────────────────────────────────────────
# Payments — provider-aware (Razorpay INR / Stripe EUR-USD)
POST   /api/v1/payments/initiate
POST   /api/v1/payments/razorpay/webhook
POST   /api/v1/payments/stripe/webhook
GET    /api/v1/chapters/:id/finance/summary
GET    /api/v1/chapters/:id/transactions
POST   /api/v1/inventory/:id/purchase         # paid purchase + platform cut

# GPX (attaches to runs)
POST   /api/v1/runs/:id/gpx                   # upload GPX
GET    /api/v1/runs/:id/gpx

# ─── Phase 4 (planned) ────────────────────────────────────────────
# Activities — GPS
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/:id
GET    /api/v1/activities/:id/geojson
POST   /api/v1/activities/gpx
GET    /api/v1/city/:city/leaderboard         # city-wide

# Race Calendar
GET    /api/v1/races?city=:city&type=:type
GET    /api/v1/races/:id
GET    /api/v1/races/similar/:id
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
| Create session / event | ✅ | ✅ | ✅ | ✅ | ❌ |
| Verify activity proof | ✅ | ✅ | ✅ | ✅ | ❌ |
| Send announcements | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage inventory | ✅ | ✅ | ✅ | ✅ | ❌ |
| View finances | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage billing / subscription | ✅ | ✅ | ❌ | ❌ | ❌ |
| View drop-off analytics | ✅ | ✅ | ✅ | ❌ | ❌ |
| Hard delete anything | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Core Design Rules

1. **Soft delete everywhere** — every table has `deleted_at`. No org or admin can permanently delete data. Platform admin only, for legal/compliance.
2. **One transaction table** — every money movement goes through `transactions`. Platform cut stored at transaction time, never derived later.
3. **Provider-agnostic payments** — all payment logic goes through the `pkg/payments/` interface. Razorpay for INR, Stripe for EUR/USD. Currency detected at payment initiation. Every club collecting money must complete provider KYC before enabling fees.
4. **No manual settlements** — Razorpay Route (India) or Stripe Connect (Global) auto-split every transaction.
5. **Invite-first onboarding** — each chapter gets a unique invite link. Runner clicks → signs up with full profile → auto-joins chapter.
6. **GPS-first activity validation** — recorded runs are the credible source: they credit challenges and every active club's leaderboard automatically. Manual proof (with per-method evidence weights) remains only for challenge submissions.
7. **Redis leaderboard** — self-heals from Postgres. Sorted sets per challenge AND per rolling period (daily/weekly/monthly/all-time).
8. **Global-ready from day one** — multi-currency pricing, provider-agnostic payments, country + timezone-aware chapters. India first, Europe Month 7+.
9. **Standalone** — ClubMitra owns identity. No external auth dependency, no shared DB, no linked accounts required with MarathonMitra.
10. **Quality over quantity** — every new feature must justify itself: does this help a club admin save time or a runner stay engaged?

---

## Getting Started

### Prerequisites

- Go 1.22+
- Node.js 18+
- PostgreSQL 15+ with PostGIS
- Redis (local or Upstash)
- Expo CLI: `npm install -g expo`
- Razorpay account with Route enabled (Phase 3, India)
- Stripe account with Connect enabled (Phase 3, Global)

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

# Storage
CLOUDINARY_URL=cloudinary://your-cloudinary-url

# Email — Phase 2 (announcement broadcasts)
SENDGRID_API_KEY=SG.xxxxx
EMAIL_FROM=noreply@clubmitra.in

# Payments — Phase 3
# India
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret
# Global
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_CONNECT_CLIENT_ID=ca_xxxxx
# Shared
PLATFORM_CUT_PCT=10
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
| SendGrid | Email (Phase 2) | Free (100/day) |

**Estimated monthly cost at launch: $0–$7**

---

## Roadmap Summary

| Phase | Focus | Timeline |
|---|---|---|
| 1 | Club core — members, attendance, challenges | Month 1 ✅ |
| 2 | Rolling leaderboards, analytics, inventory, messaging | Month 2 ✅ |
| 3 | Payments (Razorpay + Stripe), GPX, desktop admin, paid inventory | Month 3 |
| 4 | GPS tracking, interactive maps, race calendar, city leaderboard | Month 4 🚧 |
| 5 | Social, badges, XP, achievements, public profiles, global directory | Month 5 |
| 6+ | Europe launch, leagues, coaches, physical events, white-label | Month 7+ |

**Target:** India soft launch end of Month 2. Europe expansion Month 7+.




<!-- # JS / styles / logic / new screens / bug fixes  → OTA, ~20s, no rebuild:
npx eas-cli update --branch preview -m "what changed"
#   testers get it on next app open

# native/config only (app.json perms/plugins/icon, new native lib, SDK bump):
npx eas-cli build -p android --profile preview -->
