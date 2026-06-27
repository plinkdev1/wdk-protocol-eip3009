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
 * Protocol-family alignment — compose EIP-3009 as the **gasless settlement leg**
 * of the sibling `@tetherto/wdk-protocol-*` flows.
 *
 * Most of those flows ultimately move USDt from the user: a **swap** spends USDt
 * for another token, **lending** supplies USDt to a pool, a **bridge** locks USDt
 * on the source chain, and a fiat **off-ramp** sells USDt to its deposit address.
 * Whatever the protocol, the user-funding step is "send `value` USDt to address
 * `to`" — exactly what a signed EIP-3009 authorization expresses. So instead of an
 * approve + transfer that costs the user gas, the wallet signs one authorization
 * and a relayer/facilitator settles it gas-free (see `relayAuthorization`).
 *
 * This module is the **seam**, not the protocols: it imports no sibling SDK. Each
 * provider is a narrow interface the integrator implements over the real package
 * (the same boundary the WDK wallet + checkout use). `toSettlementLeg` reads the
 * USDt obligation out of a protocol action result (tolerant of each module's field
 * names), `buildGaslessSettlement` turns that into EIP-3009 typed data to sign, and
 * `composeSettlementPlan` pairs the protocol action with its gasless leg. The
 * signed result drops straight into `relayAuthorization` via `settlementToRelayRequest`.
 */

import {
  TRANSFER_WITH_AUTHORIZATION,
  RECEIVE_WITH_AUTHORIZATION,
  buildAuthorizationMessage,
  buildDomain,
  getAuthorizationTypes,
  generateNonce
} from './eip3009.js'

/** @typedef {import('./eip3009.js').Eip712Domain} Eip712Domain */

/**
 * The USDt obligation a protocol action creates: send `value` to `to`.
 *
 * @typedef {Object} SettlementLeg
 * @property {string} to    - The protocol address that receives the USDt (spender / pool / router / deposit).
 * @property {bigint} value - The USDt amount in base units the action requires.
 */

/**
 * A narrow view of `@tetherto/wdk-protocol-swap-velora-evm`. The integrator
 * implements this over the real module; only the shape the settlement seam needs
 * is typed here.
 *
 * @typedef {Object} SwapProvider
 * @property {(args: Object) => Promise<Object>} quoteExactOutput - Returns a quote
 *   whose user-funding leg pays a (capped) amount of USDt to a spender.
 */

/**
 * A narrow view of `@tetherto/wdk-protocol-lending-aave-evm`.
 * @typedef {Object} LendingProvider
 * @property {(args: Object) => Promise<Object>} buildSupply - Returns the supply action
 *   (USDt amount → pool) to fund.
 */

/**
 * A narrow view of `@tetherto/wdk-protocol-bridge-usdt0-evm`.
 * @typedef {Object} BridgeProvider
 * @property {(args: Object) => Promise<Object>} buildBridge - Returns the bridge action
 *   (USDt amount → router/escrow) to fund.
 */

/**
 * A narrow view of `@tetherto/wdk-protocol-fiat-moonpay` (off-ramp).
 * @typedef {Object} FiatProvider
 * @property {(args: Object) => Promise<Object>} buildOfframp - Returns the off-ramp action
 *   (USDt amount → deposit address) to fund.
 */

/** Candidate field names a sibling module might use for the receiving address. */
const TO_KEYS = ['to', 'spender', 'pool', 'router', 'deposit', 'escrow', 'recipient', 'target', 'vault']
/** Candidate field names for the USDt amount in base units. */
const VALUE_KEYS = ['value', 'amount', 'amountIn', 'maxAmountIn', 'inputAmount', 'amountBase', 'cost']

/** Return the first present, non-null value among `keys` of `o`. */
function pick (o, keys) {
  for (const k of keys) {
    if (o != null && o[k] !== undefined && o[k] !== null) return o[k]
  }
  return undefined
}

/** Coerce a bigint / number / decimal-free numeric string to BigInt. */
function toBigIntValue (v) {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('compose: numeric value must be an integer (base units).')
    return BigInt(v)
  }
  if (typeof v === 'string' && /^[0-9]+$/.test(v.trim())) return BigInt(v.trim())
  throw new Error('compose: could not read a base-unit amount from the protocol action.')
}

/**
 * Read the USDt {@link SettlementLeg} out of a protocol action result, tolerant of
 * each sibling module's field names (spender/pool/router/deposit for the address;
 * amount/amountIn/maxAmountIn/… for the value). An explicit `{ to, value }` always
 * wins.
 *
 * @param {Object} action - A protocol action/quote result (or an explicit `{ to, value }`).
 * @returns {SettlementLeg}
 * @throws {Error} When neither an address nor an amount can be found.
 */
export function toSettlementLeg (action) {
  if (action == null || typeof action !== 'object') {
    throw new Error('compose: protocol action must be an object.')
  }
  const to = pick(action, TO_KEYS)
  const rawValue = pick(action, VALUE_KEYS)
  if (typeof to !== 'string' || to === '') {
    throw new Error('compose: protocol action has no settlement address (looked for to/spender/pool/router/…).')
  }
  if (rawValue === undefined) {
    throw new Error('compose: protocol action has no USDt amount (looked for value/amount/amountIn/…).')
  }
  return { to, value: toBigIntValue(rawValue) }
}

/**
 * Build the EIP-3009 typed data for a gasless settlement leg — the value the user
 * signs to fund a protocol action without paying gas.
 *
 * Defaults to **ReceiveWithAuthorization**, which binds the on-chain caller to the
 * settlement `to`, so only the intended protocol/relayer can pull the funds (no
 * third party can replay the authorization elsewhere). Pass
 * `primaryType: TRANSFER_WITH_AUTHORIZATION` for the open-relayer variant used by
 * `relayAuthorization`'s default.
 *
 * @param {Object} args
 * @param {Eip712Domain} args.domain - The USDt token's EIP-712 domain.
 * @param {string} args.from - The user's address (the holder funding the action).
 * @param {SettlementLeg} args.leg - The settlement obligation (`to` + `value`).
 * @param {number|bigint} [args.validAfter=0] - Not-before (unix seconds).
 * @param {number|bigint} args.validBefore - Expiry (unix seconds); required.
 * @param {string} [args.nonce] - 32-byte hex nonce (random if omitted).
 * @param {string} [args.primaryType] - ReceiveWithAuthorization (default) or TransferWithAuthorization.
 * @returns {{ domain: Eip712Domain, primaryType: string, types: Object, message: Object }}
 *   Ready to pass to `signer.signTypedData(domain, types, message)`.
 */
export function buildGaslessSettlement ({ domain, from, leg, validAfter = 0, validBefore, nonce, primaryType = RECEIVE_WITH_AUTHORIZATION }) {
  if (primaryType !== RECEIVE_WITH_AUTHORIZATION && primaryType !== TRANSFER_WITH_AUTHORIZATION) {
    throw new Error(`compose: unsupported primaryType '${primaryType}'.`)
  }
  if (validBefore === undefined || validBefore === null) {
    throw new Error("compose: 'validBefore' (expiry) is required for a settlement authorization.")
  }
  if (leg == null || typeof leg.to !== 'string') {
    throw new Error('compose: a settlement leg ({ to, value }) is required.')
  }
  const message = buildAuthorizationMessage({
    from,
    to: leg.to,
    value: leg.value,
    validAfter,
    validBefore,
    nonce: nonce ?? generateNonce()
  })
  return {
    domain: buildDomain(domain),
    primaryType,
    types: getAuthorizationTypes(primaryType),
    message
  }
}

/**
 * Compose a protocol action with its gasless USDt settlement leg into one plan:
 * the action the wallet executes, the derived `{ to, value }` obligation, and the
 * EIP-3009 typed data the user signs to fund it gas-free.
 *
 * @param {Object} args
 * @param {string} args.protocol - A label for the flow ('swap' | 'lending' | 'bridge' | 'fiat' | …).
 * @param {Object} args.action - The sibling protocol's action/quote result.
 * @param {Eip712Domain} args.domain - The USDt token's EIP-712 domain.
 * @param {string} args.from - The user's address.
 * @param {number|bigint} args.validBefore - Settlement expiry (unix seconds).
 * @param {number|bigint} [args.validAfter=0] - Not-before (unix seconds).
 * @param {string} [args.nonce] - Optional fixed nonce (random if omitted).
 * @param {string} [args.primaryType] - Override the authorization type.
 * @returns {{ protocol: string, action: Object, leg: SettlementLeg, settlement: { domain: Eip712Domain, primaryType: string, types: Object, message: Object } }}
 */
export function composeSettlementPlan ({ protocol, action, domain, from, validBefore, validAfter = 0, nonce, primaryType }) {
  const leg = toSettlementLeg(action)
  const settlement = buildGaslessSettlement({ domain, from, leg, validAfter, validBefore, nonce, primaryType })
  return { protocol: String(protocol ?? 'settlement'), action, leg, settlement }
}

/**
 * Turn a signed settlement (the typed data from {@link buildGaslessSettlement} plus
 * the user's signature) into the exact request shape `relayAuthorization` expects,
 * closing the loop from protocol action → gasless settlement → on-chain submission.
 *
 * @param {Object} args
 * @param {{ domain: Eip712Domain, primaryType: string, message: Object }} args.settlement - From buildGaslessSettlement / composeSettlementPlan.
 * @param {string} args.signature - The user's 65-byte hex signature over the settlement typed data.
 * @returns {{ domain: Eip712Domain, primaryType: string, message: Object, signature: string }}
 */
export function settlementToRelayRequest ({ settlement, signature }) {
  if (settlement == null || settlement.message == null) {
    throw new Error('compose: settlement (with a message) is required.')
  }
  if (typeof signature !== 'string' || signature === '') {
    throw new Error('compose: a signature is required to build a relay request.')
  }
  return {
    domain: settlement.domain,
    primaryType: settlement.primaryType,
    message: settlement.message,
    signature
  }
}
