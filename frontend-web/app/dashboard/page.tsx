'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Bell, Menu } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

interface Incident {
  id: string;
  category: string;
  title: string;
  description?: string;
  status: string;
  created_at: string;
  confirmation_count: number;
  lat: number;
  lng: number;
  area?: string;
}

const CATEGORY_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  robbery:             { color: '#EF4444', icon: '🔫', label: 'Robbery' },
  theft:               { color: '#F97316', icon: '👜', label: 'Theft' },
  burglary:            { color: '#EAB308', icon: '🏠', label: 'Burglary' },
  vehicle_theft:       { color: '#8B5CF6', icon: '🚗', label: 'Vehicle Theft' },
  assault:             { color: '#DC2626', icon: '⚠️', label: 'Assault' },
  suspicious_activity: { color: '#3B82F6', icon: '👁️', label: 'Suspicious' },
  vandalism:           { color: '#6B7280', icon: '🔨', label: 'Vandalism' },
  drug_activity:       { color: '#10B981', icon: '💊', label: 'Drug Activity' },
  road_accident:       { color: '#64748B', icon: '🚨', label: 'Road Accident' },
  other:               { color: '#94A3B8', icon: '📋', label: 'Other' },
};

const timeAgo = (date: string) => {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
};

function parseLocation(raw: any): { lat: number; lng: number } {
  if (!raw) return { lat: -26.0274, lng: 28.0088 };
  if (raw.coordinates) return { lat: raw.coordinates[1], lng: raw.coordinates[0] };
  if (typeof raw === 'string') {
    const m = raw.match(/POINT\(([^ ]+) ([^ )]+)\)/);
    if (m) return { lat: parseFloat(m[2]), lng: parseFloat(m[1]) };
  }
  return { lat: -26.0274, lng: 28.0088 };
}

export default function DashboardPage() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [filter, setFilter] = useState('all');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newAlerts, setNewAlerts] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-ZA', { hour12: false }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Load initial incidents from Supabase
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Failed to load incidents:', error);
      } else {
        const formatted = (data || []).map((inc: any) => {
          const coords = parseLocation(inc.location_fuzzy || inc.location);
          return { ...inc, lat: coords.lat, lng: coords.lng };
        });
        setIncidents(formatted);
      }
      setLoading(false);
    };
    load();
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!isLive) return;
    const channel = supabase
      .channel('incidents-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, (payload) => {
        const inc = payload.new as any;
        const coords = parseLocation(inc.location_fuzzy || inc.location);
        const formatted = { ...inc, lat: coords.lat, lng: coords.lng };
        setIncidents(prev => [formatted, ...prev.slice(0, 99)]);
        setNewAlerts(prev => prev + 1);
        if (mapRef.current) {
          import('leaflet').then(L => addMarker(formatted, L, mapRef.current));
          mapRef.current.flyTo([coords.lat, coords.lng], 14);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isLive]);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      const map = L.map(mapContainer.current!, { center: [-26.0274, 28.0088], zoom: 12 });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
    });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  // Add markers when incidents load
  useEffect(() => {
    if (!incidents.length) return;
    import('leaflet').then((L) => {
      if (!mapRef.current) return;
      incidents.forEach(inc => addMarker(inc, L, mapRef.current));
    });
  }, [incidents]);

  const addMarker = (incident: Incident, L: any, map: any) => {
    if (!map || markersRef.current.has(incident.id)) return;
    const config = CATEGORY_CONFIG[incident.category] || CATEGORY_CONFIG.other;
    const icon = L.divIcon({
      html: `<div style="width:34px;height:34px;background:${config.color}25;border:2px solid ${config.color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;box-shadow:0 0 10px ${config.color}40">${config.icon}</div>`,
      className: '', iconSize: [34, 34], iconAnchor: [17, 17],
    });
    const marker = L.marker([incident.lat, incident.lng], { icon })
      .addTo(map)
      .on('click', () => setSelectedIncident(incident));
    markersRef.current.set(incident.id, marker);
  };

  const filteredIncidents = incidents.filter(i =>
    filter === 'all' || i.status === filter
  );

  const stats = {
    total: incidents.length,
    verified: incidents.filter(i => i.status === 'verified').length,
    hotspots: 3,
    coverage: 87,
  };

  return (
    <div style={{ height: '100vh', background: '#080C18', color: '#E2E8F0', display: 'flex', flexDirection: 'column', fontFamily: "'IBM Plex Mono', monospace", overflow: 'hidden' }}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      {/* Topbar */}
      <div style={{ height: 52, background: '#0D1220', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', color: '#E2E8F0', cursor: 'pointer', padding: 8 }}>
          <Menu size={18} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🚔</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: '#EF4444' }}>SENTINEL</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', letterSpacing: 2 }}>SA OPS</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => { setIsLive(!isLive); setNewAlerts(0); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: isLive ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isLive ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`, color: isLive ? '#10B981' : 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', fontFamily: 'inherit' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: isLive ? '#10B981' : 'rgba(255,255,255,0.2)', animation: isLive ? 'pulse 1.5s infinite' : 'none', display: 'inline-block' }} />
          {isLive ? 'LIVE' : 'PAUSED'}
        </button>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 12 }}>{clock}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 12 }}>
          <div style={{ position: 'relative', cursor: 'pointer' }}>
            <Bell size={16} />
            {newAlerts > 0 && <span style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, background: '#EF4444', borderRadius: '50%', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{newAlerts > 9 ? '9+' : newAlerts}</span>}
          </div>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#3B82F6' }}>AR</div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Protea Armed Response</span>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        {sidebarOpen && (
          <div style={{ width: 290, background: '#0D1220', borderRight: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {[
                { label: 'INCIDENTS', value: stats.total, color: '#EF4444' },
                { label: 'VERIFIED', value: stats.verified, color: '#3B82F6' },
                { label: 'HOTSPOTS', value: stats.hotspots, color: '#F97316' },
                { label: 'COVERAGE', value: `${stats.coverage}%`, color: '#10B981' },
              ].map(s => (
                <div key={s.label} style={{ background: '#0D1220', padding: 12 }}>
                  <div style={{ fontSize: 8, letterSpacing: 2, color: 'rgba(255,255,255,0.2)', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {['all', 'verified', 'pending', 'investigating', 'resolved'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ padding: '4px 8px', borderRadius: 6, fontSize: 8, letterSpacing: 1, border: 'none', background: filter === f ? 'rgba(255,255,255,0.08)' : 'transparent', color: filter === f ? '#E2E8F0' : 'rgba(255,255,255,0.3)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>Loading from Supabase...</div>
              ) : filteredIncidents.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>No incidents found</div>
              ) : filteredIncidents.map(inc => {
                const config = CATEGORY_CONFIG[inc.category] || CATEGORY_CONFIG.other;
                return (
                  <button key={inc.id} onClick={() => { setSelectedIncident(inc); if (mapRef.current) mapRef.current.flyTo([inc.lat, inc.lng], 15); }}
                    style={{ width: '100%', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '10px 12px', background: selectedIncident?.id === inc.id ? 'rgba(255,255,255,0.05)' : 'transparent', borderLeft: selectedIncident?.id === inc.id ? '2px solid #3B82F6' : '2px solid transparent', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: 'inherit' }}>
                    <span style={{ fontSize: 18 }}>{config.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, border: '1px solid', color: config.color, borderColor: `${config.color}40`, background: `${config.color}15`, fontWeight: 700 }}>{config.label}</span>
                        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>{inc.status.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{inc.title}</div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>🕐 {timeAgo(inc.created_at)} · ✓ {inc.confirmation_count}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />

          {selectedIncident && (
            <div style={{ position: 'absolute', top: 16, right: 16, width: 280, background: 'rgba(13,18,32,0.96)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 16, zIndex: 1000 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 28 }}>{CATEGORY_CONFIG[selectedIncident.category]?.icon}</span>
                  <div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: 2 }}>{CATEGORY_CONFIG[selectedIncident.category]?.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedIncident.title}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedIncident(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>
              {selectedIncident.description && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 12, lineHeight: 1.6 }}>{selectedIncident.description}</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                {[
                  { label: 'STATUS', value: selectedIncident.status.toUpperCase(), color: '#3B82F6' },
                  { label: 'CONFIRMS', value: selectedIncident.confirmation_count, color: '#3B82F6' },
                  { label: 'REPORTED', value: timeAgo(selectedIncident.created_at), color: '#E2E8F0' },
                  { label: 'ID', value: selectedIncident.id.substring(0, 8) + '...', color: 'rgba(255,255,255,0.4)' },
                ].map(c => (
                  <div key={c.label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 8, letterSpacing: 2, color: 'rgba(255,255,255,0.3)', marginBottom: 3 }}>{c.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: c.color }}>{c.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#3B82F6', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🚔 Dispatch</button>
                <button style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#10B981', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Resolve</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .leaflet-container { background: #080C18 !important; }
      `}</style>
    </div>
  );
}
