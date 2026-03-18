import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import { getConfig } from '@dreamapi/config';

export async function verifyWebhook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const rawBody = (request as FastifyRequest & { rawBody?: string | Buffer })
    .rawBody;

  if (!rawBody) {
    throw new UnauthorizedError(
      'INVALID_SIGNATURE',
      'Raw body is required for webhook verification. Register fastify-raw-body on webhook routes.',
    );
  }

  const signature = request.headers['x-signature-256'];

  if (typeof signature !== 'string' || !signature) {
    throw new UnauthorizedError(
      'INVALID_SIGNATURE',
      'x-signature-256 header is required',
    );
  }

  const config = getConfig();
  const expectedSignature =
    'sha256=' +
    createHmac('sha256', config.WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new UnauthorizedError(
      'INVALID_SIGNATURE',
      'Webhook signature verification failed',
    );
  }
}
