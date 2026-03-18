import type { Job } from 'bullmq';
import Redis from 'ioredis';

import { prisma } from '@dreamapi/db';
import { loadConfig } from '@dreamapi/config';
import { createSendNotificationQueue } from '@dreamapi/queue';
import type { AlertCheckerJob, SendNotificationJob } from '@dreamapi/queue';

/**
 * BullMQ processor for alert checker. Runs every 30 seconds.
 * Finds all untriggered PriceAlerts, checks Redis prices, enqueues sendNotification when threshold crossed.
 */
export async function processAlertCheckerJob(
  _job: Job<AlertCheckerJob>,
): Promise<void> {
  const config = loadConfig();
  const redis = new Redis(config.REDIS_URL);

  const sendNotificationQueue = createSendNotificationQueue();

  try {
    const alerts = await prisma.priceAlert.findMany({
      where: { triggeredAt: null },
    });

    for (const alert of alerts) {
      const priceStr = await redis.get(`market:mid:${alert.symbol}`);
      if (!priceStr) continue;

      const price = parseFloat(priceStr);
      const threshold = Number(alert.threshold);

      const shouldTrigger =
        (alert.direction === 'above' && price >= threshold) ||
        (alert.direction === 'below' && price <= threshold);

      if (shouldTrigger) {
        await prisma.priceAlert.update({
          where: { id: alert.id },
          data: { triggeredAt: new Date() },
        });

        const job: SendNotificationJob = {
          userId: alert.userId,
          alertId: alert.id,
          symbol: alert.symbol,
          price: priceStr,
        };

        await sendNotificationQueue.add('send', job);
      }
    }
  } finally {
    await redis.quit();
  }
}
