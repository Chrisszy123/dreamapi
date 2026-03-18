import pino from 'pino';
import { Worker } from 'bullmq';

import { loadConfig } from '@dreamapi/config';
import {
  initQueueConnection,
  getConnection,
  createAlertCheckerQueue,
  createLeaderboardSnapshotQueue,
} from '@dreamapi/queue';

import { processXpEventJob } from './processors/xp-events.js';
import { processLeaderboardSnapshotJob } from './processors/leaderboard-snapshot.js';
import { processAlertCheckerJob } from './processors/alert-checker.js';
import { processSendNotificationJob } from './processors/send-notification.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });

  initQueueConnection(config.REDIS_URL);
  logger.info('Queue connection initialized');

  const connection = getConnection();

  const alertCheckerQueue = createAlertCheckerQueue();
  const leaderboardSnapshotQueue = createLeaderboardSnapshotQueue();

  await alertCheckerQueue.add(
    'check',
    { triggeredAt: new Date().toISOString() },
    { repeat: { every: 30_000 } },
  );
  await leaderboardSnapshotQueue.add(
    'snapshot',
    { triggeredAt: new Date().toISOString() },
    { repeat: { pattern: '0 0 * * *' } },
  );
  logger.info('Repeatable jobs scheduled: alertChecker (30s), leaderboardSnapshot (midnight UTC)');

  const xpEventsWorker = new Worker(
    'xpEvents',
    async (job) => processXpEventJob(job),
    {
      connection,
      concurrency: 5,
    },
  );

  const leaderboardSnapshotWorker = new Worker(
    'leaderboardSnapshot',
    async (job) => processLeaderboardSnapshotJob(job),
    {
      connection,
      concurrency: 1,
    },
  );

  const alertCheckerWorker = new Worker(
    'alertChecker',
    async (job) => processAlertCheckerJob(job),
    {
      connection,
      concurrency: 1,
    },
  );

  const sendNotificationWorker = new Worker(
    'sendNotification',
    async (job) => processSendNotificationJob(job),
    {
      connection,
      concurrency: 5,
    },
  );

  xpEventsWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'XP event job completed');
  });

  xpEventsWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'XP event job failed');
  });

  leaderboardSnapshotWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Leaderboard snapshot job completed');
  });

  leaderboardSnapshotWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Leaderboard snapshot job failed');
  });

  alertCheckerWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Alert checker job completed');
  });

  alertCheckerWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Alert checker job failed');
  });

  sendNotificationWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Send notification job completed');
  });

  sendNotificationWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Send notification job failed');
  });

  logger.info('DreamAPI Worker started');

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down worker...');
    await Promise.all([
      xpEventsWorker.close(),
      leaderboardSnapshotWorker.close(),
      alertCheckerWorker.close(),
      sendNotificationWorker.close(),
    ]);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
