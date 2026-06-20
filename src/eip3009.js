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

import {
  Interface,
  Signature,
  TypedDataEncoder,
  getAddress,
  getBytes,
  hexlify,
  isAddress,
  isHexString,
  randomBytes,
  toBigInt,
  verifyTypedData
} from 'ethers'

import { ERC20_EIP3009_ABI } from './erc20-eip3009-abi.js'

/**
 * @typedef {Object} Eip712Domain
 * @property {string} name - The token's EIP-712 domain name (e.g. "USD Coin").
 * @property {string} version - The token's EIP-712 domain version (e.g. "2").
 * @property {number | bigint} chainId - The chain id the token is deployed on.
 * @property {string} verifyingContract - The token contract address.
 */

/**
 * @typedef {Object} TransferAuthorizationMessage
 * @property {string} from - The token holder authorizing the transfer.
 * @property {string} to - The recipient of the tokens.
 * @property {bigint} value - The amount to transfer (in the token's base unit).
 * @property {bigint} validAfter - Unix timestamp (seconds); the authorization is invalid before this time.
 * @property {bigint} validBefore - Unix timestamp (seconds); the authorization is invalid at/after this time.
 * @property {string} nonce - A unique 32-byte hex nonce (NOT sequential — random per EIP-3009).
 */

/**
 * @typedef {Object} CancelAuthorizationMessage
 * @property {string} authorizer - The address whose authorization is being cancelled.
 * @property {string} nonce - The 32-byte hex nonce to cancel.
 */

/** The EIP-712 primary type for a transfer authorization. */
export const TRANSFER_WITH_AUTHORIZATION = 'TransferWithAuthorization'

/** The EIP-712 primary type for a receive authorization (recipient-bound). */
export const RECEIVE_WITH_AUTHORIZATION = 'ReceiveWithAuthorization'

/** The EIP-712 primary type for a cancel authorization. */
export const CANCEL_AUTHORIZATION = 'CancelAuthorization'

/** EIP-712 field layout shared by transfer and receive authorizations. */
const AUTHORIZATION_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' }
]

/** EIP-712 field layout for a cancel authorization. */
const CANCEL_FIELDS = [
  { name: 'authorizer', type: 'address' },
  { name: 'nonce', type: 'bytes32' }
]

/** Reusable ethers Interface for encoding EIP-3009 calldata. */
const EIP3009_INTERFACE = new Interface(ERC20_EIP3009_ABI)

/**
 * Returns the EIP-712 `types` object for a given authorization primary type.
 *
 * @param {string} primaryType - One of {@link TRANSFER_WITH_AUTHORIZATION},
 *   {@link RECEIVE_WITH_AUTHORIZATION} or {@link CANCEL_AUTHORIZATION}.
 * @returns {Record<string, Array<{ name: string, type: string }>>} The ethers-style types map.
 * @throws {Error} If the primary type is unknown.
 */
export function getAuthorizationTypes (primaryType) {
  switch (primaryType) {
    case TRANSFER_WITH_AUTHORIZATION:
      return { [TRANSFER_WITH_AUTHORIZATION]: AUTHORIZATION_FIELDS }
    case RECEIVE_WITH_AUTHORIZATION:
      return { [RECEIVE_WITH_AUTHORIZATION]: AUTHORIZATION_FIELDS }
    case CANCEL_AUTHORIZATION:
      return { [CANCEL_AUTHORIZATION]: CANCEL_FIELDS }
    default:
      throw new Error(`Unknown EIP-3009 primary type: '${primaryType}'.`)
  }
}

/**
 * Generates a cryptographically-random 32-byte nonce for a new authorization.
 *
 * EIP-3009 nonces are random and unordered (unlike ERC-2612 permit nonces),
 * so authorizations can be created and submitted out of order or in parallel.
 *
 * @returns {string} A `0x`-prefixed 32-byte hex string.
 */
export function generateNonce () {
  return hexlify(randomBytes(32))
}

/**
 * Validates and normalizes an EIP-712 domain for an EIP-3009 token.
 *
 * @param {Eip712Domain} domain - The raw domain.
 * @returns {Eip712Domain} The normalized domain (checksummed `verifyingContract`, `bigint` `chainId`).
 * @throws {Error} If any field is missing or invalid.
 */
export function buildDomain (domain) {
  if (domain === null || typeof domain !== 'object') {
    throw new Error("'domain' must be an object.")
  }

  const { name, version, chainId, verifyingContract } = domain

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error("'domain.name' must be a non-empty string.")
  }

  if (typeof version !== 'string' || version.length === 0) {
    throw new Error("'domain.version' must be a non-empty string.")
  }

  if (chainId === undefined || chainId === null) {
    throw new Error("'domain.chainId' is required.")
  }

  if (!isAddress(verifyingContract)) {
    throw new Error("'domain.verifyingContract' must be a valid address.")
  }

  return {
    name,
    version,
    chainId: toBigInt(chainId),
    verifyingContract: getAddress(verifyingContract)
  }
}

/**
 * Validates and normalizes a transfer/receive authorization message.
 *
 * @param {Object} message - The raw message.
 * @param {string} message.from - The token holder.
 * @param {string} message.to - The recipient.
 * @param {number | bigint | string} message.value - The amount (base unit).
 * @param {number | bigint | string} message.validAfter - Unix seconds.
 * @param {number | bigint | string} message.validBefore - Unix seconds.
 * @param {string} message.nonce - A 32-byte hex nonce.
 * @returns {TransferAuthorizationMessage} The normalized message.
 * @throws {Error} If any field is missing or invalid.
 */
export function buildAuthorizationMessage ({ from, to, value, validAfter, validBefore, nonce }) {
  if (!isAddress(from)) {
    throw new Error("'from' must be a valid address.")
  }

  if (!isAddress(to)) {
    throw new Error("'to' must be a valid address.")
  }

  const normalizedValue = toBigInt(value)
  if (normalizedValue < 0n) {
    throw new Error("'value' must be greater than or equal to zero.")
  }

  const normalizedValidAfter = toBigInt(validAfter)
  const normalizedValidBefore = toBigInt(validBefore)
  if (normalizedValidBefore <= normalizedValidAfter) {
    throw new Error("'validBefore' must be greater than 'validAfter'.")
  }

  assertNonce(nonce)

  return {
    from: getAddress(from),
    to: getAddress(to),
    value: normalizedValue,
    validAfter: normalizedValidAfter,
    validBefore: normalizedValidBefore,
    nonce
  }
}

/**
 * Computes the EIP-712 digest (the value the holder actually signs) for an
 * authorization, without signing it. Useful for verification and testing.
 *
 * @param {Eip712Domain} domain - The token domain.
 * @param {string} primaryType - The authorization primary type.
 * @param {TransferAuthorizationMessage | CancelAuthorizationMessage} message - The message.
 * @returns {string} The 32-byte EIP-712 hash.
 */
export function hashAuthorization (domain, primaryType, message) {
  return TypedDataEncoder.hash(buildDomain(domain), getAuthorizationTypes(primaryType), message)
}

/**
 * Recovers the signer address from an authorization signature.
 *
 * @param {Eip712Domain} domain - The token domain.
 * @param {string} primaryType - The authorization primary type.
 * @param {TransferAuthorizationMessage | CancelAuthorizationMessage} message - The signed message.
 * @param {string} signature - The 65-byte hex signature.
 * @returns {string} The checksummed recovered signer address.
 */
export function recoverAuthorizationSigner (domain, primaryType, message, signature) {
  return verifyTypedData(buildDomain(domain), getAuthorizationTypes(primaryType), message, signature)
}

/**
 * Splits a 65-byte signature into its `v`, `r`, `s` components, as required by
 * the on-chain `transferWithAuthorization(..., uint8 v, bytes32 r, bytes32 s)`
 * call.
 *
 * @param {string} signature - The compact or expanded hex signature.
 * @returns {{ v: number, r: string, s: string }} The split signature.
 */
export function splitSignature (signature) {
  const sig = Signature.from(signature)
  return { v: sig.v, r: sig.r, s: sig.s }
}

/**
 * ABI-encodes a `transferWithAuthorization` call from a signed authorization.
 *
 * @param {TransferAuthorizationMessage & { signature: string }} authorization - The signed transfer authorization.
 * @returns {string} The 0x-prefixed calldata.
 */
export function encodeTransferWithAuthorization (authorization) {
  const { from, to, value, validAfter, validBefore, nonce, signature } = authorization
  const { v, r, s } = splitSignature(signature)
  return EIP3009_INTERFACE.encodeFunctionData('transferWithAuthorization', [
    from, to, value, validAfter, validBefore, nonce, v, r, s
  ])
}

/**
 * ABI-encodes a `receiveWithAuthorization` call from a signed authorization.
 *
 * @param {TransferAuthorizationMessage & { signature: string }} authorization - The signed receive authorization.
 * @returns {string} The 0x-prefixed calldata.
 */
export function encodeReceiveWithAuthorization (authorization) {
  const { from, to, value, validAfter, validBefore, nonce, signature } = authorization
  const { v, r, s } = splitSignature(signature)
  return EIP3009_INTERFACE.encodeFunctionData('receiveWithAuthorization', [
    from, to, value, validAfter, validBefore, nonce, v, r, s
  ])
}

/**
 * ABI-encodes a `cancelAuthorization` call from a signed cancellation.
 *
 * @param {CancelAuthorizationMessage & { signature: string }} cancellation - The signed cancellation.
 * @returns {string} The 0x-prefixed calldata.
 */
export function encodeCancelAuthorization (cancellation) {
  const { authorizer, nonce, signature } = cancellation
  const { v, r, s } = splitSignature(signature)
  return EIP3009_INTERFACE.encodeFunctionData('cancelAuthorization', [authorizer, nonce, v, r, s])
}

/**
 * Asserts that `nonce` is a valid 32-byte hex string.
 *
 * @param {string} nonce - The nonce to validate.
 * @throws {Error} If the nonce is not a 32-byte hex string.
 */
export function assertNonce (nonce) {
  if (!isHexString(nonce, 32)) {
    throw new Error("'nonce' must be a 32-byte (0x-prefixed) hex string. Use generateNonce() to create one.")
  }
}

/**
 * Returns the current Unix time in seconds.
 *
 * @returns {bigint} `Math.floor(Date.now() / 1000)` as a bigint.
 */
export function nowInSeconds () {
  return BigInt(Math.floor(Date.now() / 1000))
}

/**
 * The shared ethers Interface for the EIP-3009 token surface. Exposed for
 * advanced consumers that want to decode events or build custom calls.
 *
 * @returns {Interface} The EIP-3009 interface.
 */
export function getEip3009Interface () {
  return EIP3009_INTERFACE
}

/**
 * Coerces an arbitrary signature representation to a 65-byte hex string.
 *
 * @param {string | { v: number, r: string, s: string }} signature - A hex signature or v/r/s parts.
 * @returns {string} The serialized 65-byte hex signature.
 */
export function serializeSignature (signature) {
  if (typeof signature === 'string') {
    return Signature.from(signature).serialized
  }
  return Signature.from(signature).serialized
}

export { getBytes }
