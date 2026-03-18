import type Redis from 'ioredis';
import type { PrismaClient, Device, PriceAlert } from '@dreamapi/db';
import type { Result } from '@dreamapi/types';

import { ValidationError, NotFoundError } from '../errors.js';

/**
 * Registers or updates a device for push notifications. Upserts by (userId, deviceId).
 */
export async function registerDevice(
  userId: string,
  deviceId: string,
  pushToken: string,
  platform: string,
  prisma: PrismaClient,
): Promise<Result<Device>> {
  const device = await prisma.device.upsert({
    where: {
      userId_deviceId: { userId, deviceId },
    },
    create: {
      userId,
      deviceId,
      pushToken,
      platform,
    },
    update: {
      pushToken,
      platform,
    },
  });

  return { ok: true, data: device };
}

/**
 * Creates a price alert. Validates symbol has cached price in Redis and direction is 'above' or 'below'.
 */
export async function createPriceAlert(
  userId: string,
  symbol: string,
  threshold: string,
  direction: string,
  redis: Redis,
  prisma: PrismaClient,
): Promise<Result<PriceAlert>> {
  const dir = direction.toLowerCase();
  if (dir !== 'above' && dir !== 'below') {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_DIRECTION',
        "Direction must be 'above' or 'below'",
        { direction },
      ),
    };
  }

  const priceStr = await redis.get(`market:mid:${symbol}`);
  if (!priceStr) {
    return {
      ok: false,
      error: new ValidationError(
        'SYMBOL_NOT_AVAILABLE',
        `Symbol ${symbol} has no cached price. Market may be unavailable.`,
        { symbol },
      ),
    };
  }

  const alert = await prisma.priceAlert.create({
    data: {
      userId,
      symbol,
      threshold,
      direction: dir,
    },
  });

  return { ok: true, data: alert };
}

/**
 * Soft-deletes a price alert by setting triggeredAt = now(). Verifies userId matches.
 */
export async function deletePriceAlert(
  userId: string,
  alertId: string,
  prisma: PrismaClient,
): Promise<Result<{ deleted: boolean }>> {
  const alert = await prisma.priceAlert.findUnique({
    where: { id: alertId },
    select: { userId: true },
  });

  if (!alert) {
    return {
      ok: false,
      error: new NotFoundError('ALERT_NOT_FOUND', 'Price alert not found', {
        alertId,
      }),
    };
  }

  if (alert.userId !== userId) {
    return {
      ok: false,
      error: new NotFoundError('ALERT_NOT_FOUND', 'Price alert not found', {
        alertId,
      }),
    };
  }

  await prisma.priceAlert.update({
    where: { id: alertId },
    data: { triggeredAt: new Date() },
  });

  return { ok: true, data: { deleted: true } };
}

/**
 * Processes onramp webhook payload. Only processes status='completed'.
 * Finds user by walletAddress and writes XpEvent with reason 'deposit'.
 */
export async function processOnrampWebhook(
  payload: { walletAddress: string; amountUsd: number; status: string },
  prisma: PrismaClient,
): Promise<Result<{ processed: boolean }>> {
  if (payload.status !== 'completed') {
    return { ok: true, data: { processed: false } };
  }

  const user = await prisma.user.findUnique({
    where: { walletAddress: payload.walletAddress },
    select: { id: true },
  });

  if (!user) {
    return { ok: true, data: { processed: false } };
  }

  const amount = Math.floor(payload.amountUsd);

  await prisma.xpEvent.create({
    data: {
      userId: user.id,
      amount,
      reason: 'deposit',
    },
  });

  return { ok: true, data: { processed: true } };
}
