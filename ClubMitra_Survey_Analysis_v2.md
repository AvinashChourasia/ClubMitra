# ClubMitra — Community Survey Analysis (v2)

> **Source:** 206 responses collected June 2026 — **20 club admins, 83 club
> members, 103 solo runners.** This document consolidates the findings that
> drive the Priority Board in `README.md`. Figures here are the survey's own;
> if a fuller raw-data analysis exists, drop it in and it supersedes this summary.

---

## The headline finding (it reframes the whole roadmap)

**68% of runners will not switch their recording app.** Only **13%** would
record a run directly in ClubMitra. The rest live in **Strava (81%)** and
**Garmin (14%)** and expect those runs to **count automatically**.

We built challenges as **GPS-native only** (record-in-app or GPX import) — which
silently excludes roughly two-thirds of the market from the hero feature
(challenges + leaderboards). **Automatic Strava/Garmin sync is the #1 gap and
the top build priority.** Until it ships, leaderboards stay empty for most
members and the product's core loop doesn't turn.

---

## What club admins actually want (n=20)

Ranked from the survey:

1. **Challenges + leaderboards** — the #1 ask. ✅ shipped.
2. **Race & event calendar** — #2. ✅ shipped (MarathonMitra-fed).
3. **Attendance + self check-in** — top-5. ✅ shipped.
4. **Inventory tracking** — top-6, a genuine differentiator. ✅ shipped.
5. **Inactive-member alerts** — named *unprompted* by **12/20** admins. Analytics
   are built; surface them more prominently to admins.
6. **Membership-fee collection** — admin's **last** priority (4/20), and **75% of
   clubs charge no fee at all.**

### Two admin myths the data kills
- **"Save 10–15 hours a week" is false.** **14/20 admins spend under 5 hrs/week**
  on club admin. The pitch should be **"keep members running together"**, not
  time-saving.
- **Membership-fee transaction cuts are a weak revenue base.** 75% of clubs are
  free and admins rank fees last. Lead revenue with **freemium subscriptions +
  event-registration cuts**; treat membership-fee cuts as a long-tail stream.

---

## What runners want (members n=83, solo n=103)

- **Auto-sync from Strava/Garmin** — mandatory (see headline). Without it, runners
  won't re-record their runs just to join a club challenge.
- **Streaks** rank as the **#3 motivator** — validated; streaks + badges + XP are
  shipped.
- **Privacy sensitivity:** runners explicitly *"don't want to give permissions to
  too many apps."* Sync must be **read-only, per-provider, explicit consent, and
  one-tap disconnect.**
- **Messaging:** "keep it simple." Chat is already over-built relative to demand —
  freeze further depth (no in-thread search / voice waveforms for now).

---

## Effort vs demand mismatch (the honest retro)

The initial build sprint went deep on **WhatsApp-grade chat** and **in-app GPS
recording** — both ranked **low** by the market — while the one capability the
market made **mandatory** (Strava/Garmin sync) was deliberately removed when the
manual-proof flow was retired. The roadmap is now reordered around that reality.

---

## Recommended build order (survey-driven)

1. **P0 — Activity Sync:** Strava OAuth (read-only) + Garmin import, crediting
   the existing run pipeline (challenges, boards, badges). Ship before soft
   launch. Bridge with a Strava/Garmin → GPX export guide + share-sheet intake.
2. **P1 — Live pilot challenge:** run a MarathonMitra 100K with the **130+ runner
   leads** from this survey — convert respondents into active users immediately.
3. **P1 — Reposition the pitch** to "keep members running together"; **P1 — real
   payments** (Razorpay Route) for the freemium + event-fee model; **P1 —
   RunMitra → ClubMitra rename + store readiness.**
4. **P2** — surface inactive-member alerts; event-registration fees.
5. **De-prioritised / frozen** — membership-fee polish; deeper messaging.

> Full task table with status tags lives in the **Priority Board** at the top of
> `README.md`; subsystem design for sync is in `ARCHITECTURE.md` → *Activity
> Sync — Strava + Garmin*.
