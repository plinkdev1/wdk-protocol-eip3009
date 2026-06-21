// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

/**
 * Reference relayer — the server half of the gasless path.
 *
 * A holder signs a transfer/receive authorization (gas-free); this verifies it
 * and submits `transferWithAuthorization` / `receiveWithAuthorization` on-chain,
 * paying the gas. That's what makes the transfer gasless for the holder.
 *
 * `relayAuthorization` is the pure, testable core: it recovers the signer,
 * confirms it matches `message.from`, checks the validity window, encodes the
 * call, and delegates the actual broadcast to an injected `submitTransaction`
 * (so it's unit-testable without a chain, and the example server wires a real
 * ethers-backed submitter). See `examples/relayer-server.mjs` for the runnable
 * HTTP service.
 *
 * Security: the relayer only ever pays gas — it never holds the user's key, and
 * the signed authorization caps exactly what can move (to/value/window/nonce).
 */

import {
  TRANSFER_WITH_AUTHORIZATION,
  RECEIVE_WITH_AUTHORIZATION,
  encodeReceiveWithAuthorization,
  encodeTransferWithAuthorization,
  nowInSeconds,
  recoverAuthorizationSigner
} from './eip3009.js'

/** @typedef {import('./eip3009.js').Eip712Domain} Eip712Domain */

/**
 * @typedef {Object} RelayResult
 * @property {string} txHash - The submitted transaction hash.
 * @property {string} payer - The recovered authorizer (== message.from).
 */

/**
 * Verify a signed authorization and submit it on-chain via `submitTransaction`.
 *
 * @param {Object} args
 * @param {Eip712Domain} args.domain - The token's EIP-712 domain (gives the token address).
 * @param {string} [args.primaryType] - TransferWithAuthorization (default) or ReceiveWithAuthorization.
 * @param {Object} args.message - The authorization message (from/to/value/validAfter/validBefore/nonce).
 * @param {string} args.signature - The holder's 65-byte hex signature.
 * @param {(tx: { to: string, data: string }) => Promise<{ txHash?: string, hash?: string }>} args.submitTransaction -
 *   Broadcasts the encoded call; returns the tx hash. Injected (ethers in prod, a fake in tests).
 * @param {number} [args.now] - Override "now" (unix seconds) for deterministic tests.
 * @returns {Promise<RelayResult>}
 * @throws {Error} On unsupported type, signer mismatch, or an authorization outside its validity window.
 */
export async function relayAuthorization ({ domain, primaryType = TRANSFER_WITH_AUTHORIZATION, message, signature, submitTransaction, now }) {
  if (primaryType !== TRANSFER_WITH_AUTHORIZATION && primaryType !== RECEIVE_WITH_AUTHORIZATION) {
    throw new Error(`relayAuthorization: unsupported primaryType '${primaryType}'.`)
  }
  if (typeof submitTransaction !== 'function') {
    throw new Error("relayAuthorization: 'submitTransaction' must be a function.")
  }

  const signer = recoverAuthorizationSigner(domain, primaryType, message, signature)
  if (signer.toLowerCase() !== String(message.from).toLowerCase()) {
    throw new Error('relayAuthorization: signature does not match message.from.')
  }

  const ts = now ?? nowInSeconds()
  if (Number(message.validBefore) <= ts) {
    throw new Error('relayAuthorization: authorization has expired (validBefore <= now).')
  }
  if (Number(message.validAfter) > ts) {
    throw new Error('relayAuthorization: authorization is not yet valid (validAfter > now).')
  }

  const encode = primaryType === RECEIVE_WITH_AUTHORIZATION
    ? encodeReceiveWithAuthorization
    : encodeTransferWithAuthorization
  const data = encode({ ...message, signature })

  const result = await submitTransaction({ to: domain.verifyingContract, data })
  const txHash = result?.txHash ?? result?.hash
  if (typeof txHash !== 'string') {
    throw new Error('relayAuthorization: submitTransaction did not return a tx hash.')
  }
  return { txHash, payer: signer }
}
