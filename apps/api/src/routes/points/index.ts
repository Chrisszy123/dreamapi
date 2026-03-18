import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import {
  registerReferral,
  getLeaderboard,
  getUserPoints,
} from '../../services/points.service.js';
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

const leaderboardEntrySchema = {
  type: 'object',
  properties: {
    rank: { type: 'number' },
    userId: { type: 'string' },
    walletAddress: { type: 'string' },
    totalXp: { type: 'number' },
  },
  required: ['rank', 'userId', 'walletAddress', 'totalXp'],
} as const;

const xpEventSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    amount: { type: 'number' },
    reason: { type: 'string' },
    tradeId: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'userId', 'amount', 'reason', 'createdAt'],
} as const;

const userPointsSummarySchema = {
  type: 'object',
  properties: {
    totalXp: { type: 'number' },
    rank: { type: 'number' },
    referralCount: { type: 'number' },
    referralCode: { type: 'string' },
    recentEvents: { type: 'array', items: xpEventSchema },
  },
  required: ['totalXp', 'rank', 'referralCount', 'referralCode', 'recentEvents'],
} as const;

async function pointsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  app.post<{
    Body: { referralCode: string };
  }>(
    '/referrals/register',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Register with a referral code',
        tags: ['points'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['referralCode'],
          properties: {
            referralCode: { type: 'string', description: 'Referral code to register with' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { ok: { type: 'boolean', const: true } },
            required: ['ok'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const { referralCode } = request.body;

      const result = await registerReferral(user.id, referralCode, app.prisma);

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'REFERRAL_REGISTRATION_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Referral registration failed',
        });
      }

      return reply.send({ ok: true });
    },
  );

  app.get(
    '/leaderboard',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Get top 100 users by XP',
        tags: ['points'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'array',
            items: leaderboardEntrySchema,
          },
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await getLeaderboard(app.redis, app.prisma);

      if (!result.ok) {
        return reply.status(500).send({
          code: 'LEADERBOARD_FETCH_FAILED',
          message: result.error instanceof Error ? result.error.message : 'Failed to fetch leaderboard',
        });
      }

      return reply.send(result.data);
    },
  );

  app.get(
    '/me/points',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Get current user points summary',
        tags: ['points'],
        security: [{ bearerAuth: [] }],
        response: {
          200: userPointsSummarySchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;

      const result = await getUserPoints(user.id, app.redis, app.prisma);

      if (!result.ok) {
        return reply.status(500).send({
          code: 'POINTS_FETCH_FAILED',
          message: result.error instanceof Error ? result.error.message : 'Failed to fetch points',
        });
      }

      return reply.send(result.data);
    },
  );
}

export default fp(pointsRoutes, {
  name: 'points-routes',
});
