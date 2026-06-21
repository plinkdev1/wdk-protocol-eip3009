// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { Wallet } from 'ethers'

import {
  buildPaymentRequirements,
  buildPaymentRequiredResponse,
  authorizationForRequirements,
  buildExactPayment,
  encodePaymentHeader,
  decodePaymentHeader,
  verifyExactPayment,
  networkToChainId,
  getAuthorizationTypes,
  buildDomain,
  TRANSFER_WITH_AUTHORIZATION
} from '../index.js'
import { TEST_PRIVATE_KEY, TEST_TOKEN } from './helpers.js'

const PAY_TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

function makeRequirements (overrides = {}) {
  return buildPaymentRequirements({
    network: 'ethereum',
    asset: TEST_TOKEN.address,
    payTo: PAY_TO,
    maxAmountRequired: '10000', // 0.01 USDC (6dp)
    resource: 'https://api.example.com/data',
    name: TEST_TOKEN.name,
    version: TEST_TOKEN.version,
    maxTimeoutSeconds: 120,
    ...overrides
  })
}

// Sign an authorization for requirements the way a wallet/agent would.
async function pay (requirements, wallet, opts = {}) {
  const auth = authorizationForRequirements(requirements, wallet.address, opts)
  const domain = buildDomain({
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId: networkToChainId(requirements.network),
    verifyingContract: requirements.asset
  })
  const signature = await wallet.signTypedData(domain, getAuthorizationTypes(TRANSFER_WITH_AUTHORIZATION), auth)
  return buildExactPayment({ network: requirements.network, signature, authorization: auth })
}

test('networkToChainId resolves names and ids', (t) => {
  t.is(networkToChainId('base'), 8453)
  t.is(networkToChainId('ethereum'), 1)
  t.is(networkToChainId(137), 137)
  t.exception(() => networkToChainId('nope'), /Unknown x402 network/)
})

test('buildPaymentRequiredResponse wraps accepts + version', (t) => {
  const body = buildPaymentRequiredResponse(makeRequirements())
  t.is(body.x402Version, 1)
  t.is(body.accepts.length, 1)
  t.is(body.accepts[0].scheme, 'exact')
  t.is(body.accepts[0].payTo, PAY_TO)
  t.is(body.accepts[0].extra.name, TEST_TOKEN.name)
})

test('X-PAYMENT header round-trips', (t) => {
  const payment = { x402Version: 1, scheme: 'exact', network: 'base', payload: { signature: '0x', authorization: {} } }
  const header = encodePaymentHeader(payment)
  t.is(typeof header, 'string')
  t.alike(decodePaymentHeader(header), payment)
  t.exception(() => decodePaymentHeader(''), /Empty/)
  t.exception(() => decodePaymentHeader('!!!notbase64json'), /Malformed/)
})

test('verifyExactPayment accepts a valid signed payment', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const reqs = makeRequirements()
  const header = encodePaymentHeader(await pay(reqs, wallet))

  const result = verifyExactPayment(decodePaymentHeader(header), reqs)
  t.ok(result.isValid, 'valid payment passes')
  t.is(result.payer, wallet.address, 'recovers the payer')
  t.is(result.invalidReason, null)
})

test('verifyExactPayment rejects tampering and bad params', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const reqs = makeRequirements()
  const payment = await pay(reqs, wallet)

  t.is(verifyExactPayment(payment, makeRequirements({ payTo: '0x000000000000000000000000000000000000dEaD' })).invalidReason, 'wrong_recipient')
  t.is(verifyExactPayment(payment, makeRequirements({ maxAmountRequired: '20000' })).invalidReason, 'insufficient_amount')
  t.is(verifyExactPayment(payment, makeRequirements({ network: 'base' })).invalidReason, 'network_mismatch')

  const tampered = { ...payment, payload: { ...payment.payload, authorization: { ...payment.payload.authorization, value: '1' } } }
  t.is(verifyExactPayment(tampered, reqs).invalidReason, 'signer_mismatch')
})

test('verifyExactPayment rejects expired authorizations', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const reqs = makeRequirements()
  const payment = await pay(reqs, wallet, { now: 1_000_000_000 }) // signed far in the past
  const result = verifyExactPayment(payment, reqs)
  t.absent(result.isValid)
  t.is(result.invalidReason, 'expired')
})
