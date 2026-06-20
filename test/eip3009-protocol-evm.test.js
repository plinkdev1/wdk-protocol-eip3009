// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { isHexString } from 'ethers'

import Eip3009ProtocolEvm, { encodeTransferWithAuthorization } from '../index.js'
import { TEST_ADDRESS, TEST_TOKEN, createMockAccount, createReadOnlyMockAccount } from './helpers.js'

const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

test('constructor rejects an account without getAddress', (t) => {
  t.exception(() => new Eip3009ProtocolEvm({}), /getAddress/)
  t.exception(() => new Eip3009ProtocolEvm(null), /getAddress/)
})

test('signTransferAuthorization returns a complete, verifiable authorization', async (t) => {
  const account = createMockAccount()
  const protocol = new Eip3009ProtocolEvm(account)

  const auth = await protocol.signTransferAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 1_000_000n })

  t.is(auth.kind, 'transfer')
  t.is(auth.from, TEST_ADDRESS, 'from is the signer')
  t.is(auth.to, RECIPIENT)
  t.is(auth.value, 1_000_000n)
  t.is(auth.token, TEST_TOKEN.address)
  t.is(auth.validAfter, 0n, 'defaults validAfter to 0')
  t.ok(auth.validBefore > 0n, 'sets a validBefore in the future')
  t.ok(isHexString(auth.nonce, 32), 'has a 32-byte nonce')
  t.ok(isHexString(auth.signature), 'has a signature')
  t.ok(auth.v === 27 || auth.v === 28, 'has a valid v')
  t.ok(protocol.verifyAuthorization(auth), 'authorization verifies against from')
})

test('signReceiveAuthorization sets the receive primary type', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createMockAccount())
  const auth = await protocol.signReceiveAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 5n })
  t.is(auth.kind, 'receive')
  t.is(auth.primaryType, 'ReceiveWithAuthorization')
  t.ok(protocol.verifyAuthorization(auth))
})

test('signCancelAuthorization produces a verifiable cancellation', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createMockAccount())
  const nonce = protocol.generateNonce()
  const cancellation = await protocol.signCancelAuthorization({ token: TEST_TOKEN, nonce })
  t.is(cancellation.authorizer, TEST_ADDRESS)
  t.is(cancellation.nonce, nonce)
  t.ok(protocol.verifyAuthorization(cancellation), 'cancellation verifies')
})

test('custom validAfter / validBefore / nonce are honored', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createMockAccount())
  const nonce = protocol.generateNonce()
  const auth = await protocol.signTransferAuthorization({
    token: TEST_TOKEN,
    to: RECIPIENT,
    value: 1n,
    validAfter: 100,
    validBefore: 200,
    nonce
  })
  t.is(auth.validAfter, 100n)
  t.is(auth.validBefore, 200n)
  t.is(auth.nonce, nonce)
})

test('buildTransferTransaction encodes the on-chain call', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createMockAccount())
  const auth = await protocol.signTransferAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 42n })
  const tx = protocol.buildTransferTransaction(auth)
  t.is(tx.to, TEST_TOKEN.address, 'targets the token contract')
  t.is(tx.value, 0n)
  t.is(tx.data, encodeTransferWithAuthorization(auth), 'data matches the encoder')
})

test('submitTransferAuthorization broadcasts via the account', async (t) => {
  const account = createMockAccount()
  const protocol = new Eip3009ProtocolEvm(account)
  const auth = await protocol.signTransferAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 7n })

  const result = await protocol.submitTransferAuthorization(auth)
  t.is(account.sent.length, 1, 'one transaction sent')
  t.is(account.sent[0].tx.to, TEST_TOKEN.address)
  t.ok(isHexString(result.hash), 'returns the transaction result')
})

test('quoteTransferAuthorization returns a fee without sending', async (t) => {
  const account = createMockAccount()
  const protocol = new Eip3009ProtocolEvm(account)
  const auth = await protocol.signTransferAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 7n })
  const { fee } = await protocol.quoteTransferAuthorization(auth)
  t.is(fee, 21000n)
  t.is(account.sent.length, 0, 'nothing was broadcast')
})

test('verifyAuthorization fails on a tampered amount', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createMockAccount())
  const auth = await protocol.signTransferAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 100n })
  const tampered = { ...auth, value: 999n }
  t.absent(protocol.verifyAuthorization(tampered), 'tampered authorization does not verify')
})

test('read-only account cannot sign', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createReadOnlyMockAccount())
  await t.exception(
    protocol.signTransferAuthorization({ token: TEST_TOKEN, to: RECIPIENT, value: 1n }),
    /sign typed data/
  )
})

test('chainId is resolved from the account when the descriptor omits it', async (t) => {
  const account = createMockAccount({ chainId: 137n })
  const protocol = new Eip3009ProtocolEvm(account)
  const auth = await protocol.signTransferAuthorization({
    token: { address: TEST_TOKEN.address, name: TEST_TOKEN.name, version: TEST_TOKEN.version },
    to: RECIPIENT,
    value: 1n
  })
  t.is(auth.domain.chainId, 137n, 'domain chainId comes from account.getChainId()')
})

test('getAuthorizationState requires a provider', async (t) => {
  const protocol = new Eip3009ProtocolEvm(createMockAccount())
  await t.exception(
    protocol.getAuthorizationState({ token: TEST_TOKEN.address, authorizer: TEST_ADDRESS, nonce: protocol.generateNonce() }),
    /provider is required/
  )
})
