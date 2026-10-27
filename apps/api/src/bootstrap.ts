import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { Kysely } from 'kysely';
import { AppModule } from './app.module';
import type { AppConfig } from './config';
import type { Database } from './db/schema';

export async function createApp(config: AppConfig, db: Kysely<Database>): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, db), { logger: ['error', 'warn', 'log'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: config.webOrigin, credentials: false, exposedHeaders: ['Content-Disposition', 'X-Content-SHA256'] });
  app.useBodyParser('json', { limit: '1mb' });
  app.set('trust proxy', config.trustProxy);
  return app;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('Terra Link API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, doc);
}
