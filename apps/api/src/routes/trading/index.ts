import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '@dreamapi/config';

import {
  submitOrder,
  getTradeHistory,
  getPositions,
  getPortfolioHistory,
} from '../../services/trading.service.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { AppError } from '../../errors.js';

const errorResponseSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['code', 'message'],
} as const;

const orderResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    response: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            statuses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  resting: { type: 'object', properties: { oid: { type: 'number' } } },
                  filled: {
                    type: 'object',
                    properties: {
                      totalSz: { type: 'string' },
                      avgPx: { type: 'string' },
                      oid: { type: 'number' },
                    },
                  },
                  error: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
  required: ['status', 'response'],
} as const;

const tradeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    symbol: { type: 'string' },
    side: { type: 'string' },
    size: { type: 'string' },
    price: { type: 'string' },
    volumeUsd: { type: 'string' },
    filledAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'userId', 'symbol', 'side', 'size', 'price', 'volumeUsd', 'filledAt'],
} as const;

const positionSchema = {
  type: 'object',
  properties: {
    coin: { type: 'string' },
    szi: { type: 'string' },
    entryPx: { type: 'string' },
    positionValue: { type: 'string' },
    unrealizedPnl: { type: 'string' },
    returnOnEquity: { type: 'string' },
    leverage: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        value: { type: 'number' },
      },
    },
  },
  required: ['coin', 'szi', 'entryPx', 'positionValue', 'unrealizedPnl', 'returnOnEquity', 'leverage'],
} as const;

async function tradingRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.post<{
    Body: {
      asset: string;
      isBuy: boolean;
      limitPx: string;
      sz: string;
      orderType: { limit: { tif: 'Gtc' | 'Ioc' | 'Alo' } };
    };
  }>(
    '/orders',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Submit a limit order',
        tags: ['trading'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['asset', 'isBuy', 'limitPx', 'sz', 'orderType'],
          properties: {
            asset: { type: 'string', description: 'Market symbol (e.g. BTC, ETH)' },
            isBuy: { type: 'boolean', description: 'true for long, false for short' },
            limitPx: { type: 'string', description: 'Limit price' },
            sz: { type: 'string', description: 'Size in base currency units' },
            orderType: {
              type: 'object',
              required: ['limit'],
              properties: {
                limit: {
                  type: 'object',
                  required: ['tif'],
                  properties: {
                    tif: { type: 'string', enum: ['Gtc', 'Ioc', 'Alo'] },
                  },
                },
              },
            },
          },
        },
        response: {
          200: orderResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const { asset, isBuy, limitPx, sz, orderType } = request.body;

      const result = await submitOrder(
        { asset, isBuy, limitPx, sz, orderType },
        user.walletAddress,
        app.hyperliquidRestClient,
        (app as FastifyInstance & { config: Env }).config,
        app.redis,
      );

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'ORDER_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Order submission failed',
        });
      }

      return reply.send(result.data);
    },
  );

  app.get<{
    Querystring: { page?: string; limit?: string; symbol?: string };
  }>(
    '/orders',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Get trade history with pagination',
        tags: ['trading'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string', description: 'Page number (default 1)' },
            limit: { type: 'string', description: 'Page size (max 50)' },
            symbol: { type: 'string', description: 'Filter by symbol' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: { type: 'array', items: tradeSchema },
              total: { type: 'number' },
              page: { type: 'number' },
              limit: { type: 'number' },
            },
            required: ['data', 'total', 'page', 'limit'],
          },
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const page = request.query.page ? parseInt(request.query.page, 10) : undefined;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
      const symbol = request.query.symbol;

      const params: { page?: number; limit?: number; symbol?: string } = {};
      if (page !== undefined) params.page = page;
      if (limit !== undefined) params.limit = limit;
      if (symbol !== undefined) params.symbol = symbol;
      const result = await getTradeHistory(user.id, params, app.prisma);

      if (!result.ok) {
        return reply.status(500).send({
          code: 'TRADE_HISTORY_FAILED',
          message: result.error instanceof Error ? result.error.message : 'Failed to fetch trade history',
        });
      }

      return reply.send(result.data);
    },
  );

  app.get(
    '/positions',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Get live positions from Hyperliquid',
        tags: ['trading'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: positionSchema,
          },
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;

      const result = await getPositions(user.walletAddress, app.hyperliquidRestClient);

      if (!result.ok) {
        return reply.status(500).send({
          code: 'POSITIONS_FETCH_FAILED',
          message: result.error instanceof Error ? result.error.message : 'Failed to fetch positions',
        });
      }

      return reply.send(result.data);
    },
  );

  app.get<{
    Querystring: { from: string; to: string };
  }>(
    '/portfolio/history',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Get portfolio history for a date range',
        tags: ['trading'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['from', 'to'],
          properties: {
            from: { type: 'string', format: 'date', description: 'Start date (ISO)' },
            to: { type: 'string', format: 'date', description: 'End date (ISO)' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              trades: { type: 'array', items: tradeSchema },
              volumeUsd: { type: 'string' },
              pnl: { type: 'string' },
            },
            required: ['trades', 'volumeUsd', 'pnl'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const { from, to } = request.query;

      const result = await getPortfolioHistory(user.id, from, to, app.prisma);

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'PORTFOLIO_HISTORY_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Failed to fetch portfolio history',
        });
      }

      return reply.send(result.data);
    },
  );
}

export default fp(tradingRoutes, {
  name: 'trading-routes',
});
