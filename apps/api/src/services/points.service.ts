import type Redis from 'ioredis';
import type { PrismaClient } from '@dreamapi/db';
import type { Result } from '@dreamapi/types';
import type { XpEvent } from '@dreamapi/db';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors.js';

const LEADERBOARD_KEY = 'leaderboard:global';
const LEADERBOARD_LIMIT = 100;

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  walletAddress: string;
  totalXp: number;
}

export interface UserPointsSummary {
  totalXp: number;
  rank: number;
  referralCount: number;
  referralCode: string;
  recentEvents: XpEvent[];
}

/**
 * Registers a referral: finds code, validates not self/not already referred, creates Referral.
 */
export async function registerReferral(
  userId: string,
  referralCode: string,
  prisma: PrismaClient,
): Promise<Result<{ ok: true }>> {
  const code = referralCode.trim().toUpperCase();
  if (!code) {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_REFERRAL_CODE',
        'Referral code is required',
      ),
    };
  }

  const referralCodeRecord = await prisma.referralCode.findUnique({
    where: { code },
    select: { userId: true },
  });

  if (!referralCodeRecord) {
    return {
      ok: false,
      error: new NotFoundError(
        'REFERRAL_CODE_NOT_FOUND',
        'Referral code does not exist',
        { code },
      ),
    };
  }

  const referrerId = referralCodeRecord.userId;

  if (referrerId === userId) {
    return {
      ok: false,
      error: new ValidationError(
        'SELF_REFERRAL',
        'Cannot use your own referral code',
      ),
    };
  }

  const existingReferral = await prisma.referral.findUnique({
    where: { refereeId: userId },
  });

  if (existingReferral) {
    return {
      ok: false,
      error: new ConflictError(
        'ALREADY_REFERRED',
        'You have already been referred',
      ),
    };
  }

  await prisma.referral.create({
    data: {
      referrerId,
      refereeId: userId,
    },
  });

  return { ok: true, data: { ok: true } };
}

/**
 * Gets leaderboard: ZREVRANGE leaderboard:global 0 99 WITHSCORES, joins with User for walletAddress.
 */
export async function getLeaderboard(
  redis: Redis,
  prisma: PrismaClient,
): Promise<Result<LeaderboardEntry[]>> {
  const raw = await redis.zrange(
    LEADERBOARD_KEY,
    0,
    LEADERBOARD_LIMIT - 1,
    'REV',
    'WITHSCORES',
  );

  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const userId = raw[i];
    const scoreStr = raw[i + 1];
    if (userId != null && scoreStr != null) {
      const totalXp = Math.round(parseFloat(scoreStr));
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true },
      });
      entries.push({
        rank: entries.length + 1,
        userId,
        walletAddress: user?.walletAddress ?? '0x0',
        totalXp,
      });
    }
  }

  return { ok: true, data: entries };
}

/**
 * Gets user points summary: total XP, rank, referral count, referral code, last 20 XP events.
 */
export async function getUserPoints(
  userId: string,
  redis: Redis,
  prisma: PrismaClient,
): Promise<Result<UserPointsSummary>> {
  const [totalResult, rankResult, referralCountResult, referralCodeResult, recentEventsResult] =
    await Promise.all([
      prisma.xpEvent.aggregate({
        where: { userId },
        _sum: { amount: true },
      }),
      redis.zrevrank(LEADERBOARD_KEY, userId),
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referralCode.findUnique({
        where: { userId },
        select: { code: true },
      }),
      prisma.xpEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

  const totalXp = totalResult._sum.amount ?? 0;
  const rank = rankResult !== null ? rankResult + 1 : 0;
  const referralCount = referralCountResult;
  const referralCode = referralCodeResult?.code ?? '';
  const recentEvents = recentEventsResult;

  return {
    ok: true,
    data: {
      totalXp,
      rank,
      referralCount,
      referralCode,
      recentEvents,
    },
  };
}
