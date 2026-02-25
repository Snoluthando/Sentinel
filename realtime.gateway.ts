// =============================================================================
// CrimeNet SA — Real-Time WebSocket Gateway
// File: backend/src/realtime/realtime.gateway.ts
// Broadcasts live incident updates to connected dashboard and app clients
// =============================================================================

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtWsGuard } from '../auth/jwt-ws.guard';

@WebSocketGateway({
  cors: {
    origin: '*',  // Lock down to your domains in production
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private connectedClients = new Map<string, { areaIds: string[]; role: string }>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.connectedClients.set(client.id, { areaIds: [], role: 'community' });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.connectedClients.delete(client.id);
    client.rooms.forEach((room) => client.leave(room));
  }

  // ---------------------------------------------------------------------------
  // Client subscribes to a specific area's live feed
  // Clients are grouped into rooms by area ID
  // ---------------------------------------------------------------------------
  @SubscribeMessage('subscribe_area')
  handleSubscribeArea(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { area_id: string; auth_token?: string },
  ) {
    const room = `area:${data.area_id}`;
    client.join(room);

    const clientData = this.connectedClients.get(client.id) || { areaIds: [], role: 'community' };
    clientData.areaIds.push(data.area_id);
    this.connectedClients.set(client.id, clientData);

    this.logger.log(`Client ${client.id} subscribed to ${room}`);
    return { event: 'subscribed', data: { room } };
  }

  @SubscribeMessage('unsubscribe_area')
  handleUnsubscribeArea(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { area_id: string },
  ) {
    client.leave(`area:${data.area_id}`);
    return { event: 'unsubscribed', data: { area_id: data.area_id } };
  }

  // ---------------------------------------------------------------------------
  // Broadcast a new verified incident to all clients in the affected area
  // Called by IncidentsService / AlertsService after verification
  // ---------------------------------------------------------------------------
  broadcastNewIncident(areaId: string, incident: any) {
    // B2B operators get exact location; community gets fuzzy
    this.server.to(`area:${areaId}`).emit('new_incident', {
      ...incident,
      // Send fuzzy location to public room; exact location handled per-role server-side
      location: incident.location_fuzzy || incident.location,
    });

    this.logger.log(`Broadcast new incident ${incident.id} to area ${areaId}`);
  }

  // Broadcast a hotspot update (AI-generated)
  broadcastHotspotUpdate(areaId: string, hotspot: any) {
    this.server.to(`area:${areaId}`).emit('hotspot_update', hotspot);
  }

  // Broadcast panic button event to operators in the area
  broadcastPanic(areaId: string, panicEvent: any) {
    this.server.to(`area:${areaId}:operators`).emit('panic_alert', panicEvent);
  }

  // Send a targeted message to a specific client
  sendToClient(clientId: string, event: string, data: any) {
    this.server.to(clientId).emit(event, data);
  }

  getConnectedCount() {
    return this.connectedClients.size;
  }
}
