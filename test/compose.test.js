// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { Wallet } from 'ethers'

import {
  toSettlementLeg,
  buildGaslessSettlement,
  composeSettlementPlan,
  settlementToRelayRequest,
  relayAuthorization,
  recoverAuthorizationSigner,
  generateNonce,
  RECEIVE_WITH_AUTHORIZATION,
  TRANSFER_WITH_AUTHORIZATION
} from '../index.js'
import { TEST_DOMAIN, TEST_PRIVATE_KEY, TEST_ADDRESS } from './helpers.js'

const POOL = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const NOW = 1_000_000

test('toSettlementLeg reads to/value across sibling-module field shapes', (t) => {
  // swap-style: spender + maxAmountIn
  t.alike(toSettlementLeg({ spender: POOL, maxAmountIn: 2_000_000n }), { to: POOL, value: 2_000_000n })
  // lending-style: pool + amount (numeric string)
  t.alike(toSettlementLeg({ pool: POOL, amount: '1500000' }), { to: POOL, value: 1_500_000n })
  // bridge-style: router + amountIn (number)
  t.alike(toSettlementLeg({ router: POOL, amountIn: 1000000 }), { to: POOL, value: 1_000_000n })
  // explicit { to, value } wins
  t.alike(toSettlementLeg({ to: POOL, value: 42n, spender: '0xdead' }), { to: POOL, value: 42n })
})

test('toSettlementLeg throws when the address or amount is missing', (t) => {
  t.exception(() => toSettlementLeg({ amount: 1n }), /no settlement address/)
  t.exception(() => toSettlementLeg({ pool: POOL }), /no USDt amount/)
  t.exception(() => toSettlementLeg(null), /must be an object/)
  t.exception(() => toSettlementLeg({ pool: POOL, amount: 1.5 }), /must be an integer/)
})

test('buildGaslessSettlement defaults to ReceiveWithAuthorization and signs/recovers', async (t) => {
  const leg = { to: POOL, value: 1_000_000n }
  const built = buildGaslessSettlement({ domain: TEST_DOMAIN, from: TEST_ADDRESS, leg, validBefore: NOW + 3600 })

  t.is(built.primaryType, RECEIVE_WITH_AUTHORIZATION)
  t.is(built.message.from, TEST_ADDRESS)
  t.is(built.message.to, POOL)
  t.is(built.message.value, 1_000_000n)
  t.ok(/^0x[0-9a-f]{64}$/i.test(built.message.nonce))

  // The user signs the typed data; it recovers to the user.
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const signature = await wallet.signTypedData(built.domain, built.types, built.message)
  const signer = recoverAuthorizationSigner(TEST_DOMAIN, built.primaryType, built.message, signature)
  t.is(signer.toLowerCase(), TEST_ADDRESS.toLowerCase())
})

test('buildGaslessSettlement requires an expiry and rejects a bad primaryType', (t) => {
  const leg = { to: POOL, value: 1n }
  t.exception(() => buildGaslessSettlement({ domain: TEST_DOMAIN, from: TEST_ADDRESS, leg }), /validBefore.*required/)
  t.exception(
    () => buildGaslessSettlement({ domain: TEST_DOMAIN, from: TEST_ADDRESS, leg, validBefore: NOW + 1, primaryType: 'Nope' }),
    /unsupported primaryType/
  )
})

test('composeSettlementPlan: swap action → gasless leg → relay (end to end)', async (t) => {
  // A fake swap provider result: spend up to 2 USDt to the spender for the swap.
  const swapAction = { spender: POOL, maxAmountIn: 2_000_000n, amountOut: 999n, tokenOut: '0xToken' }

  const plan = composeSettlementPlan({
    protocol: 'swap',
    action: swapAction,
    domain: TEST_DOMAIN,
    from: TEST_ADDRESS,
    validBefore: NOW + 3600,
    // Bind to TransferWithAuthorization so the open relayer below can submit it.
    primaryType: TRANSFER_WITH_AUTHORIZATION,
    nonce: generateNonce()
  })

  t.is(plan.protocol, 'swap')
  t.alike(plan.leg, { to: POOL, value: 2_000_000n })
  t.is(plan.action, swapAction)

  // User signs the settlement leg.
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const signature = await wallet.signTypedData(plan.settlement.domain, plan.settlement.types, plan.settlement.message)

  // The signed leg drops straight into the relayer.
  const relayReq = settlementToRelayRequest({ settlement: plan.settlement, signature })
  const calls = []
  const result = await relayAuthorization({
    ...relayReq,
    domain: TEST_DOMAIN, // relayer reads the token address off the domain
    submitTransaction: async (tx) => { calls.push(tx); return { txHash: '0xbeef' } },
    now: NOW
  })

  t.is(result.txHash, '0xbeef')
  t.is(result.payer, TEST_ADDRESS)
  t.is(calls.length, 1)
  t.is(calls[0].to, TEST_DOMAIN.verifyingContract) // settles on the USDt contract
})

test('settlementToRelayRequest validates its inputs', (t) => {
  t.exception(() => settlementToRelayRequest({ settlement: null, signature: '0x1' }), /settlement.*required/)
  t.exception(() => settlementToRelayRequest({ settlement: { message: {} }, signature: '' }), /signature is required/)
})
