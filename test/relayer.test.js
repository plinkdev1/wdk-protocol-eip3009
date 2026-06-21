// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { Wallet } from 'ethers'

import {
  relayAuthorization,
  buildAuthorizationMessage,
  buildDomain,
  getAuthorizationTypes,
  generateNonce,
  TRANSFER_WITH_AUTHORIZATION
} from '../index.js'
import { TEST_DOMAIN, TEST_PRIVATE_KEY, TEST_ADDRESS } from './helpers.js'

const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const NOW = 1_000_000

async function signedAuthorization (over = {}) {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const message = buildAuthorizationMessage({
    from: TEST_ADDRESS, to: TO, value: 1000000n, validAfter: 0, validBefore: NOW + 3600, nonce: generateNonce(), ...over
  })
  const domain = buildDomain(TEST_DOMAIN)
  const signature = await wallet.signTypedData(domain, getAuthorizationTypes(TRANSFER_WITH_AUTHORIZATION), message)
  return { domain: TEST_DOMAIN, message, signature }
}

test('relayAuthorization verifies the signer and submits to the token', async (t) => {
  const { domain, message, signature } = await signedAuthorization()
  const calls = []
  const submitTransaction = async (tx) => { calls.push(tx); return { txHash: '0xfeed' } }

  const result = await relayAuthorization({ domain, message, signature, submitTransaction, now: NOW })

  t.is(result.txHash, '0xfeed')
  t.is(result.payer, TEST_ADDRESS)
  t.is(calls.length, 1)
  t.is(calls[0].to, TEST_DOMAIN.verifyingContract) // submits to the token contract
  t.ok(/^0x[0-9a-f]+$/i.test(calls[0].data)) // ABI-encoded transferWithAuthorization
})

test('relayAuthorization rejects a signature that does not match message.from', async (t) => {
  const { domain, message, signature } = await signedAuthorization()
  const tampered = { ...message, from: TO } // claim a different holder
  await t.exception(
    () => relayAuthorization({ domain, message: tampered, signature, submitTransaction: async () => ({ txHash: '0x1' }), now: NOW }),
    /does not match message.from/
  )
})

test('relayAuthorization rejects an expired authorization (does not submit)', async (t) => {
  const { domain, message, signature } = await signedAuthorization({ validBefore: NOW - 1 })
  let submitted = false
  await t.exception(
    () => relayAuthorization({ domain, message, signature, submitTransaction: async () => { submitted = true; return { txHash: '0x1' } }, now: NOW }),
    /expired/
  )
  t.absent(submitted)
})

test('relayAuthorization rejects an unsupported primaryType and a missing submitter', async (t) => {
  const { domain, message, signature } = await signedAuthorization()
  await t.exception(() => relayAuthorization({ domain, primaryType: 'Nope', message, signature, submitTransaction: async () => ({ txHash: '0x1' }), now: NOW }))
  await t.exception(() => relayAuthorization({ domain, message, signature, submitTransaction: undefined, now: NOW }))
})
