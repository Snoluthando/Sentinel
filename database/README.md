# Sentinel database (Supabase)

The database schema lives in **`../schema.sql`**. That file is the single source of truth.

You should **not** need a new Supabase project often if you follow the stability rules below. When you do (rare), use **`../scripts/bootstrap-supabase.ps1`** — about 10 minutes, no code changes.

---

## Keep one project long-term

| Do | Why |
|----|-----|
| Create Supabase under **your personal email**, not a university org | School projects get deleted on schedule |
| Name the project e.g. `sentinel-prod` and **never delete it** | Same URL/keys forever |
| Store keys only in `.env` (gitignored) | Safe rotation without repo churn |
| Run **`scripts/backup-database.ps1`** monthly (or before any infra change) | 5-minute recovery if something breaks |
| Consider **Supabase Pro** (~$25/mo) when you go public | No pause/delete on inactivity; daily backups |

| Avoid | Why |
|-------|-----|
| “Class project” or shared team org you don’t control | Shutdown notices |
| Relying on free-tier paused projects | Can look like “DB died” |
| Re-creating DB to “fix” app bugs | Fix API/env first; DB is rarely the issue |

---

## Fresh database (first time or disaster recovery)

### Option A — SQL Editor (no CLI)

1. [supabase.com](https://supabase.com) → **New project** → pick region → strong DB password (save in a password manager).
2. SQL Editor → paste entire **`schema.sql`** → **Run**.
3. Run **`scripts/bootstrap-supabase.ps1`** to write `.env` and print a checklist.

### Option B — Supabase CLI (repeatable)

```powershell
cd files
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Migrations are in **`../supabase/migrations/`** (generated from `schema.sql`).

---

## What lives in Supabase vs your machine

| In Supabase (cloud) | In this repo (never lost) |
|---------------------|---------------------------|
| Rows (incidents, users, …) | `schema.sql` |
| Auth users | App code + env template |
| API keys | `.env.example` |

If the cloud project is deleted, you lose **data** but not **structure**. Restore structure with `schema.sql`; users re-register; incidents start empty (fine for MVP).

---

## Local dev without touching cloud

Use Docker Postgres for day-to-day dev; point API at Supabase only for staging/prod:

```powershell
docker compose -f docker-compose.dev-db.yml up -d
```

(See `docker-compose.dev-db.yml` — optional local PostGIS.)

For most MVP work, one personal Supabase free project is enough if you don’t delete it.
