import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
});

app.use(bodyParser.json());
 

  // Health check endpoint
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (req: any, res: any) => {
    res.json({
      status: 'ok',
      service: 'CrimeNet SA API',
      timestamp: new Date().toISOString(),
      port: 3001,
    });
  });

  // Incidents endpoint — reads from Supabase directly
  httpAdapter.get('/incidents/nearby', async (req: any, res: any) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      );

      const { lat = -26.0274, lng = 28.0088, radius_m = 2000, hours = 24 } = req.query;
      const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .gte('created_at', since)
        .in('status', ['verified', 'investigating', 'pending'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      res.json({ data: data || [], count: data?.length || 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create incident endpoint
  httpAdapter.post('/incidents', async (req: any, res: any) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      );

      const { category, title, description, lat, lng, anonymous } = req.body;

      if (!category || !title || !lat || !lng) {
        return res.status(400).json({ error: 'category, title, lat, lng are required' });
      }

      const { data, error } = await supabase
        .from('incidents')
        .insert({
          category,
          title,
          description,
          location: `SRID=4326;POINT(${lng} ${lat})`,
          is_anonymous: anonymous || false,
          status: 'pending',
          confirmation_count: 1,
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all areas
  httpAdapter.get('/areas', async (req: any, res: any) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      );

      const { data, error } = await supabase
        .from('areas')
        .select('id, name, city, province')
        .eq('active', true)
        .order('name');

      if (error) throw error;
      res.json({ data: data || [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`🚔 CrimeNet SA API running on http://localhost:${port}`);
  logger.log(`📍 Health check: http://localhost:${port}/health`);
  logger.log(`📋 Incidents: http://localhost:${port}/incidents/nearby`);
  logger.log(`🗺️  Areas: http://localhost:${port}/areas`);
}

bootstrap();
