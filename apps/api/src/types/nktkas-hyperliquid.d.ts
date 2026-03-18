declare module '@nktkas/hyperliquid/signing' {
  import type { Account } from 'viem/accounts';

  export interface SignL1ActionParams {
    wallet: Account;
    action: unknown;
    nonce: number;
    isTestnet?: boolean;
    vaultAddress?: string;
    expiresAfter?: number;
  }

  export function signL1Action(params: SignL1ActionParams): Promise<{
    r: `0x${string}`;
    s: `0x${string}`;
    v: 27 | 28;
  }>;
}
