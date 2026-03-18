import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { verifyTypedData, isAddress } from 'viem';
import type { Address, Hex } from 'viem';
import type { PrismaClient, User } from '@dreamapi/db';
import type Redis from 'ioredis';
import type { Result } from '@dreamapi/types';
import { UnauthorizedError, ValidationError } from '../errors.js';

const EIP712_DOMAIN = {
  name: 'DreamAPI',
  version: '1',
} as const;

const EIP712_TYPES = {
  Auth: [
    { name: 'nonce', type: 'string' },
    { name: 'issued_at', type: 'string' },
  ],
} as const;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function generateNonce(
  walletAddress: string,
  redis: Redis,
): Promise<Result<{ nonce: string; expiresAt: string; issuedAt: string }>> {
  if (!isAddress(walletAddress)) {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_WALLET',
        'Invalid or non-checksummed wallet address',
      ),
    };
  }

  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  const key = `auth:nonce:${walletAddress}`;
  const stored = JSON.stringify({ nonce, issued_at: issuedAt });
  await redis.set(key, stored, 'EX', 300);

  return { ok: true, data: { nonce, expiresAt, issuedAt } };
}

export async function verifyWalletSignature(
  walletAddress: string,
  signature: string,
  redis: Redis,
  prisma: PrismaClient,
): Promise<Result<User>> {
  if (!isAddress(walletAddress)) {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_WALLET',
        'Invalid or non-checksummed wallet address',
      ),
    };
  }

  const key = `auth:nonce:${walletAddress}`;
  const storedRaw = await redis.get(key);

  if (!storedRaw) {
    return {
      ok: false,
      error: new UnauthorizedError(
        'NONCE_EXPIRED',
        'Nonce expired or not found',
      ),
    };
  }

  let stored: { nonce: string; issued_at: string };
  try {
    stored = JSON.parse(storedRaw) as { nonce: string; issued_at: string };
  } catch {
    return {
      ok: false,
      error: new UnauthorizedError(
        'NONCE_EXPIRED',
        'Invalid nonce format',
      ),
    };
  }

  const valid = await verifyTypedData({
    address: walletAddress as Address,
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: 'Auth',
    message: {
      nonce: stored.nonce,
      issued_at: stored.issued_at,
    },
    signature: signature as Hex,
  });

  if (!valid) {
    return {
      ok: false,
      error: new UnauthorizedError(
        'INVALID_SIGNATURE',
        'Signature verification failed',
      ),
    };
  }

  await redis.del(key);

  const user = await prisma.user.upsert({
    where: { walletAddress },
    create: { walletAddress },
    update: {},
  });

  return { ok: true, data: user };
}

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('hex');
  const hash = hashToken(raw);
  return { raw, hash };
}

export async function createSessionRecord(
  userId: string,
  deviceId: string,
  refreshTokenHash: string,
  prisma: PrismaClient,
): Promise<Result<{ sessionId: string }>> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      deviceId,
      refreshTokenHash,
      expiresAt,
    },
  });

  return { ok: true, data: { sessionId: session.id } };
}

export async function findSessionByToken(
  refreshToken: string,
  prisma: PrismaClient,
): Promise<
  Result<{ userId: string; sessionId: string; walletAddress: string }>
> {
  const hash = hashToken(refreshToken);

  const session = await prisma.session.findFirst({
    where: {
      refreshTokenHash: hash,
      revokedAt: null,
    },
    include: { user: true },
  });

  if (!session) {
    return {
      ok: false,
      error: new UnauthorizedError(
        'SESSION_NOT_FOUND',
        'Session not found or revoked',
      ),
    };
  }

  if (session.expiresAt < new Date()) {
    return {
      ok: false,
      error: new UnauthorizedError(
        'SESSION_EXPIRED',
        'Session has expired',
      ),
    };
  }

  return {
    ok: true,
    data: {
      userId: session.userId,
      sessionId: session.id,
      walletAddress: session.user.walletAddress,
    },
  };
}

export async function revokeSession(
  refreshToken: string,
  prisma: PrismaClient,
): Promise<Result<{ revoked: boolean }>> {
  const hash = hashToken(refreshToken);

  const session = await prisma.session.findFirst({
    where: { refreshTokenHash: hash },
  });

  if (!session) {
    return {
      ok: false,
      error: new UnauthorizedError(
        'SESSION_NOT_FOUND',
        'Session not found or already revoked',
      ),
    };
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  return { ok: true, data: { revoked: true } };
}
