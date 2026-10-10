import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

function assertRequiredEnv(): void {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error('Missing required environment variables: ' + missing.join(', '));
  }
  if ((process.env.JWT_SECRET ?? '').length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
}

async function bootstrap(): Promise<void> {
  assertRequiredEnv();

  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86400,
  });

  // BigInt (bank balances) is not JSON serializable by default.
  (BigInt.prototype as any).toJSON = function toJSON() {
    return Number(this);
  };

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log('MoiLedger API listening on http://localhost:' + port + '/api');
  logger.log('Allowed origins: ' + origins.join(', '));
}

void bootstrap();
