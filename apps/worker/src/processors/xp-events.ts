import type { Job } from 'bullmq';

import { prisma } from '@dreamapi/db';
import { isHip3Symbol } from '@dreamapi/hyperliquid';
import { getConfig } from '@dreamapi/config';
import type { XpEventJob } from '@dreamapi/queue';

const REFERRAL_PASSTHROUGH_RATE = 0.1;
const MAX_REFERRAL_DEPTH = 3;

/**
 * BullMQ processor for XP events. Calculates XP from trade volume,
 * applies HIP-3 multiplier, writes XpEvent, and propagates to referrers.
 */
export async function processXpEventJob(job: Job<XpEventJob>): Promise<void> {
  const { userId, volumeUsd, symbol, tradeId } = job.data;

  const config = getConfig();
  const xpPerDollar = config.XP_PER_DOLLAR;
  const hip3Multiplier = config.HIP3_XP_MULTIPLIER;
  const passthroughRate = config.REFERRAL_PASSTHROUGH_RATE;
  const maxDepth = config.MAX_REFERRAL_DEPTH;

  let baseXp = Math.floor(volumeUsd * xpPerDollar);
  if (isHip3Symbol(symbol)) {
    baseXp = Math.floor(baseXp * hip3Multiplier);
  }

  if (baseXp < 1) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.xpEvent.create({
      data: {
        userId,
        amount: baseXp,
        reason: 'trade',
        tradeId,
      },
    });

    let currentUserId = userId;
    let amountToPropagate = baseXp;

    for (let level = 1; level <= maxDepth; level++) {
      const referral = await tx.referral.findFirst({
        where: { refereeId: currentUserId },
        select: { referrerId: true },
      });

      if (!referral) break;

      const propagatedAmount = Math.floor(amountToPropagate * passthroughRate);
      if (propagatedAmount < 1) break;

      await tx.xpEvent.create({
        data: {
          userId: referral.referrerId,
          amount: propagatedAmount,
          reason: `referral_l${level}`,
          tradeId: null,
        },
      });

      currentUserId = referral.referrerId;
      amountToPropagate = propagatedAmount;
    }
  });
}
