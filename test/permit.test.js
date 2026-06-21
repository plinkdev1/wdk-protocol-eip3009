// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'
import { Interface, TypedDataEncoder, Wallet, isHexString } from 'ethers'

import {
  PERMIT,
  buildPermitMessage,
  buildPermitTypedData,
  hashPermit,
  recoverPermitSigner,
  encodePermit,
  encodeNoncesCall,
  getPermitTypes
} from '../index.js'
import { TEST_DOMAIN, TEST_PRIVATE_KEY, TEST_ADDRESS } from './helpers.js'

const SPENDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

function rawMessage (over = {}) {
  return { owner: TEST_ADDRESS, spender: SPENDER, value: 1000000n, nonce: 0n, deadline: 9999999999n, ...over }
}

test('buildPermitMessage normalizes + validates fields', (t) => {
  const m = buildPermitMessage(rawMessage({ value: '1000000', nonce: '0', deadline: '9999999999' }))
  t.is(m.owner, TEST_ADDRESS)
  t.is(m.spender, SPENDER)
  t.is(m.value, 1000000n)
  t.is(m.nonce, 0n)
  t.is(m.deadline, 9999999999n)
})

test('buildPermitMessage rejects bad input', (t) => {
  t.exception(() => buildPermitMessage(rawMessage({ owner: 'not-an-address' })))
  t.exception(() => buildPermitMessage(rawMessage({ spender: '0x123' })))
  t.exception(() => buildPermitMessage(rawMessage({ value: -1 })))
  t.exception(() => buildPermitMessage(rawMessage({ deadline: 0 })))
})

test('getPermitTypes matches the ERC-2612 Permit layout', (t) => {
  const types = getPermitTypes()
  t.alike(
    types[PERMIT].map((f) => f.name),
    ['owner', 'spender', 'value', 'nonce', 'deadline']
  )
})

test('hashPermit equals an independent ethers TypedDataEncoder hash', (t) => {
  const message = buildPermitMessage(rawMessage())
  const expected = TypedDataEncoder.hash(
    { name: TEST_DOMAIN.name, version: TEST_DOMAIN.version, chainId: BigInt(TEST_DOMAIN.chainId), verifyingContract: TEST_DOMAIN.verifyingContract },
    getPermitTypes(),
    message
  )
  t.is(hashPermit(TEST_DOMAIN, rawMessage()), expected)
})

test('sign → recoverPermitSigner round-trips to the owner (cross-impl)', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const { domain, types, message } = buildPermitTypedData(TEST_DOMAIN, rawMessage())
  const signature = await wallet.signTypedData(domain, types, message)
  t.ok(isHexString(signature, 65))
  t.is(recoverPermitSigner(TEST_DOMAIN, rawMessage(), signature), TEST_ADDRESS)
})

test('a tampered message recovers a different signer', async (t) => {
  const wallet = new Wallet(TEST_PRIVATE_KEY)
  const { domain, types, message } = buildPermitTypedData(TEST_DOMAIN, rawMessage())
  const signature = await wallet.signTypedData(domain, types, message)
  t.not(recoverPermitSigner(TEST_DOMAIN, rawMessage({ value: 999n }), signature), TEST_ADDRESS)
})

test('encodePermit produces decodable permit(...) calldata', (t) => {
  // a deterministic signature isn't needed; encode with a fixed 65-byte sig
  const sig = '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b'
  const data = encodePermit(rawMessage(), sig)
  const iface = new Interface(['function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)'])
  const decoded = iface.decodeFunctionData('permit', data)
  t.is(decoded[0], TEST_ADDRESS)
  t.is(decoded[1], SPENDER)
  t.is(decoded[2], 1000000n)
  t.is(decoded[3], 9999999999n)
  t.is(Number(decoded[4]), 27) // v = 0x1b
})

test('encodeNoncesCall encodes nonces(owner)', (t) => {
  const data = encodeNoncesCall(TEST_ADDRESS)
  const iface = new Interface(['function nonces(address owner) view returns (uint256)'])
  const decoded = iface.decodeFunctionData('nonces', data)
  t.is(decoded[0], TEST_ADDRESS)
})
