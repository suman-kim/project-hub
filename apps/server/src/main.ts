import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { HUB_CONFIG, HubConfig } from './config/hub-config';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  const config = app.get<HubConfig>(HUB_CONFIG);
  await app.listen(config.port, config.host);
  Logger.log(`Hub: http://${config.host}:${config.port}`, 'Main');
}

void main();
