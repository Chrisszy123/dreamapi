import type { Result } from '@dreamapi/types';

import type {
  MetaAndAssetCtx,
  L2BookSnapshot,
  UserState,
  OrderResponse,
} from './types.js';

/** Order in Hyperliquid API format (a=asset, b=isBuy, p=price, s=size, r=reduceOnly, t=type) */
export interface HyperliquidOrderAction {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t: { limit: { tif: 'Gtc' | 'Ioc' | 'Alo' } };
}

/** Full order action for exchange endpoint */
export interface OrderExchangeAction {
  type: 'order';
  orders: HyperliquidOrderAction[];
  grouping: 'na';
}

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz';

export class HyperliquidRestClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = HYPERLIQUID_API_URL) {
    this.baseUrl = baseUrl;
  }

  async getMetaAndAssetCtxs(): Promise<Result<MetaAndAssetCtx>> {
    try {
      const response = await fetch(`${this.baseUrl}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: new Error(`Hyperliquid API error: ${response.status}`),
        };
      }

      const data = (await response.json()) as [
        { universe: MetaAndAssetCtx['universe'] },
        MetaAndAssetCtx['assetCtxs'],
      ];

      return {
        ok: true,
        data: { universe: data[0].universe, assetCtxs: data[1] },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async getL2Snapshot(coin: string): Promise<Result<L2BookSnapshot>> {
    try {
      const response = await fetch(`${this.baseUrl}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'l2Book', coin }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: new Error(`Hyperliquid API error: ${response.status}`),
        };
      }

      const data = (await response.json()) as L2BookSnapshot;
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async getUserState(address: string): Promise<Result<UserState>> {
    try {
      const response = await fetch(`${this.baseUrl}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: address }),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: new Error(`Hyperliquid API error: ${response.status}`),
        };
      }

      const data = (await response.json()) as UserState;
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /** ECDSA signature components expected by Hyperliquid exchange API */
  async placeOrder(
    action: OrderExchangeAction,
    signature: { r: `0x${string}`; s: `0x${string}`; v: 27 | 28 },
    nonce: number,
    vaultAddress?: string,
  ): Promise<Result<OrderResponse>> {
    try {
      const payload: Record<string, unknown> = {
        action,
        nonce,
        signature,
      };

      if (vaultAddress) {
        payload['vaultAddress'] = vaultAddress;
      }

      const response = await fetch(`${this.baseUrl}/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return {
          ok: false,
          error: new Error(`Hyperliquid API error: ${response.status}`),
        };
      }

      const data = (await response.json()) as OrderResponse;
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
