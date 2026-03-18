export interface XpEventJob {
  userId: string;
  volumeUsd: number;
  symbol: string;
  tradeId: string;
}

export interface SendNotificationJob {
  userId: string;
  alertId: string;
  symbol: string;
  price: string;
}

export interface LeaderboardSnapshotJob {
  triggeredAt: string;
}

export interface AlertCheckerJob {
  triggeredAt: string;
}
