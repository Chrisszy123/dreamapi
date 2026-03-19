import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyRateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';

import { loadConfig } from '@dreamapi/config';
import { prisma } from '@dreamapi/db';
import { HyperliquidRestClient, HyperliquidWsClient } from '@dreamapi/hyperliquid';

import { AppError } from './errors.js';
import { startMarketCacheWriter } from './services/market-cache.service.js';
import authRoutes from './routes/auth/index.js';
import marketsRoutes from './routes/markets/index.js';
import tradingRoutes from './routes/trading/index.js';
import pointsRoutes from './routes/points/index.js';
import notificationsRoutes from './routes/notifications/index.js';

export interface BuildAppOptions {
  disableRateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['body.signature', 'body.refreshToken', 'headers.authorization'],
    },
  });

  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  await redis.connect();

  const hyperliquidRestClient = new HyperliquidRestClient();
  const hyperliquidWsClient = new HyperliquidWsClient();

  app.decorate('redis', redis);
  app.decorate('prisma', prisma);
  app.decorate('config', config);
  app.decorate('hyperliquidRestClient', hyperliquidRestClient);
  app.decorate('hyperliquidWsClient', hyperliquidWsClient);

  startMarketCacheWriter(hyperliquidWsClient, redis, app.log);
  hyperliquidWsClient.connect();
  hyperliquidWsClient.subscribeAllMids();

  app.addHook('onClose', async () => {
    hyperliquidWsClient.disconnect();
    await redis.quit();
    await prisma.$disconnect();
  });

  await app.register(fastifyCors, { origin: true });

  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: '15m' },
    formatUser: (payload: { sub: string; wallet: string }) => ({
      id: payload.sub,
      walletAddress: payload.wallet,
    }),
  });

  if (!options.disableRateLimit) {
    await app.register(fastifyRateLimit, {
      max: 100,
      timeWindow: '1 minute',
      redis,
    });
  }

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'DreamAPI',
        description: 'Production backend infrastructure for a Hyperliquid trading app',
        version: '0.0.1',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(authRoutes);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? 'error' : 'warn';
      request.log[level]({ err: error, code: error.code }, error.message);

      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        ...(config.NODE_ENV === 'development' && error.context
          ? { context: error.context }
          : {}),
      });
    }

    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred';

    request.log.error({ err: error }, 'Unhandled error');

    return reply.status(500).send({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        config.NODE_ENV === 'production' ? 'An unexpected error occurred' : message,
    });
  });

  await app.register(marketsRoutes);
  await app.register(tradingRoutes);
  await app.register(pointsRoutes);
  await app.register(notificationsRoutes);

  // Health check
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              version: { type: 'string' },
              uptime: { type: 'number' },
              db: { type: 'string' },
              redis: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              version: { type: 'string' },
              uptime: { type: 'number' },
              db: { type: 'string' },
              redis: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, _reply) => {
      let dbStatus: 'ok' | 'error' = 'ok';
      let redisStatus: 'ok' | 'error' = 'ok';

      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        dbStatus = 'error';
      }

      try {
        await redis.ping();
      } catch {
        redisStatus = 'error';
      }

      const overallStatus = dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded';

      const response = {
        status: overallStatus,
        version: '0.0.1',
        uptime: process.uptime(),
        db: dbStatus,
        redis: redisStatus,
      };

      if (overallStatus === 'degraded') {
        return _reply.status(503).send(response);
      }

      return response;
    },
  );

  return app;
}
