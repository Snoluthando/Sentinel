import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { createClient } from '@supabase/supabase-js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  app.use(require('body-parser').json());
  const http = app.getHttpAdapter();

  http.get('/health', (_req: any, res: any) => {
    res.json({ status: 'ok', service: 'CrimeNet SA API' });
  });

  http.get('/areas', async (_req: any, res: any) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await sb.from('areas').select('id,name,city').order('name');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  http.get('/incidents/nearby', async (req: any, res: any) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const hours = Number(req.query.hours || 24);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data, error } = await sb
      .from('incidents')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [], count: data?.length || 0 });
  });

  http.post('/incidents', async (req: any, res: any) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { category, title, description, lat, lng } = req.body;
    if (!category || !title || !lat || !lng) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const point = 'SRID=4326;POINT(' + lng + ' ' + lat + ')';
    const { data, error } = await sb
      .from('incidents')
      .insert({
        category,
        title,
        description,
        location: point,
        status: 'pending',
        confirmation_count: 1,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  });

  await app.listen(3001);
  logger.log('CrimeNet SA API running on http://localhost:3001');
  logger.log('Health:    http://localhost:3001/health');
  logger.log('Areas:     http://localhost:3001/areas');
  logger.log('Incidents: http://localhost:3001/incidents/nearby');
}

bootstrap();

