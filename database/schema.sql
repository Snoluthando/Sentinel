-- =============================================================================
-- CrimeNet SA - Database Schema
-- PostgreSQL + PostGIS via Supabase
-- =============================================================================
-- Run this in your Supabase SQL editor in order.
-- Extensions must be enabled first.

-- Enable PostGIS for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE incident_category AS ENUM (
  'theft',
  'robbery',
  'burglary',
  'vehicle_theft',
  'assault',
  'suspicious_activity',
  'vandalism',
  'fraud',
  'drug_activity',
  'road_accident',
  'other'
);

CREATE TYPE incident_status AS ENUM (
  'pending',      -- just submitted, awaiting verification
  'verified',     -- confirmed by 2+ independent reports
  'investigating',-- armed response dispatched or SAPS notified
  'resolved',     -- incident closed
  'false_report'  -- flagged as malicious/incorrect
);

CREATE TYPE user_role AS ENUM (
  'community',    -- regular resident (free)
  'watch_captain',-- neighbourhood watch coordinator (free, elevated trust)
  'operator',     -- armed response / security company staff
  'admin'         -- CrimeNet platform admin
);

CREATE TYPE subscription_tier AS ENUM (
  'starter',      -- R1,500/mo
  'growth',       -- R5,000/mo
  'enterprise',   -- R15,000+/mo
  'api'           -- R500/mo API access
);

CREATE TYPE alert_channel AS ENUM (
  'push',
  'whatsapp',
  'email',
  'sms'
);

-- =============================================================================
-- USERS TABLE
-- Supabase Auth manages auth.users; this extends with app-specific data
-- =============================================================================

CREATE TABLE public.user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone         TEXT UNIQUE NOT NULL,                -- SA format: +27...
  display_name  TEXT,
  role          user_role NOT NULL DEFAULT 'community',
  trust_score   SMALLINT NOT NULL DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
                -- 50 = new user. Increases with verified reports. Decreases with false flags.
  reports_count INT NOT NULL DEFAULT 0,
  anonymous_mode BOOLEAN NOT NULL DEFAULT FALSE,     -- user prefers anonymous reports
  area_id       UUID,                                -- home area (FK added below)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- AREAS TABLE
-- Named geographic zones (suburbs, townships, CPF sectors)
-- =============================================================================

CREATE TABLE public.areas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,                       -- e.g. "Fourways", "Alexandra"
  city          TEXT NOT NULL DEFAULT 'Johannesburg',
  province      TEXT NOT NULL DEFAULT 'Gauteng',
  boundary      GEOMETRY(POLYGON, 4326),             -- PostGIS polygon (WGS84)
  centroid      GEOMETRY(POINT, 4326),               -- auto-derived or manual
  population    INT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index on boundary for fast polygon-in-polygon and point-in-polygon queries
CREATE INDEX idx_areas_boundary ON areas USING GIST(boundary);
CREATE INDEX idx_areas_centroid ON areas USING GIST(centroid);

-- Add foreign key now that areas exists
ALTER TABLE public.user_profiles
  ADD CONSTRAINT fk_user_area FOREIGN KEY (area_id) REFERENCES areas(id);

-- =============================================================================
-- INCIDENTS TABLE
-- Core data entity — every crime report lives here
-- =============================================================================

CREATE TABLE public.incidents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Who reported it
  reporter_id     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_anonymous    BOOLEAN NOT NULL DEFAULT FALSE,

  -- What happened
  category        incident_category NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          incident_status NOT NULL DEFAULT 'pending',

  -- Where it happened — PostGIS geometry (WGS84 / EPSG:4326)
  -- location is the EXACT point; location_fuzzy is offset ~200m for privacy
  location        GEOMETRY(POINT, 4326) NOT NULL,
  location_fuzzy  GEOMETRY(POINT, 4326),  -- auto-generated on insert via trigger
  area_id         UUID REFERENCES areas(id),

  -- When it happened
  incident_time   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Verification
  confirmation_count  INT NOT NULL DEFAULT 1,  -- number of independent reports for this event
  false_flag_count    INT NOT NULL DEFAULT 0,
  verified_at         TIMESTAMPTZ,
  verified_by         UUID REFERENCES user_profiles(id),

  -- Cluster (AI groups related incidents)
  cluster_id      UUID,  -- FK to incident_clusters added below

  -- Media
  photo_urls      TEXT[],
  whatsapp_source BOOLEAN NOT NULL DEFAULT FALSE  -- TRUE if submitted via WhatsApp bot
);

-- Spatial index — critical for "incidents within X km" queries
CREATE INDEX idx_incidents_location ON incidents USING GIST(location);
CREATE INDEX idx_incidents_location_fuzzy ON incidents USING GIST(location_fuzzy);

-- Time-based index for recent incident queries
CREATE INDEX idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_category ON incidents(category);
CREATE INDEX idx_incidents_area ON incidents(area_id);

-- =============================================================================
-- INCIDENT CLUSTERS
-- AI groups spatially + temporally related incidents into clusters
-- =============================================================================

CREATE TABLE public.incident_clusters (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id         UUID REFERENCES areas(id),
  category        incident_category,
  centroid        GEOMETRY(POINT, 4326),
  radius_m        INT,                   -- approximate radius of cluster in meters
  incident_count  INT NOT NULL DEFAULT 0,
  first_seen      TIMESTAMPTZ,
  last_seen       TIMESTAMPTZ,
  confidence      NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  is_hotspot      BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clusters_centroid ON incident_clusters USING GIST(centroid);
CREATE INDEX idx_clusters_area ON incident_clusters(area_id);

-- Back-reference from incidents to clusters
ALTER TABLE incidents
  ADD CONSTRAINT fk_incident_cluster
    FOREIGN KEY (cluster_id) REFERENCES incident_clusters(id) ON DELETE SET NULL;

-- =============================================================================
-- HOTSPOTS
-- AI-generated risk zones, updated every 6 hours
-- =============================================================================

CREATE TABLE public.hotspots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id         UUID REFERENCES areas(id),
  cluster_id      UUID REFERENCES incident_clusters(id),
  location        GEOMETRY(POINT, 4326) NOT NULL,
  radius_m        INT NOT NULL DEFAULT 500,
  confidence      NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  category        incident_category,
  risk_level      SMALLINT CHECK (risk_level BETWEEN 1 AND 5),  -- 1=low, 5=critical
  predicted_windows JSONB,  -- e.g. [{"day":"Monday","start":"20:00","end":"23:00","confidence":0.82}]
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours'
);

CREATE INDEX idx_hotspots_location ON hotspots USING GIST(location);
CREATE INDEX idx_hotspots_active ON hotspots(active) WHERE active = TRUE;

-- =============================================================================
-- ORGANISATIONS (B2B Customers)
-- Armed response companies, property managers, etc.
-- =============================================================================

CREATE TABLE public.organisations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'armed_response',  -- armed_response | watch | property | insurance
  subscription    subscription_tier NOT NULL DEFAULT 'starter',
  subscription_start TIMESTAMPTZ,
  subscription_end   TIMESTAMPTZ,
  area_ids        UUID[],              -- areas this org covers
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link users to organisations (operators belong to an org)
CREATE TABLE public.org_members (
  org_id    UUID REFERENCES organisations(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  is_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

-- =============================================================================
-- ALERTS
-- Outbound notifications to users
-- =============================================================================

CREATE TABLE public.alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id     UUID REFERENCES incidents(id) ON DELETE SET NULL,
  area_id         UUID REFERENCES areas(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  channel         alert_channel NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_count INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_alerts_area ON alerts(area_id);
CREATE INDEX idx_alerts_sent ON alerts(sent_at DESC);

-- =============================================================================
-- USER ALERT SUBSCRIPTIONS
-- Which areas does each user want alerts for, and via which channel?
-- =============================================================================

CREATE TABLE public.alert_subscriptions (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
  area_id   UUID REFERENCES areas(id) ON DELETE CASCADE,
  channel   alert_channel NOT NULL DEFAULT 'push',
  radius_m  INT NOT NULL DEFAULT 2000,  -- alert within X meters of their location
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, area_id, channel)
);

-- =============================================================================
-- WHATSAPP SUBSCRIBERS
-- Users who subscribe via WhatsApp without app
-- =============================================================================

CREATE TABLE public.whatsapp_subscribers (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone     TEXT UNIQUE NOT NULL,
  area_id   UUID REFERENCES areas(id),
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- WEEKLY DIGESTS
-- Auto-generated intelligence reports for B2B subscribers
-- =============================================================================

CREATE TABLE public.digests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID REFERENCES organisations(id),
  area_id     UUID REFERENCES areas(id),
  week_start  DATE NOT NULL,
  week_end    DATE NOT NULL,
  content     TEXT NOT NULL,       -- AI-generated markdown content
  pdf_url     TEXT,                -- Supabase Storage URL
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INCIDENT REPORTS (duplicate detection)
-- When users corroborate an existing incident
-- =============================================================================

CREATE TABLE public.incident_confirmations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PANIC BUTTON EVENTS
-- Emergency alerts from the app panic button
-- =============================================================================

CREATE TABLE public.panic_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES user_profiles(id),
  location    GEOMETRY(POINT, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  notes       TEXT
);

CREATE INDEX idx_panic_location ON panic_events USING GIST(location);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_incidents
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_user_profiles
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Auto-generate fuzzy location on incident insert (offset by ~100-200m)
CREATE OR REPLACE FUNCTION generate_fuzzy_location()
RETURNS TRIGGER AS $$
DECLARE
  offset_lat DOUBLE PRECISION;
  offset_lng DOUBLE PRECISION;
BEGIN
  -- Random offset between 0.001 and 0.002 degrees (~100-200m)
  offset_lat := (random() - 0.5) * 0.003;
  offset_lng := (random() - 0.5) * 0.003;
  NEW.location_fuzzy := ST_SetSRID(
    ST_MakePoint(
      ST_X(NEW.location) + offset_lng,
      ST_Y(NEW.location) + offset_lat
    ), 4326
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_fuzzy_location
  BEFORE INSERT ON incidents
  FOR EACH ROW EXECUTE PROCEDURE generate_fuzzy_location();

-- Auto-set area_id on incidents based on location
CREATE OR REPLACE FUNCTION set_incident_area()
RETURNS TRIGGER AS $$
BEGIN
  SELECT id INTO NEW.area_id
  FROM areas
  WHERE ST_Contains(boundary, NEW.location)
  LIMIT 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assign_incident_area
  BEFORE INSERT ON incidents
  FOR EACH ROW EXECUTE PROCEDURE set_incident_area();

-- =============================================================================
-- ROW LEVEL SECURITY (POPIA compliance)
-- =============================================================================

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panic_events ENABLE ROW LEVEL SECURITY;

-- Users can only see their own profile
CREATE POLICY "Users see own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Incidents: community users see verified incidents only (fuzzy location)
-- Operators see all verified incidents in their areas (exact location)
CREATE POLICY "Community sees verified incidents"
  ON incidents FOR SELECT
  USING (
    status IN ('verified', 'resolved') OR reporter_id = auth.uid()
  );

-- Users can only see their own subscriptions
CREATE POLICY "Users see own subscriptions"
  ON alert_subscriptions FOR ALL
  USING (user_id = auth.uid());

-- Users can only see their own panic events
CREATE POLICY "Users see own panic events"
  ON panic_events FOR ALL
  USING (user_id = auth.uid());

-- =============================================================================
-- SAMPLE DATA — Johannesburg Areas
-- =============================================================================

INSERT INTO areas (name, city, province, centroid) VALUES
  ('Fourways', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(28.0088, -26.0274), 4326)),
  ('Randburg', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(27.9993, -26.0931), 4326)),
  ('Sandton', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(28.0567, -26.1076), 4326)),
  ('Soweto', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(27.8545, -26.2672), 4326)),
  ('Alexandra', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(28.0997, -26.1066), 4326)),
  ('Midrand', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(28.1282, -25.9980), 4326)),
  ('Roodepoort', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(27.8728, -26.1625), 4326)),
  ('Boksburg', 'Johannesburg', 'Gauteng', ST_SetSRID(ST_MakePoint(28.2603, -26.2126), 4326));
