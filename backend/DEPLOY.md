# Deploying the backend

This walks you through putting the API on the internet: **Postgres on Neon**,
**Redis on Render**, **Go API on Render**. All three have free tiers. Total
cost: $0 (with free-tier limits).

The app is deploy-ready: it **self-migrates on startup** (no manual migration
step) and reads all config from environment variables. We verified the Docker
image builds and runs. The only things left are account signups + pasting a few
values — that's what this guide covers.

---

## Architecture (what goes where)

```
   iPhone (Expo app)
        |  HTTPS
        v
   Render Web Service  ──────►  Neon (Postgres + PostGIS)   ← source of truth
   (Go API, Docker)    ──────►  Render Key Value (Redis)     ← leaderboard cache
```

---

## Prerequisites

- A **GitHub account** with this project pushed to a repo (Render deploys from
  GitHub). If it isn't on GitHub yet, do that first.
- That's it — Neon and Render both sign in with GitHub.

---

## Step 1 — Database on Neon

1. Go to https://neon.com and sign up (use "Continue with GitHub").
2. **Create a project** — pick a region close to you (e.g. AWS ap-south-1 for
   India). Name it `virtualrun`.
3. Neon shows a **connection string** like:
   ```
   postgres://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
   Copy it. **Keep `sslmode=require`** — Neon requires TLS. Save this as your
   production `DATABASE_URL`.
4. Enable PostGIS once: in Neon's **SQL Editor**, run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS citext;
   ```
   (Our migrations also run these, but doing it here first avoids any
   permission edge cases — harmless to run twice.)

> The app's migrations create all tables automatically on first deploy. You do
> NOT need to run anything else against Neon.

---

## Step 2 — Push to GitHub (if not already)

From the project root:
```bash
git init                 # if not a repo yet
git add .
git commit -m "Virtual Run Tracker"
# create a repo on github.com, then:
git remote add origin https://github.com/<you>/virtual-run-tracker.git
git push -u origin main
```

---

## Step 3 — Redis on Render (Key Value)

1. Go to https://render.com, sign up with GitHub.
2. **New > Key Value**. Name it `virtualrun-redis`, region same as your API,
   plan **Free**. Create it.
3. Open it and copy the **Internal Connection URL** (`redis://...`). Save it as
   your production `REDIS_URL`.

> Free Key Value doesn't persist to disk — that's fine here. If it's ever
> cleared, each challenge leaderboard rebuilds itself from Postgres on the next
> read (we built and tested this).

---

## Step 4 — API on Render

Two ways; the manual one is simplest to understand.

### Option A — Manual (recommended first time)
1. **New > Web Service** → connect your GitHub repo.
2. Settings:
   - **Root Directory**: `backend`
   - **Runtime/Language**: `Docker` (Render auto-detects the Dockerfile)
   - **Plan**: Free
   - **Health Check Path**: `/api/v1/health`
3. **Environment** → add these variables:
   | Key | Value |
   |---|---|
   | `ENV` | `production` |
   | `DATABASE_URL` | the Neon string from Step 1 (with `sslmode=require`) |
   | `REDIS_URL` | the Render Key Value internal URL from Step 3 |
   | `JWT_SECRET` | run `openssl rand -base64 32` and paste the output |
   | `JWT_REFRESH_SECRET` | run `openssl rand -base64 32` again (different value) |
4. **Create Web Service**. Render builds the Docker image and deploys.

### Option B — Blueprint
Point Render at `backend/render.yaml` (New > Blueprint). It defines the service
and generates the JWT secrets; you still paste `DATABASE_URL` and `REDIS_URL`.

---

## Step 5 — Verify

When the deploy finishes, Render gives you a URL like
`https://virtualrun-api.onrender.com`. Check it:
```bash
curl https://virtualrun-api.onrender.com/api/v1/health
# => {"status":"ok"}
```
In the Render logs you should see:
```
connected to database
migrations up to date          ← self-migration ran
connected to redis
API listening on ...
```

---

## Step 6 — Point the mobile app at production

In `mobile/lib/api.ts`, `resolveBaseUrl()` currently derives the LAN IP for
local dev. For a production build, set the base URL to your Render URL. The
clean way (done later with the EAS build) is an env/config value; for a quick
test you can temporarily hardcode:
```ts
return "https://virtualrun-api.onrender.com/api/v1";
```

---

## Notes & gotchas

- **Free Render web services sleep after ~15 min idle** and cold-start on the
  next request (a few seconds). Fine for testing; upgrade to paid ($7/mo) to
  keep it warm.
- **Neon free tier** auto-suspends the DB when idle too; first query after idle
  has a small delay.
- **Secrets**: never commit real `DATABASE_URL`/secrets. They live only in
  Render's env settings. Our `.env` is gitignored.
- **Migrations**: adding a new `db/migrations/NNNN_*.sql` and deploying is all
  it takes — the app applies it on the next startup.
- **Local `docker build` flakiness**: on some networks `go mod download` inside
  Docker fails intermittently with `tls: bad record MAC`. That's a local
  network/proxy quirk, not a code issue — Render's build servers are unaffected.
  If you hit it locally, retry, or `go mod vendor` + build with `-mod=vendor`.
