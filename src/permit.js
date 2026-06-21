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
 * ERC-2612 `permit` — gasless approvals.
 *
 * Many tokens (notably DAI-lineage and OpenZeppelin ERC20Permit tokens) expose
 * `permit` rather than EIP-3009 `transferWithAuthorization`. `permit` lets a
 * holder *sign* an allowance (gas-free) that a relayer submits, so the spender
 * (a router/protocol) can then `transferFrom`. This module is the permit sibling
 * of the EIP-3009 builders, behind the same module surface (same EIP-712 domain
 * via {@link buildDomain}), so a wallet can compose whichever a token supports.
 *
 * Key difference from EIP-3009: the permit `nonce` is a **sequential uint256**
 * read from the token (`nonces(owner)`), not a random bytes32 — so permits must
 * be submitted in order.
 */

import { Interface, Signature, TypedDataEncoder, getAddress, isAddress, toBigInt, verifyTypedData } from 'ethers'
import { buildDomain } from './eip3009.js'

/** The EIP-712 primary type for an ERC-2612 permit. */
export const PERMIT = 'Permit'

/** EIP-712 field layout for ERC-2612 `permit`. */
const PERMIT_FIELDS = [
  { name: 'owner', type: 'address' },
  { name: 'spender', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' }
]

/** Minimal ABI for submitting a permit + reading the on-chain nonce. */
export const ERC2612_PERMIT_ABI = [
  'function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)'
]

const PERMIT_INTERFACE = new Interface(ERC2612_PERMIT_ABI)

/** @typedef {import('./eip3009.js').Eip712Domain} Eip712Domain */

/**
 * @typedef {Object} PermitMessage
 * @property {string} owner - The token holder granting the allowance.
 * @property {string} spender - The address allowed to spend.
 * @property {bigint} value - The allowance amount (base unit).
 * @property {bigint} nonce - The owner's current permit nonce (`nonces(owner)`).
 * @property {bigint} deadline - Unix-seconds expiry of the signature.
 */

/** Returns the ethers-style EIP-712 `types` map for an ERC-2612 permit. */
export function getPermitTypes () {
  return { [PERMIT]: PERMIT_FIELDS }
}

/** Reusable ethers Interface for encoding permit calldata + nonce reads. */
export function getPermitInterface () {
  return PERMIT_INTERFACE
}

/**
 * Validates and normalizes a permit message.
 *
 * @param {Object} message
 * @param {string} message.owner
 * @param {string} message.spender
 * @param {number | bigint | string} message.value
 * @param {number | bigint | string} message.nonce
 * @param {number | bigint | string} message.deadline
 * @returns {PermitMessage} The normalized message.
 * @throws {Error} If any field is missing or invalid.
 */
export function buildPermitMessage ({ owner, spender, value, nonce, deadline }) {
  if (!isAddress(owner)) {
    throw new Error("'owner' must be a valid address.")
  }
  if (!isAddress(spender)) {
    throw new Error("'spender' must be a valid address.")
  }

  const normalizedValue = toBigInt(value)
  if (normalizedValue < 0n) {
    throw new Error("'value' must be greater than or equal to zero.")
  }

  const normalizedNonce = toBigInt(nonce)
  if (normalizedNonce < 0n) {
    throw new Error("'nonce' must be greater than or equal to zero.")
  }

  const normalizedDeadline = toBigInt(deadline)
  if (normalizedDeadline <= 0n) {
    throw new Error("'deadline' must be greater than zero.")
  }

  return {
    owner: getAddress(owner),
    spender: getAddress(spender),
    value: normalizedValue,
    nonce: normalizedNonce,
    deadline: normalizedDeadline
  }
}

/**
 * Builds the full EIP-712 typed-data payload a holder signs for a permit.
 *
 * @param {Eip712Domain} domain - The token's EIP-712 domain.
 * @param {Object} message - The raw permit message (see {@link buildPermitMessage}).
 * @returns {{ types: Record<string, Array<{ name: string, type: string }>>, primaryType: string, domain: Eip712Domain, message: PermitMessage }}
 */
export function buildPermitTypedData (domain, message) {
  return {
    types: getPermitTypes(),
    primaryType: PERMIT,
    domain: buildDomain(domain),
    message: buildPermitMessage(message)
  }
}

/**
 * Computes the EIP-712 digest (the value the owner signs) for a permit.
 *
 * @param {Eip712Domain} domain
 * @param {Object} message
 * @returns {string} The 32-byte hex digest.
 */
export function hashPermit (domain, message) {
  return TypedDataEncoder.hash(buildDomain(domain), getPermitTypes(), buildPermitMessage(message))
}

/**
 * Recovers the signer address from a permit signature.
 *
 * @param {Eip712Domain} domain
 * @param {Object} message
 * @param {string} signature - A 65-byte hex signature.
 * @returns {string} The recovered (checksummed) signer address.
 */
export function recoverPermitSigner (domain, message, signature) {
  return verifyTypedData(buildDomain(domain), getPermitTypes(), buildPermitMessage(message), signature)
}

/**
 * Encodes the on-chain `permit(...)` calldata a relayer submits, given a signed
 * message. The signature is split into (v, r, s).
 *
 * @param {Object} message - The permit message.
 * @param {string} signature - The owner's 65-byte hex signature.
 * @returns {string} ABI-encoded calldata for `permit`.
 */
export function encodePermit (message, signature) {
  const m = buildPermitMessage(message)
  const sig = Signature.from(signature)
  return PERMIT_INTERFACE.encodeFunctionData('permit', [m.owner, m.spender, m.value, m.deadline, sig.v, sig.r, sig.s])
}

/**
 * Encodes a read of the owner's current permit nonce (`nonces(owner)`), which
 * the caller submits via `eth_call` to obtain the next nonce before signing.
 *
 * @param {string} owner
 * @returns {string} ABI-encoded calldata for `nonces`.
 */
export function encodeNoncesCall (owner) {
  if (!isAddress(owner)) {
    throw new Error("'owner' must be a valid address.")
  }
  return PERMIT_INTERFACE.encodeFunctionData('nonces', [getAddress(owner)])
}
