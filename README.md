# 🚔 CrimeNet SA — Developer Guide

**Community Crime Intelligence Network**  
*Johannesburg, South Africa · February 2026*

---

## What This Repository Contains

This is the full implementation of CrimeNet SA, a real-time AI-powered community crime intelligence platform. Below is a guide to every file in this project, what it does, and how it fits together.

---

## Project Structure

```
crimenet-sa/
├── database/
│   └── schema.sql                    ← PostgreSQL + PostGIS schema (run this first)
│
├── backend/
│   ├── Dockerfile                    ← Docker image for NestJS API
│   └── src/
│       ├── main.ts                   ← App entry point, Swagger docs
│       ├── app.module.ts             ← Root module, wires all feature modules
│       ├── incidents/
│       │   ├── incidents.controller.ts  ← REST endpoints + business logic
│       │   └── dto/
│       │       └── create-incident.dto.ts  ← DTOs + WhatsApp webhook handler
│       ├── realtime/
│       │   └── realtime.gateway.ts   ← WebSocket gateway for live map updates
│       └── [other modules: auth, alerts, areas, organisations, panic]
│
├── frontend-web/
│   └── app/
│       └── dashboard/
│           └── page.tsx              ← B2B Operator Dashboard (Next.js + Mapbox)
│
├── mobile-app/
│   └── src/
│       └── screens/
│           ├── ReportScreen.tsx      ← Incident report form + offline queue
│           └── PanicScreen.tsx       ← Emergency panic button
│
├── ai-service/
│   ├── main.py                       ← FastAPI AI microservice
│   ├── requirements.txt              ← Python dependencies
│   └── Dockerfile                    ← Docker image for AI service
│
├── docker-compose.yml                ← Local development environment
├── .env.example                      ← All required environment variables
└── README.md                         ← This file
```

---

## File-by-File Guide

### 📁 `database/schema.sql`
**What it does:** The complete PostgreSQL database schema with PostGIS geospatial extensions.

**Key tables:**
- `incidents` — core crime report data with PostGIS `POINT` geometry for location
- `areas` — named geographic zones (suburbs) with PostGIS `POLYGON` boundaries
- `incident_clusters` — AI-grouped related incidents
- `hotspots` — AI-detected risk zones with confidence scores
- `organisations` — B2B customers (armed response companies)
- `whatsapp_subscribers` — users subscribed via WhatsApp without the app
- `digests` — auto-generated weekly intelligence reports

**How to use:** Paste into Supabase SQL Editor and run. Run the sections in order — `CREATE EXTENSION` first, then tables, then triggers, then RLS policies.

**POPIA compliance features built in:**
- `location_fuzzy` column auto-generated via trigger (offsets location ~200m)
- Row Level Security (RLS) ensures users only see their own data
- Anonymous reporting supported — `reporter_id` can be NULL

---

### 📁 `backend/src/main.ts`
**What it does:** NestJS application bootstrap. Sets up global validation, CORS, and Swagger API documentation at `/api/docs`.

**How to use:** This runs automatically. Don't edit unless changing port, CORS origins, or Swagger config.

---

### 📁 `backend/src/app.module.ts`
**What it does:** Root NestJS module. Imports all feature modules and sets up rate limiting (10 req/sec, 100 req/min).

**How to add a new feature:** Create a new module folder under `src/`, then import it here.

---

### 📁 `backend/src/incidents/incidents.controller.ts`
**What it does:** Two files in one — the incidents REST controller AND the incidents service (business logic).

**API endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/incidents` | Required | Submit a new incident report |
| `GET` | `/incidents/nearby?lat=&lng=&radius_m=&hours=` | None | Get verified incidents near a point |
| `GET` | `/incidents/area/:id` | Operator+ | All incidents in an area (exact coordinates) |
| `GET` | `/incidents/:id` | None | Get a single incident |
| `POST` | `/incidents/:id/confirm` | Required | Corroborate an existing report |
| `POST` | `/incidents/:id/flag` | Required | Flag as false report |
| `PATCH` | `/incidents/:id/status` | Operator+ | Update incident status |

**Auto-verification logic:** When a new incident is submitted, the service checks for other reports of the same category within 500m in the last 30 minutes. If found, both are auto-verified (status → `verified`) and an alert is broadcast.

---

### 📁 `backend/src/incidents/dto/create-incident.dto.ts`
**What it does:** Three things in one file:
1. `CreateIncidentDto` — validates incident submission payload
2. `NearbyIncidentsDto` — validates nearby query parameters
3. **WhatsApp bot handler** — `WhatsappController` and `WhatsappService` (most of the file)

**WhatsApp commands handled:**
- `REPORT <type> <description>` → creates an incident linked to subscriber's area
- `ALERT <suburb>` → subscribes to crime alerts for that suburb
- `STOP` → unsubscribes
- `STATUS` → shows current subscription
- `DIGEST` → sends this week's intelligence digest
- `HELP` → command list

**Webhook setup:** Register `POST /whatsapp/webhook` in Meta Developer Console. Set `WHATSAPP_VERIFY_TOKEN` in your `.env`.

---

### 📁 `backend/src/realtime/realtime.gateway.ts`
**What it does:** Socket.IO WebSocket gateway. Clients (dashboard and mobile app) connect here to receive live updates without polling.

**Events the server emits:**
- `new_incident` — broadcast to all clients subscribed to the affected area
- `hotspot_update` — broadcast when AI detects a new hotspot
- `panic_alert` — broadcast to operators only when panic button pressed

**Events the client sends:**
- `subscribe_area` `{ area_id }` — join a room for live updates from that area
- `unsubscribe_area` `{ area_id }` — leave a room

**Client connection example (dashboard):**
```javascript
const socket = io('wss://api.crimenet.co.za/realtime');
socket.emit('subscribe_area', { area_id: 'your-area-uuid' });
socket.on('new_incident', (incident) => updateMap(incident));
```

---

### 📁 `frontend-web/app/dashboard/page.tsx`
**What it does:** The B2B operator dashboard. A full-screen live crime map for armed response company control rooms.

**Features:**
- Live Mapbox GL JS map (dark theme) with custom incident markers
- Supabase Realtime subscription — new incidents appear on map within 1 second
- Sidebar with filterable incident feed
- Per-incident detail panel with Dispatch/Resolve actions
- Stats bar: total today, verified, hotspots, response coverage
- Live/Paused toggle with alert counter
- Auto-flyTo when new incident arrives

**Environment variables required:**
```
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

**To run:**
```bash
cd frontend-web
npm install
npm run dev
# Dashboard at http://localhost:3000/dashboard
```

---

### 📁 `mobile-app/src/screens/ReportScreen.tsx`
**What it does:** The incident report screen for the React Native community app.

**Features:**
- 10-category grid selector with colour coding
- Title + description inputs
- GPS location capture (expo-location)
- Anonymous toggle
- Photo attachment (camera or library, max 3)
- **Offline queue** — reports are saved to MMKV storage when offline, synced automatically when connectivity returns (load-shedding resilience)

**Offline queue behaviour:**
1. User submits report → app checks `NetInfo.isConnected`
2. If offline: saved to MMKV with `synced: false`
3. When connectivity returns: `NetInfo` event fires → `syncQueue()` called
4. All unsynced reports POSTed to API in order
5. Marked as `synced: true` in local queue

---

### 📁 `mobile-app/src/screens/PanicScreen.tsx`
**What it does:** The emergency panic button screen.

**How the panic button works:**
1. User presses button → 5-second countdown starts with vibration
2. User can tap again to cancel during countdown
3. After 5 seconds: GPS captured, alert sent to:
   - Armed response operators in the area (via WebSocket broadcast)
   - Personal emergency contacts (SMS via Vonage)
4. User taps "I AM SAFE" to deactivate

**Safety design decisions:**
- 5-second countdown prevents accidental triggers
- Location shared only during active panic (not stored persistently)
- Emergency contacts stored locally on device, not on server

---

### 📁 `ai-service/main.py`
**What it does:** Python FastAPI microservice. Runs independently from the NestJS API. Called by the API on a schedule or on-demand.

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/cluster` | Run DBSCAN incident clustering (triggered every 6h) |
| `POST` | `/digest` | Generate weekly intelligence digest using Claude API |
| `GET` | `/health` | Health check |

**Clustering algorithm (DBSCAN):**
- `eps = 500m` — incidents within 500m are considered the same event
- `min_samples = 2` — minimum 2 incidents to form a cluster
- Features: `[lat × 111000, lng × 85000]` — converts degrees to approximate metres
- Outputs: cluster centroid, radius, confidence score, is_hotspot flag

**Digest generation (Claude API):**
1. Fetches all verified incidents for the area/week from Supabase
2. Fetches active hotspots
3. Builds a structured prompt for `claude-opus-4-6`
4. Claude generates a professional markdown digest
5. Saved to `digests` table, available via API and WhatsApp `DIGEST` command

**Schedule in production (Railway cron):**
```
# Cluster every 6 hours
0 */6 * * * POST /cluster

# Generate digests every Monday 5am
0 5 * * 1 POST /digest
```

**Authentication:** Protected with `X-API-Key` header matching `AI_SERVICE_API_KEY` env var.

---

### 📁 `ai-service/requirements.txt`
**What it does:** Python package dependencies for the AI service.

Key packages:
- `fastapi` + `uvicorn` — async web framework
- `anthropic` — Claude API client
- `scikit-learn` — DBSCAN clustering
- `numpy` — numerical operations
- `supabase` — Supabase Python client

---

### 📁 `docker-compose.yml`
**What it does:** Local development environment. Runs all backend services together.

**Services:**
- `api` — NestJS backend on port 3001
- `ai` — Python FastAPI service on port 8000
- `redis` — Redis cache on port 6379

**To start:**
```bash
cp .env.example .env
# Fill in your .env values
docker compose up -d
docker compose logs -f api  # Watch API logs
```

---

### 📁 `.env.example`
**What it does:** Template for all required environment variables.

**How to use:**
```bash
cp .env.example .env
# Open .env and fill in every value
# Never commit .env to git (it's in .gitignore)
```

**Where to get each value:**
| Variable | Where to get it |
|----------|----------------|
| `SUPABASE_*` | supabase.com → your project → Settings → API |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `MAPBOX_TOKEN` | account.mapbox.com → Tokens |
| `WHATSAPP_*` | developers.facebook.com → WhatsApp → API Setup |
| `VONAGE_*` | dashboard.nexmo.com |
| `JWT_SECRET` | Run: `openssl rand -hex 64` |
| `AI_SERVICE_API_KEY` | Run: `openssl rand -hex 32` |

---

## Getting Started (Week 1 Setup)

### Step 1: Database
1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and paste the contents of `database/schema.sql`
3. Run it — you'll see the tables appear in the Table Editor

### Step 2: Backend API
```bash
cd backend
npm install
cp ../.env.example .env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
npm run start:dev
# API running at http://localhost:3001
# Swagger docs at http://localhost:3001/api/docs
```

### Step 3: AI Service
```bash
cd ai-service
pip install -r requirements.txt
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, AI_SERVICE_API_KEY in .env
uvicorn main:app --reload --port 8000
# Service running at http://localhost:8000
# Docs at http://localhost:8000/docs
```

### Step 4: Web Dashboard
```bash
cd frontend-web
npm install
# Fill in NEXT_PUBLIC_MAPBOX_TOKEN, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
# Dashboard at http://localhost:3000/dashboard
```

### Step 5: Mobile App
```bash
cd mobile-app
npm install
npx expo start
# Scan QR code with Expo Go app on your phone
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  ┌──────────────────┐  ┌────────────────┐  ┌────────────────┐   │
│  │  React Native    │  │  Next.js       │  │  WhatsApp Bot  │   │
│  │  Mobile App      │  │  B2B Dashboard │  │  (any phone)   │   │
│  └────────┬─────────┘  └───────┬────────┘  └───────┬────────┘   │
└───────────┼────────────────────┼───────────────────┼────────────┘
            │ HTTPS + WSS        │ HTTPS + WSS        │ Webhooks
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS API (Port 3001)                        │
│  IncidentsController │ AlertsService │ WhatsappController        │
│  RealtimeGateway (Socket.IO) │ AuthModule │ PanicController      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│  Supabase       │  │  Python FastAPI  │  │  Firebase FCM    │
│  PostgreSQL     │  │  AI Service      │  │  Push Alerts     │
│  + PostGIS      │  │  (Port 8000)     │  └──────────────────┘
│  + Realtime     │  │                  │
│  + Auth         │  │  DBSCAN Cluster  │
│  + Storage      │  │  Claude Digest   │
└─────────────────┘  └─────────────────┘
```

---

## Key Design Decisions

### Why Supabase?
- Free tier covers full MVP
- Built-in PostGIS, Auth, Realtime (WebSockets), Storage
- Cape Town data centre = POPIA compliant by default
- Saves 4+ weeks of infrastructure setup

### Why MMKV instead of AsyncStorage?
- 10x faster for frequent reads/writes
- Supports encryption (required for auth tokens)
- Critical for offline queue performance during load-shedding

### Why DBSCAN for clustering?
- Doesn't require specifying number of clusters in advance
- Handles noise (isolated false reports) naturally — they're labelled -1
- 500m radius tuned for SA suburb density

### Why 200m location fuzzing?
- POPIA requirement: exact addresses are personal information
- 200m radius makes location useful without identifying the reporter's home
- Applied automatically via PostgreSQL trigger on every insert

---

## POPIA Compliance Checklist

- [x] Location fuzzing (200m radius) applied automatically to all incident reports
- [x] Anonymous reporting: phone number not linked to report
- [x] Phone OTP authentication (not email — no email harvesting)
- [x] Row Level Security: users can't query other users' data
- [x] No persistent location storage on device — only captured on action
- [x] Data stored in Supabase Cape Town data centre (af-south-1 equivalent)
- [ ] Privacy policy document (legal counsel required)
- [ ] POPIA compliance audit before public launch (budget R10,000)

---

## Deployment

### Free tier deployment (MVP)
| Service | Platform | Cost |
|---------|----------|------|
| Database + Auth + Realtime | Supabase | Free |
| Next.js Dashboard | Vercel | Free |
| NestJS API | Railway | R75 free/mo |
| AI Microservice | Railway | Included |
| Push Notifications | Firebase | Free |

### Production deployment
1. Push backend to Railway — auto-deploys on `git push main`
2. Push frontend to Vercel — auto-deploys on `git push main`
3. Set all environment variables in Railway and Vercel dashboards
4. Configure Supabase RLS policies for production
5. Register WhatsApp webhook URL in Meta Developer Console

---

*CrimeNet SA — Build Plan v1.0 · February 2026 · Confidential*
