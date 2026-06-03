// =============================================================================
// CrimeNet SA — Data Transfer Objects (DTOs)
// File: backend/src/incidents/dto/create-incident.dto.ts
// =============================================================================

import { IsEnum, IsString, IsNumber, IsOptional, IsBoolean, IsArray, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum IncidentCategory {
  THEFT = 'theft',
  ROBBERY = 'robbery',
  BURGLARY = 'burglary',
  VEHICLE_THEFT = 'vehicle_theft',
  ASSAULT = 'assault',
  SUSPICIOUS = 'suspicious_activity',
  VANDALISM = 'vandalism',
  FRAUD = 'fraud',
  DRUGS = 'drug_activity',
  ROAD_ACCIDENT = 'road_accident',
  OTHER = 'other',
}

export class CreateIncidentDto {
  @ApiProperty({ enum: IncidentCategory })
  @IsEnum(IncidentCategory)
  category: IncidentCategory;

  @ApiProperty({ example: 'Armed robbery at Fourways Mall parking' })
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: -26.0274, description: 'Latitude (WGS84)' })
  @IsNumber()
  @Min(-35)
  @Max(-22)
  lat: number;

  @ApiProperty({ example: 28.0088, description: 'Longitude (WGS84)' })
  @IsNumber()
  @Min(16)
  @Max(33)
  lng: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  incident_time?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photo_urls?: string[];

  @ApiProperty({ required: false, description: 'Override user anonymous setting' })
  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;
}

// =============================================================================
// File: backend/src/incidents/dto/nearby-incidents.dto.ts
// =============================================================================

import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class NearbyIncidentsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-35) @Max(-22)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(16) @Max(33)
  lng: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100) @Max(50000)
  radius_m?: number = 2000;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1) @Max(720)
  hours?: number = 24;

  @IsOptional()
  category?: string;
}

// =============================================================================
// CrimeNet SA — WhatsApp Bot Webhook Handler
// File: backend/src/whatsapp/whatsapp.controller.ts
// Handles incoming WhatsApp messages via Meta Cloud API webhooks
// =============================================================================
// Supported commands:
//   REPORT <category> <description>  — submit an incident
//   ALERT <suburb>                   — subscribe to alerts for a suburb
//   STOP                             — unsubscribe from all alerts
//   DIGEST                           — request your weekly digest now
//   HELP                             — show command list
// =============================================================================

import { Controller, Get, Post, Body, Query, Logger, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /whatsapp/webhook — Meta webhook verification challenge
  // ---------------------------------------------------------------------------
  @Get('webhook')
  @ApiOperation({ summary: 'Meta webhook verification (GET challenge)' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const verifyToken = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified');
      return parseInt(challenge, 10);
    }

    this.logger.warn('WhatsApp webhook verification failed');
    return { error: 'Forbidden' };
  }

  // ---------------------------------------------------------------------------
  // POST /whatsapp/webhook — Incoming message handler
  // ---------------------------------------------------------------------------
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Handle incoming WhatsApp messages' })
  async handleMessage(@Body() payload: any) {
    try {
      // Extract message from Meta webhook payload
      const entry = payload?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (!messages?.length) {
        return { status: 'no_message' };
      }

      const message = messages[0];
      const from = message.from;  // Phone number in E.164 format
      const text = message.text?.body?.trim()?.toUpperCase();

      if (!text) return { status: 'unsupported_message_type' };

      this.logger.log(`WhatsApp message from ${from}: ${text.substring(0, 50)}`);

      await this.whatsappService.handleIncomingMessage(from, text);
      return { status: 'processed' };

    } catch (err) {
      this.logger.error('WhatsApp webhook error', err);
      return { status: 'error' };
    }
  }
}

// =============================================================================
// File: backend/src/whatsapp/whatsapp.service.ts
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { IncidentsService } from '../incidents/incidents.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const HELP_TEXT = `🚔 *CrimeNet SA*

Commands:
• *REPORT theft car stolen Fourways Mall* — report an incident
• *ALERT Fourways* — subscribe to alerts
• *STOP* — unsubscribe from alerts
• *STATUS* — your subscription status
• *DIGEST* — get this week's crime digest

Your location is never stored. Reports are anonymous.`;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly incidents: IncidentsService,
    private readonly config: ConfigService,
  ) {}

  async handleIncomingMessage(phone: string, text: string) {
    if (text === 'HELP' || text === 'HI' || text === 'HELLO') {
      await this.send(phone, HELP_TEXT);
      return;
    }

    if (text === 'STOP') {
      await this.unsubscribe(phone);
      return;
    }

    if (text === 'STATUS') {
      await this.sendStatus(phone);
      return;
    }

    if (text === 'DIGEST') {
      await this.sendDigest(phone);
      return;
    }

    if (text.startsWith('ALERT ')) {
      const suburb = text.replace('ALERT ', '').trim();
      await this.subscribe(phone, suburb);
      return;
    }

    if (text.startsWith('REPORT ')) {
      await this.handleReport(phone, text.replace('REPORT ', ''));
      return;
    }

    await this.send(phone, `I didn't understand that. Send *HELP* for a list of commands.`);
  }

  private async handleReport(phone: string, reportText: string) {
    // Simple NLP: first word is category, rest is description
    // e.g. "THEFT car stolen Fourways Mall parking lot"
    const words = reportText.toLowerCase().split(' ');
    const categoryMap: Record<string, string> = {
      theft: 'theft', stolen: 'theft', rob: 'robbery', robbery: 'robbery',
      burglary: 'burglary', assault: 'assault', attack: 'assault',
      suspicious: 'suspicious_activity', drugs: 'drug_activity',
      accident: 'road_accident', vandal: 'vandalism',
    };

    let category = 'other';
    for (const word of words) {
      if (categoryMap[word]) {
        category = categoryMap[word];
        break;
      }
    }

    const description = reportText;

    // Find subscriber's area
    const { data: subscriber } = await this.supabase.client
      .from('whatsapp_subscribers')
      .select('area_id')
      .eq('phone', phone)
      .single();

    if (!subscriber?.area_id) {
      await this.send(phone, `📍 First subscribe to an area: *ALERT Fourways*\nThen I'll know where to report this.`);
      return;
    }

    // Get area centroid as approximate location
    const { data: area } = await this.supabase.client
      .from('areas')
      .select('centroid, name')
      .eq('id', subscriber.area_id)
      .single();

    if (!area) {
      await this.send(phone, `Couldn't find your area. Try *ALERT <suburb>* again.`);
      return;
    }

    // Parse centroid coordinates
    // Supabase returns WKT: "POINT(lng lat)"
    const coords = area.centroid?.match(/POINT\(([^ ]+) ([^ )]+)\)/);
    if (!coords) {
      await this.send(phone, `Location error. Please try again.`);
      return;
    }

    const lng = parseFloat(coords[1]);
    const lat = parseFloat(coords[2]);

    // Create incident (anonymous, via WhatsApp)
    await this.supabase.client.from('incidents').insert({
      category,
      title: `[WhatsApp] ${description.substring(0, 100)}`,
      description,
      location: `SRID=4326;POINT(${lng} ${lat})`,
      is_anonymous: true,
      whatsapp_source: true,
    });

    await this.send(
      phone,
      `✅ Report received for *${area.name}*.\nCategory: *${category}*\n\nThank you for keeping your community safe.`,
    );
  }

  private async subscribe(phone: string, suburbName: string) {
    // Find area by name (case-insensitive)
    const { data: area } = await this.supabase.client
      .from('areas')
      .select('id, name')
      .ilike('name', suburbName)
      .single();

    if (!area) {
      await this.send(phone, `❌ Suburb "*${suburbName}*" not found.\n\nAvailable suburbs: Fourways, Sandton, Randburg, Soweto, Alexandra, Midrand`);
      return;
    }

    await this.supabase.client
      .from('whatsapp_subscribers')
      .upsert({ phone, area_id: area.id, active: true }, { onConflict: 'phone' });

    await this.send(phone, `✅ Subscribed to crime alerts for *${area.name}*.\n\nYou'll receive alerts when verified incidents are reported nearby.\n\nSend *STOP* to unsubscribe.`);
  }

  private async unsubscribe(phone: string) {
    await this.supabase.client
      .from('whatsapp_subscribers')
      .update({ active: false })
      .eq('phone', phone);

    await this.send(phone, `✅ Unsubscribed. You won't receive alerts.\n\nSend *ALERT <suburb>* to re-subscribe.`);
  }

  private async sendStatus(phone: string) {
    const { data } = await this.supabase.client
      .from('whatsapp_subscribers')
      .select('active, areas(name)')
      .eq('phone', phone)
      .single();

    if (!data || !data.active) {
      await this.send(phone, `You're not subscribed to any area.\n\nSend *ALERT Fourways* to subscribe.`);
      return;
    }

    const areaName = (data.areas as any)?.name || 'Unknown';
    await this.send(phone, `📍 You're subscribed to: *${areaName}*\n\nSend *STOP* to unsubscribe.`);
  }

  private async sendDigest(phone: string) {
    // Get subscriber's area
    const { data: sub } = await this.supabase.client
      .from('whatsapp_subscribers')
      .select('area_id')
      .eq('phone', phone)
      .single();

    if (!sub?.area_id) {
      await this.send(phone, `Subscribe to an area first: *ALERT Fourways*`);
      return;
    }

    // Get latest digest for this area
    const { data: digest } = await this.supabase.client
      .from('digests')
      .select('content, week_start')
      .eq('area_id', sub.area_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!digest) {
      await this.send(phone, `No digest available yet. Digests are generated every Monday morning.`);
      return;
    }

    // Trim content for WhatsApp (max 4096 chars)
    const content = digest.content.substring(0, 4000);
    await this.send(phone, `📊 *Weekly Crime Digest* (${digest.week_start})\n\n${content}`);
  }

  async send(to: string, message: string) {
    const token = this.config.get('WHATSAPP_ACCESS_TOKEN');
    const phoneId = this.config.get('WHATSAPP_PHONE_NUMBER_ID');

    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message },
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp message to ${to}`, err?.response?.data);
    }
  }

  // Called by AlertsService to broadcast an alert to area subscribers
  async broadcastAlert(areaId: string, message: string) {
    const { data: subscribers } = await this.supabase.client
      .from('whatsapp_subscribers')
      .select('phone')
      .eq('area_id', areaId)
      .eq('active', true);

    if (!subscribers?.length) return;

    this.logger.log(`Broadcasting WhatsApp alert to ${subscribers.length} subscribers in area ${areaId}`);

    // Send in batches of 10 to avoid rate limits
    const batches = chunk(subscribers, 10);
    for (const batch of batches) {
      await Promise.allSettled(batch.map((s: any) => this.send(s.phone, message)));
      await sleep(500); // 500ms between batches
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
