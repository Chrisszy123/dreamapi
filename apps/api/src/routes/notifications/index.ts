import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import fastifyRawBody from 'fastify-raw-body';

import {
  registerDevice,
  createPriceAlert,
  deletePriceAlert,
  processOnrampWebhook,
} from '../../services/notification.service.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { verifyWebhook } from '../../middleware/verifyWebhook.js';
import { AppError } from '../../errors.js';

const errorResponseSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['code', 'message'],
} as const;

async function notificationsRoutes(
  app: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  await app.register(fastifyRawBody, { global: false });

  app.post<{
    Body: { deviceId: string; pushToken: string; platform: 'ios' | 'android' };
  }>(
    '/devices',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Register or update a device for push notifications',
        tags: ['notifications'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['deviceId', 'pushToken', 'platform'],
          properties: {
            deviceId: { type: 'string', description: 'Unique device identifier' },
            pushToken: { type: 'string', description: 'FCM or APNs push token' },
            platform: {
              type: 'string',
              enum: ['ios', 'android'],
              description: 'Device platform',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              userId: { type: 'string' },
              deviceId: { type: 'string' },
              pushToken: { type: 'string' },
              platform: { type: 'string' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'userId', 'deviceId', 'pushToken', 'platform', 'updatedAt'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const { deviceId, pushToken, platform } = request.body;

      const result = await registerDevice(
        user.id,
        deviceId,
        pushToken,
        platform,
        app.prisma,
      );

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'DEVICE_REGISTRATION_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Device registration failed',
        });
      }

      return reply.send(result.data);
    },
  );

  app.post<{
    Body: { symbol: string; threshold: string; direction: 'above' | 'below' };
  }>(
    '/alerts',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Create a price alert',
        tags: ['notifications'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['symbol', 'threshold', 'direction'],
          properties: {
            symbol: { type: 'string', description: 'Market symbol (e.g. BTC, ETH)' },
            threshold: { type: 'string', description: 'Price threshold' },
            direction: {
              type: 'string',
              enum: ['above', 'below'],
              description: 'Alert when price goes above or below threshold',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              userId: { type: 'string' },
              symbol: { type: 'string' },
              threshold: { type: 'string' },
              direction: { type: 'string' },
              triggeredAt: { type: ['string', 'null'], format: 'date-time' },
              createdAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'userId', 'symbol', 'threshold', 'direction', 'createdAt'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const { symbol, threshold, direction } = request.body;

      const result = await createPriceAlert(
        user.id,
        symbol,
        threshold,
        direction,
        app.redis,
        app.prisma,
      );

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'ALERT_CREATION_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Alert creation failed',
        });
      }

      return reply.send(result.data);
    },
  );

  app.delete<{
    Params: { id: string };
  }>(
    '/alerts/:id',
    {
      preHandler: [requireAuth],
      schema: {
        description: 'Delete (soft-delete) a price alert',
        tags: ['notifications'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Alert ID' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { deleted: { type: 'boolean', const: true } },
            required: ['deleted'],
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = (request as { user: { id: string; walletAddress: string } }).user;
      const { id } = request.params;

      const result = await deletePriceAlert(user.id, id, app.prisma);

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'ALERT_DELETE_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Alert delete failed',
        });
      }

      return reply.send(result.data);
    },
  );

  app.post<{
    Body: { walletAddress: string; amountUsd: number; status: string };
  }>(
    '/webhooks/onramp',
    {
      config: { rawBody: true },
      preHandler: [verifyWebhook],
      schema: {
        description: 'Webhook for fiat on-ramp providers (MoonPay/Transak)',
        tags: ['webhooks'],
        body: {
          type: 'object',
          properties: {
            walletAddress: { type: 'string' },
            amountUsd: { type: 'number' },
            status: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { received: { type: 'boolean', const: true } },
            required: ['received'],
          },
          401: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { walletAddress, amountUsd, status } = request.body;

      const result = await processOnrampWebhook(
        { walletAddress, amountUsd, status },
        app.prisma,
      );

      if (!result.ok) {
        const err = result.error;
        const statusCode = err instanceof AppError ? err.statusCode : 500;
        const code = err instanceof AppError ? err.code : 'WEBHOOK_PROCESSING_FAILED';
        return reply.status(statusCode).send({
          code,
          message: err instanceof Error ? err.message : 'Webhook processing failed',
        });
      }

      return reply.send({ received: true });
    },
  );
}

export default fp(notificationsRoutes, {
  name: 'notifications-routes',
});
