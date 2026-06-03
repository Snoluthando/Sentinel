// =============================================================================
// CrimeNet SA — Incidents Module
// File: backend/src/incidents/incidents.controller.ts
// Handles incident reports, verification, and geospatial queries
// =============================================================================

import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, Request, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IncidentsService } from './incidents.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { NearbyIncidentsDto } from './dto/nearby-incidents.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  // ---------------------------------------------------------------------------
  // POST /incidents — Submit a new incident report
  // ---------------------------------------------------------------------------
  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { limit: 3, ttl: 60000 } })  // Max 3 reports per minute
  @ApiOperation({ summary: 'Submit a new incident report' })
  async create(@Body() dto: CreateIncidentDto, @Request() req) {
    return this.incidentsService.create(dto, req.user.id);
  }

  // ---------------------------------------------------------------------------
  // GET /incidents/nearby — Get incidents within radius (public, fuzzy locations)
  // ---------------------------------------------------------------------------
  @Get('nearby')
  @ApiOperation({ summary: 'Get verified incidents near a location' })
  @ApiQuery({ name: 'lat', type: Number, example: -26.0274 })
  @ApiQuery({ name: 'lng', type: Number, example: 28.0088 })
  @ApiQuery({ name: 'radius_m', type: Number, example: 2000, required: false })
  @ApiQuery({ name: 'hours', type: Number, example: 24, required: false })
  async getNearby(@Query() query: NearbyIncidentsDto) {
    return this.incidentsService.findNearby(query);
  }

  // ---------------------------------------------------------------------------
  // GET /incidents/area/:areaId — All incidents in an area (operator+)
  // ---------------------------------------------------------------------------
  @Get('area/:areaId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('operator', 'admin')
  @ApiOperation({ summary: 'Get all incidents in an area (operators only — exact locations)' })
  async getByArea(
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Query('hours') hours = 24,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    return this.incidentsService.findByArea(areaId, { hours: +hours, category, status });
  }

  // ---------------------------------------------------------------------------
  // GET /incidents/:id — Get a single incident
  // ---------------------------------------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get incident details' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.incidentsService.findOne(id);
  }

  // ---------------------------------------------------------------------------
  // POST /incidents/:id/confirm — Corroborate an existing incident
  // ---------------------------------------------------------------------------
  @Post(':id/confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm / corroborate an existing incident report' })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
    @Request() req,
  ) {
    return this.incidentsService.confirm(id, req.user.id, body.note);
  }

  // ---------------------------------------------------------------------------
  // POST /incidents/:id/flag — Flag as false report
  // ---------------------------------------------------------------------------
  @Post(':id/flag')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flag an incident as a false report' })
  async flag(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.incidentsService.flag(id, req.user.id);
  }

  // ---------------------------------------------------------------------------
  // PATCH /incidents/:id/status — Update status (operators and admins only)
  // ---------------------------------------------------------------------------
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('operator', 'admin')
  @ApiOperation({ summary: 'Update incident status (operator+ only)' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string },
    @Request() req,
  ) {
    return this.incidentsService.updateStatus(id, body.status, req.user.id);
  }
}

// =============================================================================
// File: backend/src/incidents/incidents.service.ts
// Business logic for incident management
// =============================================================================

import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AlertsService } from '../alerts/alerts.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { NearbyIncidentsDto } from './dto/nearby-incidents.dto';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly alerts: AlertsService,
  ) {}

  async create(dto: CreateIncidentDto, reporterId: string) {
    const client = this.supabase.client;

    // Get reporter trust score
    const { data: reporter } = await client
      .from('user_profiles')
      .select('trust_score, anonymous_mode, role')
      .eq('id', reporterId)
      .single();

    const isAnonymous = dto.anonymous ?? reporter?.anonymous_mode ?? false;

    // Insert incident — PostGIS point from lat/lng
    const { data: incident, error } = await client
      .from('incidents')
      .insert({
        reporter_id: isAnonymous ? null : reporterId,
        is_anonymous: isAnonymous,
        category: dto.category,
        title: dto.title,
        description: dto.description,
        // PostGIS ST_MakePoint expects (lng, lat) — note the order
        location: `SRID=4326;POINT(${dto.lng} ${dto.lat})`,
        incident_time: dto.incident_time || new Date().toISOString(),
        photo_urls: dto.photo_urls || [],
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create incident', error);
      throw error;
    }

    // Increment reporter's report count
    if (!isAnonymous) {
      await client.rpc('increment_report_count', { user_id: reporterId });
    }

    // Check if 2+ independent reports exist nearby → auto-verify
    await this.checkAutoVerification(incident.id, dto.lat, dto.lng, dto.category);

    // Trigger alert broadcast if verified
    if (incident.status === 'verified') {
      await this.alerts.broadcastIncidentAlert(incident);
    }

    this.logger.log(`New incident created: ${incident.id} (${dto.category}) in ${incident.area_id}`);
    return incident;
  }

  async findNearby(query: NearbyIncidentsDto) {
    const { lat, lng, radius_m = 2000, hours = 24 } = query;
    const client = this.supabase.client;

    // PostGIS: find incidents within radius, use FUZZY location for public queries
    const { data, error } = await client.rpc('incidents_nearby', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: radius_m,
      p_hours: hours,
    });

    if (error) throw error;
    return data;
  }

  async findByArea(areaId: string, filters: { hours: number; category?: string; status?: string }) {
    const client = this.supabase.client;
    const since = new Date(Date.now() - filters.hours * 3600 * 1000).toISOString();

    let query = client
      .from('incidents')
      .select(`
        *,
        user_profiles (display_name, trust_score),
        areas (name)
      `)
      .eq('area_id', areaId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase.client
      .from('incidents')
      .select(`*, areas (name, city)`)
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Incident not found');
    return data;
  }

  async confirm(incidentId: string, userId: string, note?: string) {
    const client = this.supabase.client;

    // Check user hasn't already confirmed this incident
    const { data: existing } = await client
      .from('incident_confirmations')
      .select('id')
      .eq('incident_id', incidentId)
      .eq('reporter_id', userId)
      .single();

    if (existing) throw new ForbiddenException('Already confirmed this incident');

    // Add confirmation
    await client.from('incident_confirmations').insert({
      incident_id: incidentId,
      reporter_id: userId,
      note,
    });

    // Increment confirmation count
    const { data: incident } = await client
      .from('incidents')
      .update({ confirmation_count: this.supabase.client.rpc('increment') })
      .eq('id', incidentId)
      .select()
      .single();

    // Auto-verify if 2+ confirmations and status is pending
    if (incident.confirmation_count >= 2 && incident.status === 'pending') {
      await this.updateStatus(incidentId, 'verified', userId);
    }

    return { success: true, confirmation_count: incident.confirmation_count };
  }

  async flag(incidentId: string, userId: string) {
    const client = this.supabase.client;

    await client
      .from('incidents')
      .update({ false_flag_count: client.rpc('increment_false_flags', { id: incidentId }) })
      .eq('id', incidentId);

    // Auto-reject if 3+ flags
    const { data } = await client
      .from('incidents')
      .select('false_flag_count')
      .eq('id', incidentId)
      .single();

    if (data?.false_flag_count >= 3) {
      await this.updateStatus(incidentId, 'false_report', userId);
    }

    return { success: true };
  }

  async updateStatus(incidentId: string, status: string, userId: string) {
    const { data, error } = await this.supabase.client
      .from('incidents')
      .update({
        status,
        verified_at: status === 'verified' ? new Date().toISOString() : undefined,
        verified_by: status === 'verified' ? userId : undefined,
      })
      .eq('id', incidentId)
      .select()
      .single();

    if (error) throw error;

    // Broadcast if newly verified
    if (status === 'verified') {
      await this.alerts.broadcastIncidentAlert(data);
    }

    return data;
  }

  private async checkAutoVerification(
    incidentId: string,
    lat: number,
    lng: number,
    category: string,
  ) {
    // Find other recent incidents of same category within 500m in last 30 min
    const { data: nearby } = await this.supabase.client.rpc('incidents_nearby', {
      p_lat: lat,
      p_lng: lng,
      p_radius_m: 500,
      p_hours: 0.5,
    });

    const sameCategory = (nearby || []).filter(
      (i: any) => i.category === category && i.id !== incidentId,
    );

    if (sameCategory.length >= 1) {
      // Another recent report nearby → auto-verify both
      await this.supabase.client
        .from('incidents')
        .update({ status: 'verified', verified_at: new Date().toISOString(), confirmation_count: 2 })
        .eq('id', incidentId);
    }
  }
}
