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
 * Batch authorizations — sign N EIP-3009 transfers in one UX, submit independently.
 *
 * EIP-3009 nonces are random and unordered, so a batch is just N authorizations,
 * each with its own unique nonce. That independence is the feature: the relayer
 * can submit them in any order, in parallel, or drop one without affecting the
 * rest (unlike ERC-2612 permit's sequential nonces). This module builds the
 * batch (generating + de-duplicating nonces), maps it to per-item EIP-712
 * payloads to sign, and encodes the signed set to calldata.
 *
 * Flow:
 *   const messages = buildAuthorizationBatch(items)
 *   const payloads = authorizationBatchToTypedData(domain, messages)
 *   // sign each payload.message → attach `.signature` to its message
 *   const calldata = encodeAuthorizationBatch(signedMessages)
 */

import {
  TRANSFER_WITH_AUTHORIZATION,
  RECEIVE_WITH_AUTHORIZATION,
  buildAuthorizationMessage,
  buildDomain,
  getAuthorizationTypes,
  generateNonce,
  encodeTransferWithAuthorization,
  encodeReceiveWithAuthorization
} from './eip3009.js'

/** @typedef {import('./eip3009.js').Eip712Domain} Eip712Domain */
/** @typedef {import('./eip3009.js').TransferAuthorizationMessage} TransferAuthorizationMessage */

/**
 * Builds and normalizes a batch of transfer/receive authorization messages.
 * Each item missing a `nonce` gets a fresh random one; all nonces must be unique.
 *
 * @param {Array<{ from: string, to: string, value: number | bigint | string, validAfter: number | bigint | string, validBefore: number | bigint | string, nonce?: string }>} items
 * @returns {TransferAuthorizationMessage[]} The normalized messages (with nonces).
 * @throws {Error} If `items` is empty, any item is invalid, or two nonces collide.
 */
export function buildAuthorizationBatch (items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("'items' must be a non-empty array.")
  }
  const seen = new Set()
  return items.map((item, i) => {
    const nonce = item.nonce ?? generateNonce()
    const message = buildAuthorizationMessage({ ...item, nonce })
    const key = message.nonce.toLowerCase()
    if (seen.has(key)) {
      throw new Error(`Duplicate nonce at index ${i}: ${message.nonce}`)
    }
    seen.add(key)
    return message
  })
}

/**
 * Maps a built batch to per-item EIP-712 typed-data payloads, ready to sign.
 * All items share the same token domain + types; each has its own message.
 *
 * @param {Eip712Domain} domain - The token's EIP-712 domain.
 * @param {TransferAuthorizationMessage[]} messages - From {@link buildAuthorizationBatch}.
 * @param {{ primaryType?: string }} [options]
 * @returns {Array<{ types: object, primaryType: string, domain: Eip712Domain, message: TransferAuthorizationMessage }>}
 */
export function authorizationBatchToTypedData (domain, messages, { primaryType = TRANSFER_WITH_AUTHORIZATION } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("'messages' must be a non-empty array.")
  }
  const d = buildDomain(domain)
  const types = getAuthorizationTypes(primaryType)
  return messages.map((message) => ({ types, primaryType, domain: d, message }))
}

/**
 * Encodes a batch of *signed* authorizations to an array of calldata (one
 * `transferWithAuthorization` / `receiveWithAuthorization` call each). Each
 * element is `{ ...message, signature }`.
 *
 * @param {Array<TransferAuthorizationMessage & { signature: string }>} signedAuthorizations
 * @param {{ primaryType?: string }} [options]
 * @returns {string[]} 0x-prefixed calldata, one per authorization.
 */
export function encodeAuthorizationBatch (signedAuthorizations, { primaryType = TRANSFER_WITH_AUTHORIZATION } = {}) {
  if (!Array.isArray(signedAuthorizations) || signedAuthorizations.length === 0) {
    throw new Error("'signedAuthorizations' must be a non-empty array.")
  }
  const encode = primaryType === RECEIVE_WITH_AUTHORIZATION
    ? encodeReceiveWithAuthorization
    : encodeTransferWithAuthorization
  return signedAuthorizations.map((a) => encode(a))
}
