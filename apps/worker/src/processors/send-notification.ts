import type { Job } from 'bullmq';

import { prisma } from '@dreamapi/db';
import type { SendNotificationJob } from '@dreamapi/queue';
import { sendFcmNotification, sendApnsNotification } from '@dreamapi/notifications';

/**
 * BullMQ processor for sending push notifications. Triggered when a price alert fires.
 * Sends to FCM (Android) or APNs (iOS) per device. Logs outcome; does not retry on delivery failure.
 */
export async function processSendNotificationJob(
  job: Job<SendNotificationJob>,
): Promise<void> {
  const { userId, symbol, price } = job.data;

  const devices = await prisma.device.findMany({
    where: { userId },
  });

  const title = 'Price Alert';
  const body = `${symbol} is now ${price}`;
  const data = { symbol, price };

  for (const device of devices) {
    if (device.platform === 'android') {
      const result = await sendFcmNotification({
        token: device.pushToken,
        title,
        body,
        data,
      });
      if (!result.ok) {
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        job.log(`FCM failed for device ${device.deviceId}: ${msg}`);
      }
    } else if (device.platform === 'ios') {
      const result = await sendApnsNotification({
        deviceToken: device.pushToken,
        title,
        body,
        data,
      });
      if (!result.ok) {
        const msg = result.error instanceof Error ? result.error.message : String(result.error);
        job.log(`APNs failed for device ${device.deviceId}: ${msg}`);
      }
    }
  }
}
