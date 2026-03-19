// scripts/get-test-token.ts
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const TRADING_PRIVATE_KEY = '0x384'
const account = privateKeyToAccount(TRADING_PRIVATE_KEY)

// 1. Get nonce
const nonceRes = await fetch('http://localhost:3000/auth/nonce', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress: account.address })
})
const { nonce, issuedAt } = await nonceRes.json() as { nonce: string; issuedAt: string }

// 2. Sign it — domain, types, and primaryType must match the server exactly
const signature = await account.signTypedData({
  domain: { name: 'DreamAPI', version: '1' },
  types: { Auth: [{ name: 'nonce', type: 'string' }, { name: 'issued_at', type: 'string' }] },
  primaryType: 'Auth',
  message: { nonce, issued_at: issuedAt }
})
// 3. Verify and print token
const verifyRes = await fetch('http://localhost:3000/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress: account.address, signature })
})
console.log('Verify response:', verifyRes)

const { accessToken } = await verifyRes.json() as { accessToken: string }

console.log('\nPaste this into Swagger Authorize:\n')
console.log(`Bearer ${accessToken}`)