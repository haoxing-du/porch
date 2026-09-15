import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type pg from 'pg';
import type { Config } from './config';
import { Problem } from './core';
import { authRoutes } from './auth';
import { chatRoutes, type Schedule } from './chat';
import { attachmentRoutes } from './attachments';
import { realtimeRoutes } from './realtime';
import { Storage } from './storage';
import { Relay } from './relay';
import { hostRoutes } from './hosts';
declare module 'fastify' {
  interface FastifyInstance {
    relay: Relay;
  }
}
export async function createApp(db: pg.Pool, cfg: Config, options: { schedule?: Schedule } = {}) {
  if (
    cfg.devAuth &&
    (cfg.production ||
      !['localhost', '127.0.0.1'].includes(new URL(cfg.origin).hostname) ||
      !['127.0.0.1', 'localhost', '::1'].includes(cfg.host))
  )
    throw new Error('Development sign-in requires a local, non-production server.');
  const app = Fastify({ bodyLimit: 128 * 1024, logger: false });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  await app.register(multipart, { limits: { fileSize: cfg.maxFileBytes, files: 1, fields: 2 } });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    const origin = req.headers.origin;
    if (origin && origin !== cfg.origin)
      throw new Problem(403, 'This request came from another site.');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['sec-fetch-site'] === 'cross-site'
    )
      throw new Problem(403, 'This request came from another site.');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Check the request fields.',
        details: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    const code = (error as { code?: string }).code;
    if (code === '23505') return reply.code(409).send({ error: 'This name is already in use.' });
    const status =
      error instanceof Problem
        ? error.statusCode
        : ((error as { statusCode?: number }).statusCode ?? 500);
    if (status >= 500)
      console.error('Request failed', {
        requestId: req.id,
        code: code ?? (error instanceof Error ? error.name : 'unknown'),
      });
    return reply.code(status).send({
      error:
        status >= 500
          ? 'The service could not complete this request. Try again.'
          : error instanceof Error
            ? error.message
            : 'Request failed.',
    });
  });
  await authRoutes(app, db, cfg);
  const relay = new Relay(db, cfg);
  app.decorate('relay', relay);
  chatRoutes(app, db, cfg, options.schedule ?? relay.schedule);
  hostRoutes(app, db, relay, new Storage(cfg));
  app.addHook('onClose', async () => {
    for (const socket of relay.connections.values()) socket.close();
    relay.connections.clear();
  });
  attachmentRoutes(app, db, new Storage(cfg));
  realtimeRoutes(app, db);
  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });
  const dist = resolve('dist/web');
  if (existsSync(dist)) {
    await app.register(staticFiles, { root: dist, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found.' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
