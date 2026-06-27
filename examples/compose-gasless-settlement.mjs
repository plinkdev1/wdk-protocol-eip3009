// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.
//
// Runnable example: compose EIP-3009 as the gasless settlement leg of a sibling
// `@tetherto/wdk-protocol-*` flow. Here a SWAP wants to spend the user's USDt;
// instead of an approve+transfer (gas), the user signs one authorization and a
// relayer settles it gas-free. All offline — no RPC, no real funds, no SDK.
// Run with: `node examples/compose-gasless-settlement.mjs`.

import { Wallet } from 'ethers'
import {
  composeSettlementPlan,
  settlementToRelayRequest,
  relayAuthorization,
  TRANSFER_WITH_AUTHORIZATION
} from '../index.js'

// 1. The user's wallet (in a real app, a `@tetherto/wdk-wallet-evm` account).
const user = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

// 2. USDt on Ethereum — the token's EIP-712 domain (name/version inline, no RPC).
const USDT_DOMAIN = {
  name: 'Tether USD',
  version: '1',
  chainId: 1,
  verifyingContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
}

// 3. A sibling SWAP module returns a quote whose user-funding leg spends up to
//    100 USDt to the router. We only model the narrow shape the seam reads — this
//    file imports no swap SDK.
const swapQuote = {
  spender: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // swap router/escrow
  maxAmountIn: 100_000_000n, // 100 USDt (6 decimals) cap
  amountOut: 31_500_000_000_000_000n, // ~0.0315 ETH out (illustrative)
  tokenOut: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
}

// 4. Compose the swap action with its gasless USDt settlement leg. The user will
//    sign ONE authorization to fund the swap input — no separate approve, no gas.
const plan = composeSettlementPlan({
  protocol: 'swap',
  action: swapQuote,
  domain: USDT_DOMAIN,
  from: user.address,
  validBefore: Math.floor(Date.now() / 1000) + 3600,
  primaryType: TRANSFER_WITH_AUTHORIZATION
})

console.log('Composed settlement leg (USDt the swap will pull):')
console.log({ protocol: plan.protocol, to: plan.leg.to, value: plan.leg.value.toString() })

// 5. The user signs the settlement typed data (gas-free).
const signature = await user.signTypedData(plan.settlement.domain, plan.settlement.types, plan.settlement.message)
console.log('\nUser signed the settlement (no gas, no approve). sig:', signature.slice(0, 22) + '…')

// 6. The signed leg drops straight into the relayer, which pays gas and submits
//    `transferWithAuthorization` on the USDt contract (broadcast injected here).
const relayReq = settlementToRelayRequest({ settlement: plan.settlement, signature })
const result = await relayAuthorization({
  ...relayReq,
  domain: USDT_DOMAIN,
  submitTransaction: async (tx) => {
    console.log('\nRelayer submits to USDt:', { to: tx.to, data: tx.data.slice(0, 26) + '…' })
    return { txHash: '0xexample' }
  }
})

console.log('\nSettled gaslessly. payer:', result.payer, 'tx:', result.txHash)
console.log('The swap module then executes against the funded input. ✅')
