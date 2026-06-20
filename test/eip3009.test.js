// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { Interface, TypedDataEncoder, Wallet, isHexString } from 'ethers'

import {
  CANCEL_AUTHORIZATION,
  TRANSFER_WITH_AUTHORIZATION,
  assertNonce,
  buildAuthorizationMessage,
  buildDomain,
  encodeCancelAuthorization,
  encodeTransferWithAuthorization,
  generateNonce,
  getAuthorizationTypes,
  hashAuthorization,
  recoverAuthorizationSigner,
  splitSignature
} from '../index.js'
import { ERC20_EIP3009_ABI } from '../src/erc20-eip3009-abi.js'
import { TEST_DOMAIN, TEST_PRIVATE_KEY } from './helpers.js'

test('generateNonce returns a unique 32-byte hex string', (t) => {
  const a = generateNonce()
  const b = generateNonce()
  t.ok(isHexString(a, 32), 'is a 32-byte hex string')
  t.ok(isHexString(b, 32), 'is a 32-byte hex string')
  t.not(a, b, 'two nonces differ')
})

test('assertNonce rejects non-32-byte values', (t) => {
  t.execution(() => assertNonce(generateNonce()))
  t.exception(() => assertNonce('0x1234'), /32-byte/)
  t.exception(() => assertNonce('not-hex'), /32-byte/)
})

test('buildDomain normalizes and validates', (t) => {
  const domain = buildDomain(TEST_DOMAIN)
  t.is(domain.name, 'USD Coin')
  t.is(domain.version, '2')
  t.is(domain.chainId, 1n, 'chainId coerced to bigint')
  t.is(domain.verifyingContract, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'address checksummed')

  t.exception(() => buildDomain({ ...TEST_DOMAIN, verifyingContract: 'nope' }), /valid address/)
  t.exception(() => buildDomain({ ...TEST_DOMAIN, name: '' }), /name/)
  t.exception(() => buildDomain({ ...TEST_DOMAIN, chainId: undefined }), /chainId/)
})

test('getAuthorizationTypes returns the EIP-3009 field layouts', (t) => {
  const transfer = getAuthorizationTypes(TRANSFER_WITH_AUTHORIZATION)
  t.alike(
    transfer[TRANSFER_WITH_AUTHORIZATION].map((f) => f.name),
    ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']
  )
  const cancel = getAuthorizationTypes(CANCEL_AUTHORIZATION)
  t.alike(cancel[CANCEL_AUTHORIZATION].map((f) => f.name), ['authorizer', 'nonce'])
  t.exception(() => getAuthorizationTypes('Nope'), /Unknown/)
})

test('buildAuthorizationMessage validates inputs', (t) => {
  const base = {
    from: TEST_DOMAIN.verifyingContract,
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    value: 1000000n,
    validAfter: 0,
    validBefore: 9999999999,
    nonce: generateNonce()
  }
  const msg = buildAuthorizationMessage(base)
  t.is(typeof msg.value, 'bigint')
  t.is(msg.validAfter, 0n)

  t.exception(() => buildAuthorizationMessage({ ...base, to: 'bad' }), /'to'/)
  t.exception(() => buildAuthorizationMessage({ ...base, validBefore: 0 }), /validBefore/)
})

test('hashAuthorization matches ethers TypedDataEncoder', (t) => {
  const message = buildAuthorizationMessage({
    from: TEST_DOMAIN.verifyingContract,
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    value: 5n,
    validAfter: 0,
    validBefore: 9999999999,
    nonce: generateNonce()
  })
  const domain = buildDomain(TEST_DOMAIN)
  const expected = TypedDataEncoder.hash(domain, getAuthorizationTypes(TRANSFER_WITH_AUTHORIZATION), message)
  t.is(hashAuthorization(TEST_DOMAIN, TRANSFER_WITH_AUTHORIZATION, message), expected)
})

test('sign and recover round-trip (EIP-712)', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const domain = buildDomain(TEST_DOMAIN)
  const types = getAuthorizationTypes(TRANSFER_WITH_AUTHORIZATION)
  const message = buildAuthorizationMessage({
    from: wallet.address,
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    value: 250000n,
    validAfter: 0,
    validBefore: 9999999999,
    nonce: generateNonce()
  })

  const signature = await wallet.signTypedData(domain, types, message)
  const recovered = recoverAuthorizationSigner(TEST_DOMAIN, TRANSFER_WITH_AUTHORIZATION, message, signature)
  t.is(recovered, wallet.address, 'recovers the original signer')

  const { v, r, s } = splitSignature(signature)
  t.ok(v === 27 || v === 28, 'v is 27 or 28')
  t.ok(isHexString(r, 32) && isHexString(s, 32), 'r and s are 32-byte hex')
})

test('encodeTransferWithAuthorization produces decodable calldata', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const domain = buildDomain(TEST_DOMAIN)
  const message = buildAuthorizationMessage({
    from: wallet.address,
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    value: 1234n,
    validAfter: 0,
    validBefore: 9999999999,
    nonce: generateNonce()
  })
  const signature = await wallet.signTypedData(domain, getAuthorizationTypes(TRANSFER_WITH_AUTHORIZATION), message)

  const data = encodeTransferWithAuthorization({ ...message, signature })
  const iface = new Interface(ERC20_EIP3009_ABI)
  const decoded = iface.decodeFunctionData('transferWithAuthorization', data)
  t.is(decoded.from, wallet.address)
  t.is(decoded.value, 1234n)
  t.is(decoded.nonce, message.nonce)
})

test('encodeCancelAuthorization produces calldata for the cancel selector', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const domain = buildDomain(TEST_DOMAIN)
  const nonce = generateNonce()
  const message = { authorizer: wallet.address, nonce }
  const signature = await wallet.signTypedData(domain, getAuthorizationTypes(CANCEL_AUTHORIZATION), message)

  const data = encodeCancelAuthorization({ authorizer: wallet.address, nonce, signature })
  const iface = new Interface(ERC20_EIP3009_ABI)
  const decoded = iface.decodeFunctionData('cancelAuthorization', data)
  t.is(decoded.authorizer, wallet.address)
  t.is(decoded.nonce, nonce)
})
