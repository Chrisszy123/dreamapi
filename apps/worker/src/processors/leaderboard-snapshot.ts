import type { Job } from 'bullmq';
import Redis from 'ioredis';

import { prisma } from '@dreamapi/db';
import { loadConfig } from '@dreamapi/config';
import type { LeaderboardSnapshotJob } from '@dreamapi/queue';

const LEADERBOARD_KEY = 'leaderboard:global';
const LEADERBOARD_LIMIT = 100;

/**
 * BullMQ processor for leaderboard snapshot. Aggregates XP by user,
 * replaces leaderboard:global sorted set with top 100.
 */
export async function processLeaderboardSnapshotJob(
  _job: Job<LeaderboardSnapshotJob>,
): Promise<void> {
  const results = await prisma.xpEvent.groupBy({
    by: ['userId'],
    _sum: { amount: true },
    orderBy: [{ _sum: { amount: 'desc' } }],
    take: LEADERBOARD_LIMIT,
  });

  const config = loadConfig();
  const redis = new Redis(config.REDIS_URL);

  try {
    await redis.del(LEADERBOARD_KEY);

    if (results.length > 0) {
      const members: (string | number)[] = [];
      for (const row of results) {
        const totalXp = row._sum.amount ?? 0;
        if (row.userId != null) {
          members.push(totalXp, row.userId);
        }
      }
      if (members.length > 0) {
        await redis.zadd(LEADERBOARD_KEY, ...members);
      }
    }
  } finally {
    await redis.quit();
  }
}
