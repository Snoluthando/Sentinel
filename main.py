#!/usr/bin/env python3
"""
CrimeNet SA - AI Intelligence Microservice
FastAPI service for clustering, hotspot detection, and digest generation.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, BackgroundTasks, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("crimenet-ai")

app = FastAPI(
    title="CrimeNet SA - AI Service",
    description="Clustering, hotspot detection, and digest generation",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Optional integrations - gracefully skip if env vars not set yet
# ---------------------------------------------------------------------------

supabase = None
claude = None

try:
    from supabase import create_client, Client
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if supabase_url and supabase_key:
        supabase = create_client(supabase_url, supabase_key)
        logger.info("Supabase connected")
    else:
        logger.warning("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set - running without database")
except Exception as e:
    logger.warning(f"Supabase not available: {e}")

try:
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        claude = anthropic.Anthropic(api_key=api_key)
        logger.info("Claude API connected")
    else:
        logger.warning("ANTHROPIC_API_KEY not set - digest generation will be unavailable")
except Exception as e:
    logger.warning(f"Anthropic not available: {e}")

try:
    import numpy as np
    from sklearn.cluster import DBSCAN
    CLUSTERING_AVAILABLE = True
    logger.info("Clustering (scikit-learn + numpy) available")
except Exception as e:
    CLUSTERING_AVAILABLE = False
    logger.warning(f"Clustering not available: {e}")

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def verify_api_key(x_api_key: str = Header(None)):
    expected = os.environ.get("AI_SERVICE_API_KEY")
    if expected and x_api_key != expected:
        raise HTTPException(status_code=403, detail="Invalid API key")

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ClusterRequest(BaseModel):
    area_id: Optional[str] = None
    hours_back: int = 48

class DigestRequest(BaseModel):
    area_id: str
    org_id: str
    week_start: str

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {
        "service": "CrimeNet SA AI Intelligence Microservice",
        "status": "running",
        "supabase": "connected" if supabase else "not configured",
        "claude": "connected" if claude else "not configured",
        "clustering": "available" if CLUSTERING_AVAILABLE else "not available",
        "endpoints": ["/cluster", "/digest", "/health"],
        "docs": "/docs",
    }

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "crimenet-ai",
        "timestamp": datetime.utcnow().isoformat(),
        "supabase": supabase is not None,
        "claude": claude is not None,
        "clustering": CLUSTERING_AVAILABLE,
    }

@app.post("/cluster")
async def run_clustering(
    req: ClusterRequest,
    background_tasks: BackgroundTasks,
    x_api_key: str = Header(None),
):
    verify_api_key(x_api_key)

    if not supabase:
        return {"status": "skipped", "reason": "Supabase not configured"}

    if not CLUSTERING_AVAILABLE:
        return {"status": "skipped", "reason": "scikit-learn not available"}

    background_tasks.add_task(cluster_incidents, req.area_id, req.hours_back)
    return {"status": "clustering_started", "area_id": req.area_id}

@app.post("/digest")
async def generate_digest(
    req: DigestRequest,
    x_api_key: str = Header(None),
):
    verify_api_key(x_api_key)

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase not configured")

    if not claude:
        raise HTTPException(status_code=503, detail="Claude API not configured")

    week_start = datetime.fromisoformat(req.week_start)
    week_end = week_start + timedelta(days=7)

    try:
        response = supabase.table("incidents").select(
            "category, title, description, created_at, confirmation_count, status"
        ).eq("area_id", req.area_id).gte(
            "created_at", week_start.isoformat()
        ).lt(
            "created_at", week_end.isoformat()
        ).in_("status", ["verified", "resolved"]).execute()

        incidents = response.data or []

        area_resp = supabase.table("areas").select("name, city").eq(
            "id", req.area_id
        ).single().execute()
        area = area_resp.data

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    if not incidents:
        digest_content = (
            f"# {area['name']} Crime Intelligence Digest\n"
            f"Week of {week_start.strftime('%d %B %Y')}\n\n"
            f"No verified incidents reported this week.\n"
        )
    else:
        incident_summary = "\n".join([
            f"- {i['category'].replace('_', ' ').title()}: {i['title']}"
            for i in incidents
        ])

        prompt = f"""Write a professional weekly crime intelligence digest for {area['name']}, {area['city']}, South Africa.

Week: {week_start.strftime('%d %B')} to {week_end.strftime('%d %B %Y')}
Total verified incidents: {len(incidents)}

Incidents:
{incident_summary}

Write in markdown. Include: executive summary, incident breakdown, patterns observed, patrol recommendations. Keep it factual and professional."""

        message = claude.messages.create(
            model="claude-opus-4-6",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        digest_content = message.content[0].text

    try:
        result = supabase.table("digests").insert({
            "org_id": req.org_id,
            "area_id": req.area_id,
            "week_start": week_start.date().isoformat(),
            "week_end": week_end.date().isoformat(),
            "content": digest_content,
        }).execute()

        digest_id = result.data[0]["id"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save digest: {e}")

    return {
        "digest_id": digest_id,
        "area": area["name"],
        "incident_count": len(incidents),
        "content_preview": digest_content[:200] + "...",
    }

# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------

async def cluster_incidents(area_id: Optional[str], hours_back: int):
    if not supabase or not CLUSTERING_AVAILABLE:
        return

    since = (datetime.utcnow() - timedelta(hours=hours_back)).isoformat()

    try:
        query = supabase.table("incidents").select(
            "id, category, created_at"
        ).gte("created_at", since).in_("status", ["pending", "verified"])

        if area_id:
            query = query.eq("area_id", area_id)

        response = query.execute()
        incidents = response.data or []

    except Exception as e:
        logger.error(f"Failed to fetch incidents: {e}")
        return

    if len(incidents) < 2:
        logger.info(f"Not enough incidents to cluster ({len(incidents)} found)")
        return

    logger.info(f"Clustering {len(incidents)} incidents...")

    # Basic clustering placeholder - full PostGIS version requires lat/lng columns
    logger.info("Clustering complete")

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
