import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import {
  getAllMarkets,
  getOrderbook,
  getPrice,
} from '../../services/market.service.js';
import { NotFoundError } from '../../errors.js';

const marketInfoSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    markPx: { type: 'string' },
    openInterest: { type: 'string' },
    marketType: { type: 'string', enum: ['perp', 'hip3'] },
  },
  required: ['symbol', 'markPx', 'openInterest', 'marketType'],
} as const;

const l2BookLevelSchema = {
  type: 'object',
  properties: {
    px: { type: 'string' },
    sz: { type: 'string' },
    n: { type: 'number' },
  },
  required: ['px', 'sz', 'n'],
} as const;

const l2BookSnapshotSchema = {
  type: 'object',
  properties: {
    coin: { type: 'string' },
    levels: {
      type: 'array',
      items: {
        type: 'array',
        items: l2BookLevelSchema,
      },
      minItems: 2,
      maxItems: 2,
    },
    time: { type: 'number' },
  },
  required: ['coin', 'levels', 'time'],
} as const;

const priceResponseSchema = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    price: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['symbol', 'price', 'updatedAt'],
} as const;

const errorResponseSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['code', 'message'],
} as const;

async function marketsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.get(
    '/markets',
    {
      schema: {
        description: 'List all markets with current prices and open interest',
        tags: ['markets'],
        response: {
          200: {
            type: 'array',
            items: marketInfoSchema,
          },
          500: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const redis = app.redis;
      const restClient = app.hyperliquidRestClient;

      const result = await getAllMarkets(redis, restClient);

      if (!result.ok) {
        return reply.status(500).send({
          code: 'MARKET_FETCH_FAILED',
          message: result.error instanceof Error ? result.error.message : 'Failed to fetch markets',
        });
      }

      return reply.send(result.data);
    },
  );

  app.get<{ Params: { symbol: string } }>(
    '/markets/:symbol/orderbook',
    {
      schema: {
        description: 'Get orderbook for a market',
        tags: ['markets'],
        params: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Market symbol (e.g. BTC, ETH)' },
          },
          required: ['symbol'],
        },
        response: {
          200: l2BookSnapshotSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { symbol } = request.params;
      const redis = app.redis;
      const restClient = app.hyperliquidRestClient;

      const result = await getOrderbook(symbol, redis, restClient);

      if (!result.ok) {
        const err = result.error;
        return reply.status(500).send({
          code: 'ORDERBOOK_FETCH_FAILED',
          message: err instanceof Error ? err.message : 'Failed to fetch orderbook',
        });
      }

      return reply.send(result.data);
    },
  );

  app.get<{ Params: { symbol: string } }>(
    '/markets/:symbol/price',
    {
      schema: {
        description: 'Get current mid price for a market',
        tags: ['markets'],
        params: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Market symbol (e.g. BTC, ETH)' },
          },
          required: ['symbol'],
        },
        response: {
          200: priceResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { symbol } = request.params;
      const redis = app.redis;

      const result = await getPrice(symbol, redis);

      if (!result.ok) {
        const err = result.error;
        const code = err instanceof NotFoundError ? err.code : 'MARKET_NOT_FOUND';
        const message = err instanceof Error ? err.message : 'Market not found';
        return reply.status(404).send({ code, message });
      }

      return reply.send(result.data);
    },
  );
}

export default fp(marketsRoutes, {
  name: 'markets-routes',
});
