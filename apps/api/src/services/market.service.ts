import type Redis from 'ioredis';

import type { Result } from '@dreamapi/types';
import {
  type HyperliquidRestClient,
  type L2BookSnapshot,
  isHip3Symbol,
} from '@dreamapi/hyperliquid';

import { NotFoundError } from '../errors.js';

const MARKET_MID_PREFIX = 'market:mid:';
const MARKET_BOOK_PREFIX = 'market:book:';
const CACHE_TTL_SECONDS = 2;

export interface MarketInfo {
  symbol: string;
  markPx: string;
  openInterest: string;
  marketType: 'perp' | 'hip3';
}

/**
 * Scans Redis for market:mid:* keys to get cached prices.
 * Always fetches meta+assetCtxs from REST for openInterest and universe structure.
 * Overlays Redis prices when cache is warm for fresher markPx.
 */
export async function getAllMarkets(
  redis: Redis,
  restClient: HyperliquidRestClient,
): Promise<Result<MarketInfo[]>> {
  const metaResult = await restClient.getMetaAndAssetCtxs();
  if (!metaResult.ok) {
    return { ok: false, error: metaResult.error };
  }

  const { universe, assetCtxs } = metaResult.data;

  // Collect cached prices from Redis when available
  const cachedPrices = new Map<string, string>();
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `${MARKET_MID_PREFIX}*`,
      'COUNT',
      500,
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      const values = await redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = values[i];
        if (key?.startsWith(MARKET_MID_PREFIX) && value != null) {
          const symbol = key.slice(MARKET_MID_PREFIX.length);
          cachedPrices.set(symbol, value);
        }
      }
    }
  } while (cursor !== '0');

  const markets: MarketInfo[] = universe.map((meta, index) => {
    const ctx = assetCtxs[index];
    const markPx = cachedPrices.get(meta.name) ?? ctx?.markPx ?? '0';
    const openInterest = ctx?.openInterest ?? '0';

    return {
      symbol: meta.name,
      markPx,
      openInterest,
      marketType: isHip3Symbol(meta.name) ? 'hip3' : 'perp',
    };
  });

  return { ok: true, data: markets };
}

/**
 * Gets orderbook from Redis cache. On miss, fetches from REST and caches with 2s TTL.
 */
export async function getOrderbook(
  symbol: string,
  redis: Redis,
  restClient: HyperliquidRestClient,
): Promise<Result<L2BookSnapshot>> {
  const key = `${MARKET_BOOK_PREFIX}${symbol}`;
  const cached = await redis.get(key);

  if (cached != null) {
    try {
      const parsed = JSON.parse(cached) as L2BookSnapshot;
      return { ok: true, data: parsed };
    } catch {
      // Invalid JSON in cache — fall through to REST
    }
  }

  const result = await restClient.getL2Snapshot(symbol);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(result.data));

  return { ok: true, data: result.data };
}

/**
 * Gets current mid price from Redis cache.
 */
export async function getPrice(
  symbol: string,
  redis: Redis,
): Promise<Result<{ symbol: string; price: string; updatedAt: string }>> {
  const key = `${MARKET_MID_PREFIX}${symbol}`;
  const price = await redis.get(key);

  if (price == null) {
    return {
      ok: false,
      error: new NotFoundError(
        'MARKET_NOT_FOUND',
        `No price data for symbol: ${symbol}`,
        { symbol },
      ),
    };
  }

  const ttl = await redis.ttl(key);
  const estimatedMsAgo = ttl > 0 ? (CACHE_TTL_SECONDS - ttl) * 1000 : 0;
  const updatedAt = new Date(Date.now() - estimatedMsAgo).toISOString();

  return {
    ok: true,
    data: {
      symbol,
      price,
      updatedAt,
    },
  };
}
