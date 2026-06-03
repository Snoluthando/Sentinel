# Sentinel — Cloud & Database Migration Guide

**Ongoing setup (one Supabase project, fresh DB):** see **`database/README.md`** and run **`scripts/bootstrap-supabase.ps1`**.

---

Your stack today depends on services that are going away:

| Component | Current | Used by |
|-----------|---------|---------|
| Database | PostgreSQL + PostGIS (via Supabase) | NestJS API, AI service, Next.js dashboard |
| Auth | Supabase Auth (`auth.users`) | `user_profiles`, RLS policies |
| Realtime | Supabase Realtime | Dashboard live map |
| API host | Railway (`sentinel-production.up.railway.app`) | Flutter app, RN app |
| Web host | Vercel (typical for Next.js) | Operator dashboard |
| AI service | Railway / Docker | Clustering + digests |

**Deadline:** late June — export data and cut over before shutdown.

---

## Recommended path (least code change)

Keep **Supabase as the database + auth** (new project on your own account), replace **Railway** with **Fly.io** or **Render**.

Why: Your backend, AI service, and dashboard already use `@supabase/supabase-js`. Rewriting auth and RLS would take weeks.

### Step 1 — Export data before shutdown

If you still have dashboard access to the old database:

```bash
# Option A: Supabase dashboard → Database → Backups (if available)

# Option B: pg_dump (connection string from old provider)
pg_dump "postgresql://USER:PASS@HOST:5432/postgres" \
  --schema=public \
  --no-owner \
  --no-acl \
  -f sentinel_backup.sql
```

Also export **Auth users** if on Supabase: Dashboard → Authentication → Users → export, or use Supabase CLI:

```bash
npx supabase login
npx supabase db dump --linked -f schema_and_data.sql
```

### Step 2 — New database (Supabase)

1. Create a project at [supabase.com](https://supabase.com) (use a **personal** account, not a school project that gets deleted).
2. Pick region closest to users (EU or check available regions for SA latency).
3. SQL Editor → paste and run `schema.sql` in order (or restore your dump).
4. Settings → API → copy:
   - Project URL → `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only, never in Flutter)

5. If you used `pg_dump` only for `public` schema, re-create auth users or run a one-time signup flow.

### Step 3 — New API host (replace Railway)

**Option A — Fly.io** (good Docker support, global regions)

```bash
cd backend
fly launch --name sentinel-api --region jnb   # Johannesburg if available, else cpt/lhr
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... JWT_SECRET=...
fly deploy
```

See `backend/fly.toml` in this repo.

**Option B — Render** (simpler UI, free tier)

- New **Web Service** → connect GitHub repo → root `backend`
- Build: `npm install && npm run build`
- Start: `npm run start` or `npx ts-node src/main.ts`
- Add all env vars from `.env.example`

**Option C — Google Cloud Run** (pay per use, scales to zero)

- Container from `backend/Dockerfile`, set env vars in console.

After deploy, note the new API URL, e.g. `https://sentinel-api.fly.dev`.

### Step 4 — Deploy AI service

Same platform as API (second Fly app or Render service):

```bash
cd ai-service
fly launch --name sentinel-ai
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... AI_SERVICE_API_KEY=...
fly deploy
```

Set `AI_SERVICE_URL` on the API service to this URL.

### Step 5 — Update environment variables

| Where | What to change |
|-------|----------------|
| `backend` / Fly / Render | All `SUPABASE_*`, `JWT_SECRET`, `AI_SERVICE_URL`, WhatsApp, Vonage |
| `ai-service` | `SUPABASE_*`, `ANTHROPIC_API_KEY`, `AI_SERVICE_API_KEY` |
| `frontend-web` (Vercel) | `NEXT_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `API_URL` if used |
| `hello_flutter` | `lib/config/api_config.dart` → `kSentinelApiBaseUrl` |
| React Native screens | `API_URL` in `ReportScreen.tsx` / `MapScreen.tsx` |

### Step 6 — Verify

```bash
curl "https://YOUR-API/incidents/nearby?lat=-26.0274&lng=28.0088&hours=48"
```

Flutter: run app, open map and submit a test report.

---

## Alternative path (no Supabase)

Use if you cannot use Supabase at all (policy, billing, etc.).

| Need | Replacement |
|------|-------------|
| Postgres + PostGIS | [Neon](https://neon.tech) + enable PostGIS, or **DigitalOcean Managed Postgres**, or **AWS RDS** |
| Auth | Implement phone OTP in NestJS + `users` table (remove `REFERENCES auth.users`) |
| Realtime | Use existing `realtime.gateway.ts` (Socket.IO) in dashboard instead of Supabase Realtime |
| Storage (photos/PDF) | Cloudflare R2 or AWS S3 |

This requires:

1. New `schema-standalone.sql` without `auth.uid()` RLS (use service role + API-only access).
2. Replace `SupabaseService` in backend with `pg` / Prisma / TypeORM.
3. Rewrite dashboard `createClient` to call REST API only.

Budget **2–3 weeks** for this path.

---

## Provider comparison (2026)

| Provider | Database | App hosting | Free tier | Notes |
|----------|----------|-------------|-----------|-------|
| **Supabase** | Postgres + Auth + Realtime | — | Yes | Best fit for current code |
| **Neon** | Serverless Postgres | — | Yes | PostGIS supported; no built-in auth |
| **Fly.io** | — | Docker/API | Limited free | `jnb` region for SA |
| **Render** | Managed Postgres optional | Docker/Node | Yes | Easy Railway replacement |
| **Vercel** | — | Next.js | Yes | Keep for dashboard |
| **Cloudflare** | D1 (no PostGIS) | Workers | Yes | Not ideal for geospatial |
| **Azure / AWS** | RDS / Flexible Server | App Service / ECS | Student credits | More setup |

---

## POPIA reminder

- Store production data in a region you document in your privacy policy.
- Do not commit `.env` or service role keys to git.
- `service_role` bypasses RLS — only use on server (NestJS, AI service).

---

## Checklist (before late June)

- [ ] Full database backup downloaded
- [ ] New Supabase (or Postgres) project created
- [ ] `schema.sql` applied or restore tested
- [ ] API deployed and `/incidents/nearby` returns data
- [ ] AI service health check OK
- [ ] Vercel env vars updated, dashboard loads map
- [ ] Flutter `api_config.dart` points to new API URL
- [ ] Old Railway / old DB credentials rotated or deleted

---

## Need help?

Tell us which path you chose (Supabase+Fly vs full Postgres migration) and whether you have a backup file — we can wire `fly.toml`, env templates, and Flutter API URL next.
