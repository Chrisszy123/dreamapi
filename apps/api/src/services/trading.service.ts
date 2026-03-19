import type { PrismaClient } from '@dreamapi/db';
import type { Result } from '@dreamapi/types';
import {
  type HyperliquidRestClient,
  type OrderExchangeAction,
  type OrderResponse,
  type UserPosition,
} from '@dreamapi/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import { signL1Action } from '@nktkas/hyperliquid/signing';

import type { Env } from '@dreamapi/config';
import type { PaginatedResponse } from '@dreamapi/types';
import type { Trade, Prisma } from '@dreamapi/db';

import { ValidationError } from '../errors.js';
import { getAllMarkets } from './market.service.js';

const MAX_LEVERAGE = 40;
const MAX_PAGE_SIZE = 50;

export interface SubmitOrderParams {
  asset: string;
  isBuy: boolean;
  limitPx: string;
  sz: string;
  orderType: { limit: { tif: 'Gtc' | 'Ioc' | 'Alo' } };
}

export interface GetTradeHistoryParams {
  page?: number | undefined;
  limit?: number | undefined;
  symbol?: string | undefined;
}

export interface PortfolioSummary {
  trades: Trade[];
  volumeUsd: string;
  pnl: string;
}

/**
 * Validates asset is in whitelist, validates leverage (max 40x against user equity),
 * signs L1 action, and submits order to Hyperliquid.
 */
export async function submitOrder(
  params: SubmitOrderParams,
  walletAddress: string,
  restClient: HyperliquidRestClient,
  config: Env,
  redis: import('ioredis').default,
): Promise<Result<OrderResponse>> {
  const { asset: symbol, isBuy, limitPx, sz, orderType } = params;

  const marketsResult = await getAllMarkets(redis, restClient);
  if (!marketsResult.ok) {
    return { ok: false, error: marketsResult.error };
  }

  const marketIndex = marketsResult.data.findIndex((m) => m.symbol === symbol);
  if (marketIndex < 0) {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_ASSET',
        `Asset ${symbol} is not in the market whitelist`,
        { symbol },
      ),
    };
  }

  const userStateResult = await restClient.getUserState(walletAddress);
  if (!userStateResult.ok) {
    return { ok: false, error: userStateResult.error };
  }

  const accountValue = parseFloat(
    userStateResult.data.crossMarginSummary.accountValue ?? '0',
  );
  if (accountValue <= 0) {
    return {
      ok: false,
      error: new ValidationError('INSUFFICIENT_EQUITY', 'Account has no equity to trade'),
    };
  }

  const limitPxNum = parseFloat(limitPx);
  const szNum = parseFloat(sz);
  const notional = limitPxNum * szNum;
  const impliedLeverage = notional / accountValue;

  if (impliedLeverage > MAX_LEVERAGE) {
    return {
      ok: false,
      error: new ValidationError(
        'LEVERAGE_EXCEEDED',
        `Implied leverage ${impliedLeverage.toFixed(1)}x exceeds maximum ${MAX_LEVERAGE}x`,
        { impliedLeverage, maxLeverage: MAX_LEVERAGE },
      ),
    };
  }

  const orderAction: OrderExchangeAction = {
    type: 'order',
    orders: [
      {
        a: marketIndex,
        b: isBuy,
        p: limitPx,
        s: sz,
        r: false,
        t: orderType,
      },
    ],
    grouping: 'na',
  };

  const nonce = Date.now();
  const wallet = privateKeyToAccount(config.TRADING_PRIVATE_KEY as `0x${string}`);

  const signature = await signL1Action({
    wallet,
    action: orderAction,
    nonce,
    isTestnet: false,
  });

  return restClient.placeOrder(orderAction, signature, nonce);
}

/**
 * Gets trade history with cursor-based pagination on (userId, filledAt DESC).
 */
export async function getTradeHistory(
  userId: string,
  params: GetTradeHistoryParams,
  prisma: PrismaClient,
): Promise<Result<PaginatedResponse<Trade>>> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, params.limit ?? 20));
  const symbol = params.symbol;

  const where: Prisma.TradeWhereInput = { userId };
  if (symbol) {
    where.symbol = symbol;
  }

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: { filledAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.trade.count({ where }),
  ]);

  return {
    ok: true,
    data: {
      data: trades,
      total,
      page,
      limit,
    },
  };
}

/**
 * Gets live positions from Hyperliquid getUserState.
 */
export async function getPositions(
  walletAddress: string,
  restClient: HyperliquidRestClient,
): Promise<Result<UserPosition[]>> {
  const result = await restClient.getUserState(walletAddress);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const positions = result.data.assetPositions
    .map((ap) => ap.position)
    .filter((p) => parseFloat(p.szi) !== 0);

  return { ok: true, data: positions };
}

/**
 * Gets portfolio history (trades, volume, PnL) for a date range.
 */
export async function getPortfolioHistory(
  userId: string,
  from: string,
  to: string,
  prisma: PrismaClient,
): Promise<Result<PortfolioSummary>> {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_DATE_RANGE',
        'from and to must be valid ISO date strings',
      ),
    };
  }

  if (fromDate > toDate) {
    return {
      ok: false,
      error: new ValidationError(
        'INVALID_DATE_RANGE',
        'from must be before or equal to to',
      ),
    };
  }

  const [trades, aggregates] = await Promise.all([
    prisma.trade.findMany({
      where: {
        userId,
        filledAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { filledAt: 'asc' },
    }),
    prisma.trade.aggregate({
      where: {
        userId,
        filledAt: { gte: fromDate, lte: toDate },
      },
      _sum: { volumeUsd: true },
    }),
  ]);

  const volumeUsd = aggregates._sum.volumeUsd?.toString() ?? '0';

  let pnl = '0';
  if (trades.length > 0) {
    const totalCost = trades.reduce((acc, t) => {
      const cost = Number(t.price) * Number(t.size);
      return acc + (t.side === 'buy' ? cost : -cost);
    }, 0);
    pnl = totalCost.toString();
  }

  return {
    ok: true,
    data: {
      trades,
      volumeUsd,
      pnl,
    },
  };
}
