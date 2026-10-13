/**
 * Boots the real application for end-to-end tests.
 *
 * The app is created from AppModule with the same global prefix, pipes and
 * exception filter as src/main.ts, so these tests exercise production
 * behaviour rather than a simplified wiring. Requests go over real HTTP on an
 * ephemeral port.
 *
 * The only deliberate difference is the rate-limit guard, which is bypassed:
 * a suite making hundreds of calls in a few seconds would otherwise be
 * throttled, and the limit is not what these tests are checking.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

export const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://moi:moi_dev_password@localhost:5433/moi_test?schema=public';

export interface HttpResponse<T = any> {
  status: number;
  body: T;
}

export class E2EContext {
  app!: INestApplication;
  prisma!: PrismaClient;
  baseUrl!: string;

  async start(options: { skipReset?: boolean } = {}): Promise<void> {
    process.env.DATABASE_URL = TEST_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-at-least-32-characters-long!!';
    process.env.GUEST_WEB_URL = 'http://localhost:5173';
    // Rate limiting is real behaviour, but it is not what this suite checks,
    // and a few hundred calls in a few seconds would otherwise trip it.
    process.env.THROTTLE_LIMIT = '1000000';
    process.env.THROTTLE_LOGIN_LIMIT = '1000000';
    process.env.THROTTLE_GUEST_WRITE_LIMIT = '1000000';
    process.env.THROTTLE_GUEST_READ_LIMIT = '1000000';

    // Rebuild the schema from the migration files, which also proves they
    // still apply cleanly to an empty database. A context that only needs to
    // talk to an already prepared database skips this.
    if (!options.skipReset) {
      execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: TEST_URL },
        stdio: 'ignore',
      });
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // APP_GUARD builds its own ThrottlerGuard instance, so the class
      // override alone is not enough; the provider itself has to go.
      .overrideProvider(APP_GUARD)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    this.app = moduleRef.createNestApplication({ bodyParser: true });
    this.app.setGlobalPrefix('api');
    this.app.useGlobalFilters(new AllExceptionsFilter());
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    (BigInt.prototype as any).toJSON = function toJSON() {
      return Number(this);
    };

    await this.app.init();
    await this.app.listen(0);

    const url = await this.app.getUrl();
    // getUrl reports the wildcard address on some platforms.
    this.baseUrl = url.replace('[::1]', '127.0.0.1').replace('0.0.0.0', '127.0.0.1') + '/api';

    this.prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  }

  async stop(): Promise<void> {
    await this.prisma?.$disconnect();
    await this.app?.close();
  }

  async call<T = any>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; form?: FormData } = {},
  ): Promise<HttpResponse<T>> {
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = 'Bearer ' + options.token;

    let payload: any;
    if (options.form) {
      payload = options.form;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(options.body);
    }

    const response = await fetch(this.baseUrl + path, { method, headers, body: payload });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body };
  }

  get(path: string, token?: string) {
    return this.call('GET', path, { token });
  }
  post(path: string, body?: unknown, token?: string) {
    return this.call('POST', path, { body, token });
  }
  patch(path: string, body?: unknown, token?: string) {
    return this.call('PATCH', path, { body, token });
  }

  /** Uploads a statement as multipart, the way the browser does. */
  async upload(
    path: string,
    csv: string,
    fields: Record<string, string>,
    token: string,
    fileName = 'statement.csv',
  ) {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), fileName);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return this.call('POST', path, { token, form });
  }

  async login(email: string, password = 'Password#123'): Promise<string> {
    const response = await this.post('/admin/auth/login', { email, password });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error('login failed for ' + email + ': ' + JSON.stringify(response.body));
    }
    return response.body.accessToken;
  }
}
