import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type { HyperliquidRestClient } from '@dreamapi/hyperliquid';
import type { HyperliquidWsClient } from '@dreamapi/hyperliquid';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    prisma: PrismaClient;
    hyperliquidRestClient: HyperliquidRestClient;
    hyperliquidWsClient: HyperliquidWsClient;
  }
}
