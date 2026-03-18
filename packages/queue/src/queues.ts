import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

import type {
  XpEventJob,
  SendNotificationJob,
  LeaderboardSnapshotJob,
  AlertCheckerJob,
} from './types.js';

let connection: ConnectionOptions | undefined;

export function initQueueConnection(redisUrl: string): void {
  const url = new URL(redisUrl);
  connection = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  };
}

export function getConnection(): ConnectionOptions {
  if (!connection) {
    throw new Error(
      'Queue connection not initialized. Call initQueueConnection() first.',
    );
  }
  return connection;
}

export function createXpEventsQueue(): Queue<XpEventJob> {
  return new Queue<XpEventJob>('xpEvents', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
}

export function createSendNotificationQueue(): Queue<SendNotificationJob> {
  return new Queue<SendNotificationJob>('sendNotification', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
}

export function createAlertCheckerQueue(): Queue<AlertCheckerJob> {
  return new Queue<AlertCheckerJob>('alertChecker', {
    connection: getConnection(),
  });
}

export function createLeaderboardSnapshotQueue(): Queue<LeaderboardSnapshotJob> {
  return new Queue<LeaderboardSnapshotJob>('leaderboardSnapshot', {
    connection: getConnection(),
  });
}
