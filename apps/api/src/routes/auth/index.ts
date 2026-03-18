import type { FastifyInstance } from 'fastify';
import {
  generateNonce,
  verifyWalletSignature,
  generateRefreshToken,
  createSessionRecord,
  findSessionByToken,
  revokeSession,
} from '../../services/auth.service.js';

const ETHEREUM_ADDRESS_PATTERN = '^0x[a-fA-F0-9]{40}$';
const HEX_SIGNATURE_PATTERN = '^0x[a-fA-F0-9]+$';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { walletAddress: string };
  }>(
    '/auth/nonce',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: {
        body: {
          type: 'object',
          required: ['walletAddress'],
          properties: {
            walletAddress: { type: 'string', pattern: ETHEREUM_ADDRESS_PATTERN },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              nonce: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
              issuedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { walletAddress } = request.body;
      const result = await generateNonce(walletAddress, app.redis);

      if (!result.ok) {
        throw result.error;
      }

      return reply.status(200).send(result.data);
    },
  );

  app.post<{
    Body: { walletAddress: string; signature: string };
    Headers: { 'x-device-id'?: string };
  }>(
    '/auth/verify',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: {
        body: {
          type: 'object',
          required: ['walletAddress', 'signature'],
          properties: {
            walletAddress: { type: 'string', pattern: ETHEREUM_ADDRESS_PATTERN },
            signature: { type: 'string', pattern: HEX_SIGNATURE_PATTERN },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  walletAddress: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { walletAddress, signature } = request.body;
      const deviceId = request.headers['x-device-id'] ?? 'unknown';

      const verifyResult = await verifyWalletSignature(
        walletAddress,
        signature,
        app.redis,
        app.prisma,
      );

      if (!verifyResult.ok) {
        throw verifyResult.error;
      }

      const user = verifyResult.data;
      const { raw: refreshToken, hash: refreshTokenHash } =
        generateRefreshToken();

      const sessionResult = await createSessionRecord(
        user.id,
        deviceId,
        refreshTokenHash,
        app.prisma,
      );

      if (!sessionResult.ok) {
        throw sessionResult.error;
      }

      const accessToken = app.jwt.sign(
        { sub: user.id, wallet: user.walletAddress },
        { expiresIn: '15m' },
      );

      return reply.status(200).send({
        accessToken,
        refreshToken,
        user: { id: user.id, walletAddress: user.walletAddress },
      });
    },
  );

  app.post<{
    Body: { refreshToken: string };
  }>(
    '/auth/refresh',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body;

      const sessionResult = await findSessionByToken(refreshToken, app.prisma);

      if (!sessionResult.ok) {
        throw sessionResult.error;
      }

      const { userId, sessionId, walletAddress } = sessionResult.data;

      const { raw: newRefreshToken, hash: newRefreshTokenHash } =
        generateRefreshToken();

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await app.prisma.$transaction([
        app.prisma.session.update({
          where: { id: sessionId },
          data: { revokedAt: new Date() },
        }),
        app.prisma.session.create({
          data: {
            userId,
            deviceId: 'rotated',
            refreshTokenHash: newRefreshTokenHash,
            expiresAt,
          },
        }),
      ]);

      const accessToken = app.jwt.sign(
        { sub: userId, wallet: walletAddress },
        { expiresIn: '15m' },
      );

      return reply.status(200).send({
        accessToken,
        refreshToken: newRefreshToken,
      });
    },
  );

  app.post<{
    Body: { refreshToken: string };
  }>(
    '/auth/logout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', minLength: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              ok: { type: 'boolean', const: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body;

      const result = await revokeSession(refreshToken, app.prisma);

      if (!result.ok) {
        throw result.error;
      }

      return reply.status(200).send({ ok: true });
    },
  );
}
