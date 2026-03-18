import type { Result } from '@dreamapi/types';

export type { Result };

export interface MarketMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

export interface AssetContext {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: string[];
}

export interface MetaAndAssetCtx {
  universe: MarketMeta[];
  assetCtxs: AssetContext[];
}

export interface L2BookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface L2BookSnapshot {
  coin: string;
  levels: [L2BookLevel[], L2BookLevel[]];
  time: number;
}

export interface UserPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  leverage: {
    type: string;
    value: number;
  };
}

export interface UserState {
  assetPositions: { position: UserPosition }[];
  crossMarginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
}

export interface OrderRequest {
  asset: number;
  isBuy: boolean;
  limitPx: string;
  sz: string;
  reduceOnly: boolean;
  orderType: {
    limit: {
      tif: 'Gtc' | 'Ioc' | 'Alo';
    };
  };
}

export interface OrderResponse {
  status: string;
  response: {
    type: string;
    data: {
      statuses: Array<{
        resting?: { oid: number };
        filled?: { totalSz: string; avgPx: string; oid: number };
        error?: string;
      }>;
    };
  };
}

export interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
}

export interface WsAllMids {
  mids: Record<string, string>;
}

export interface WsL2Book {
  coin: string;
  levels: [L2BookLevel[], L2BookLevel[]];
  time: number;
}

export interface WsUserFills {
  user: string;
  fills: Fill[];
}

export type HyperliquidWsEvent =
  | { channel: 'allMids'; data: WsAllMids }
  | { channel: 'l2Book'; data: WsL2Book }
  | { channel: 'userFills'; data: WsUserFills };

export const HIP3_SYMBOLS = [
  'AAPL',
  'AMZN',
  'GOOGL',
  'TSLA',
  'NVDA',
  'META',
  'MSFT',
  'HOOD',
  'INTC',
  'GOLD',
  'SILVER',
  'COPPER',
  'USA500',
] as const;

export type Hip3Symbol = (typeof HIP3_SYMBOLS)[number];

export function isHip3Symbol(symbol: string): symbol is Hip3Symbol {
  return (HIP3_SYMBOLS as readonly string[]).includes(symbol);
}
