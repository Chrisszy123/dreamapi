import type Redis from 'ioredis';

import type { HyperliquidWsClient } from '@dreamapi/hyperliquid';

const MARKET_MID_PREFIX = 'market:mid:';
const MARKET_BOOK_PREFIX = 'market:book:';
const CACHE_TTL_SECONDS = 2;

/**
 * Connects to HyperliquidWsClient and writes market data to Redis.
 * - allMids: pipelines SET market:mid:{symbol} {price} EX 2 for each symbol
 * - l2Book: SET market:book:{coin} {JSON} EX 2
 */
export function startMarketCacheWriter(
  wsClient: HyperliquidWsClient,
  redis: Redis,
  logger?: { error: (obj: unknown, msg?: string) => void },
): void {
  const logError = (err: unknown, msg: string): void => {
    if (logger) {
      logger.error({ err }, msg);
    } else {
      console.error(`[market-cache] ${msg}`, err);
    }
  };

  const l2BookSubscribed = new Set<string>();

  wsClient.on('allMids', (data) => {
    const { mids } = data;
    if (!mids || typeof mids !== 'object') return;

    const pipeline = redis.pipeline();
    for (const [symbol, price] of Object.entries(mids)) {
      if (symbol && price != null) {
        pipeline.set(`${MARKET_MID_PREFIX}${symbol}`, price, 'EX', CACHE_TTL_SECONDS);
      }
    }
    pipeline.exec().catch((err) => {
      logError(err, 'Failed to write allMids to Redis');
    });

    // Subscribe to l2Book for each symbol on first allMids (one-time)
    for (const symbol of Object.keys(mids)) {
      if (symbol && !l2BookSubscribed.has(symbol)) {
        l2BookSubscribed.add(symbol);
        wsClient.subscribeL2Book(symbol);
      }
    }
  });

  wsClient.on('disconnected', () => {
    l2BookSubscribed.clear();
  });

  wsClient.on('l2Book', (data) => {
    const { coin, levels, time } = data;
    if (!coin) return;

    const snapshot = JSON.stringify({ coin, levels, time });
    redis
      .setex(`${MARKET_BOOK_PREFIX}${coin}`, CACHE_TTL_SECONDS, snapshot)
      .catch((err) => {
        logError(err, 'Failed to write l2Book to Redis');
      });
  });
}
