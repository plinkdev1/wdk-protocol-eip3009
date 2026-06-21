// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { Interface, Wallet } from 'ethers'

import {
  buildAuthorizationBatch,
  authorizationBatchToTypedData,
  encodeAuthorizationBatch,
  recoverAuthorizationSigner,
  TRANSFER_WITH_AUTHORIZATION
} from '../index.js'
import { TEST_DOMAIN, TEST_PRIVATE_KEY, TEST_ADDRESS } from './helpers.js'

const A = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'

function items () {
  return [
    { from: TEST_ADDRESS, to: A, value: 1000000n, validAfter: 0, validBefore: 9999999999 },
    { from: TEST_ADDRESS, to: B, value: 2500000n, validAfter: 0, validBefore: 9999999999 }
  ]
}

test('buildAuthorizationBatch generates unique nonces and normalizes', (t) => {
  const messages = buildAuthorizationBatch(items())
  t.is(messages.length, 2)
  t.unlike(messages[0].nonce, messages[1].nonce)
  t.is(messages[0].to, A)
  t.is(messages[1].value, 2500000n)
  for (const m of messages) t.ok(/^0x[0-9a-fA-F]{64}$/.test(m.nonce))
})

test('buildAuthorizationBatch preserves provided nonces and rejects duplicates', (t) => {
  const nonce = '0x' + '11'.repeat(32)
  const [m] = buildAuthorizationBatch([{ ...items()[0], nonce }])
  t.is(m.nonce, nonce)

  t.exception(() => buildAuthorizationBatch([
    { ...items()[0], nonce },
    { ...items()[1], nonce }
  ]))
})

test('buildAuthorizationBatch validates each item and rejects empty', (t) => {
  t.exception(() => buildAuthorizationBatch([]))
  t.exception(() => buildAuthorizationBatch([{ ...items()[0], to: 'bad' }]))
})

test('authorizationBatchToTypedData wraps each message with shared domain/types', (t) => {
  const messages = buildAuthorizationBatch(items())
  const payloads = authorizationBatchToTypedData(TEST_DOMAIN, messages)
  t.is(payloads.length, 2)
  t.ok(payloads[0].types[TRANSFER_WITH_AUTHORIZATION])
  t.is(payloads[0].domain.verifyingContract, payloads[1].domain.verifyingContract)
  t.is(payloads[1].message.nonce, messages[1].nonce)
})

test('full batch round-trip: build → sign each → recover → encode', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const messages = buildAuthorizationBatch(items())
  const payloads = authorizationBatchToTypedData(TEST_DOMAIN, messages)

  const signed = []
  for (const { domain, types, message } of payloads) {
    const signature = await wallet.signTypedData(domain, types, message)
    t.is(recoverAuthorizationSigner(TEST_DOMAIN, TRANSFER_WITH_AUTHORIZATION, message, signature), TEST_ADDRESS)
    signed.push({ ...message, signature })
  }

  const calldata = encodeAuthorizationBatch(signed)
  t.is(calldata.length, 2)

  const iface = new Interface(['function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)'])
  const decoded = iface.decodeFunctionData('transferWithAuthorization', calldata[0])
  t.is(decoded[0], TEST_ADDRESS)
  t.is(decoded[1], A)
  t.is(decoded[2], 1000000n)
})

test('encodeAuthorizationBatch rejects an empty batch', (t) => {
  t.exception(() => encodeAuthorizationBatch([]))
})
