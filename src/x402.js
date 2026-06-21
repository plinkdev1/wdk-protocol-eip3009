/**
 * x402 — HTTP "402 Payment Required" payments on top of EIP-3009.
 *
 * x402 lets an HTTP server charge per request: it answers 402 with payment
 * *requirements*, the client pays and retries with an `X-PAYMENT` header, and a
 * facilitator verifies + settles on-chain. Its canonical EVM scheme, "exact", is
 * an EIP-3009 `transferWithAuthorization` — the client signs an off-chain
 * authorization (gasless) and the facilitator submits it. This module is the
 * protocol glue: build/encode/decode the wire format and verify a payment
 * against requirements, on top of the EIP-3009 primitives in this package.
 *
 * Signing lives in the wallet (sign the returned authorization with a WDK
 * account); settling is a normal `submitTransferAuthorization()` call.
 */
import { getAddress } from 'ethers'
import {
  buildAuthorizationMessage,
  generateNonce,
  recoverAuthorizationSigner,
  TRANSFER_WITH_AUTHORIZATION
} from './eip3009.js'

/** The x402 protocol version this module speaks. */
export const X402_VERSION = 1

/** The EIP-3009-backed x402 scheme. */
export const SCHEME_EXACT = 'exact'

/** Common x402 network name → EVM chain id. Extend as needed. */
export const NETWORK_CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
  'base-sepolia': 84532,
  polygon: 137,
  'polygon-amoy': 80002,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  'avalanche-fuji': 43113,
  sepolia: 11155111
}

/**
 * Resolve an x402 network identifier to an EVM chain id.
 *
 * @param {string|number} network - Network name (e.g. "base") or chain id.
 * @returns {number} The numeric chain id.
 */
export function networkToChainId (network) {
  if (typeof network === 'number') return network
  const id = NETWORK_CHAIN_IDS[String(network).toLowerCase()]
  if (!id) throw new Error(`Unknown x402 network: ${network}`)
  return id
}

// Base64 that works across Node, Bare, and browsers.
function toBase64 (str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64')
  return btoa(unescape(encodeURIComponent(str)))
}
function fromBase64 (b64) {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8')
  return decodeURIComponent(escape(atob(b64)))
}

/**
 * Build an x402 PaymentRequirements entry (one item of the server's 402
 * `accepts` array) for the EIP-3009 "exact" scheme.
 *
 * @param {Object} o
 * @param {string} o.network - x402 network name (e.g. "base").
 * @param {string} o.asset - ERC-20 (EIP-3009) token contract address.
 * @param {string} o.payTo - Recipient address (your revenue destination).
 * @param {string|number|bigint} o.maxAmountRequired - Price in base units.
 * @param {string} [o.resource] - The URL/resource being paid for.
 * @param {string} [o.description]
 * @param {string} [o.mimeType]
 * @param {number} [o.maxTimeoutSeconds] - Authorization validity window.
 * @param {string} o.name - EIP-712 domain name of the asset (e.g. "USD Coin").
 * @param {string} [o.version] - EIP-712 domain version of the asset.
 * @returns {Object} PaymentRequirements.
 */
export function buildPaymentRequirements ({ network, asset, payTo, maxAmountRequired, resource = '', description = '', mimeType = 'application/json', maxTimeoutSeconds = 60, name = '', version = '2' }) {
  if (!asset) throw new Error("'asset' (token address) is required.")
  if (!payTo) throw new Error("'payTo' (recipient) is required.")
  if (maxAmountRequired === undefined || maxAmountRequired === null) throw new Error("'maxAmountRequired' is required.")
  return {
    scheme: SCHEME_EXACT,
    network: String(network),
    maxAmountRequired: String(maxAmountRequired),
    resource,
    description,
    mimeType,
    payTo: getAddress(payTo),
    maxTimeoutSeconds,
    asset: getAddress(asset),
    // EIP-712 domain of the asset — needed by the client to sign and the
    // facilitator to verify the authorization.
    extra: { name, version: String(version) }
  }
}

/**
 * Wrap one or more PaymentRequirements into the full 402 response body.
 *
 * @param {Object|Object[]} accepts - PaymentRequirements (or an array).
 * @param {string} [error] - Human-readable reason.
 * @returns {{x402Version:number, accepts:Object[], error:string}}
 */
export function buildPaymentRequiredResponse (accepts, error = 'X-PAYMENT header is required') {
  return { x402Version: X402_VERSION, accepts: Array.isArray(accepts) ? accepts : [accepts], error }
}

/**
 * Produce the unsigned EIP-3009 authorization that satisfies a set of
 * requirements. The wallet signs the returned message (primary type
 * `TransferWithAuthorization`); pass the signature to {@link buildExactPayment}.
 *
 * @param {Object} requirements - A PaymentRequirements entry.
 * @param {string} from - The payer address.
 * @param {Object} [opts]
 * @param {number} [opts.now] - Unix seconds (override for testing).
 * @param {string} [opts.nonce] - 32-byte hex nonce (random by default).
 * @returns {Object} The TransferWithAuthorization message.
 */
export function authorizationForRequirements (requirements, from, { now = Math.floor(Date.now() / 1000), nonce = generateNonce() } = {}) {
  const validBefore = now + Math.max(1, Number(requirements.maxTimeoutSeconds) || 60)
  return buildAuthorizationMessage({
    from: getAddress(from),
    to: getAddress(requirements.payTo),
    value: requirements.maxAmountRequired,
    validAfter: 0,
    validBefore,
    nonce
  })
}

/**
 * Build the "exact"-scheme payment payload from a signed authorization.
 *
 * @param {Object} o
 * @param {string} o.network - x402 network name.
 * @param {string} o.signature - The wallet's 65-byte hex signature.
 * @param {Object} o.authorization - The signed TransferWithAuthorization message.
 * @returns {Object} The x402 payment payload.
 */
export function buildExactPayment ({ network, signature, authorization }) {
  const m = buildAuthorizationMessage(authorization)
  // The wire format carries uint256 fields as decimal strings (JSON has no
  // bigint). EIP-712 hashing treats string and bigint uint256 identically, so
  // the signature still verifies.
  const wire = {
    from: m.from,
    to: m.to,
    value: String(m.value),
    validAfter: String(m.validAfter),
    validBefore: String(m.validBefore),
    nonce: m.nonce
  }
  return {
    x402Version: X402_VERSION,
    scheme: SCHEME_EXACT,
    network: String(network),
    payload: { signature, authorization: wire }
  }
}

/**
 * Encode a payment payload into the `X-PAYMENT` header value (base64 JSON).
 *
 * @param {Object} payment - An x402 payment payload.
 * @returns {string} The header value.
 */
export function encodePaymentHeader (payment) {
  return toBase64(JSON.stringify(payment))
}

/**
 * Decode an `X-PAYMENT` header value back into a payment payload.
 *
 * @param {string} headerValue - The base64 header value.
 * @returns {Object} The decoded payment payload.
 */
export function decodePaymentHeader (headerValue) {
  if (typeof headerValue !== 'string' || headerValue === '') throw new Error('Empty X-PAYMENT header.')
  try {
    return JSON.parse(fromBase64(headerValue.trim()))
  } catch {
    throw new Error('Malformed X-PAYMENT header (expected base64-encoded JSON).')
  }
}

/**
 * Verify an x402 "exact" payment against requirements (off-chain). Recovers the
 * EIP-3009 signer and checks scheme, network, recipient, amount, and the
 * validity window. This is the synchronous half of a facilitator's `/verify`;
 * settlement (submitting the authorization on-chain via
 * `submitTransferAuthorization`) is a separate, optional step.
 *
 * @param {Object} payment - The decoded x402 payment payload.
 * @param {Object} requirements - The PaymentRequirements it should satisfy.
 * @param {Object} [opts]
 * @param {number} [opts.now] - Unix seconds (override for testing).
 * @returns {{isValid:boolean, payer:(string|null), invalidReason:(string|null)}}
 */
export function verifyExactPayment (payment, requirements, { now = Math.floor(Date.now() / 1000) } = {}) {
  const fail = (reason) => ({ isValid: false, payer: null, invalidReason: reason })

  if (!payment || payment.scheme !== SCHEME_EXACT) return fail('unsupported_scheme')
  if (String(payment.network) !== String(requirements.network)) return fail('network_mismatch')

  const p = payment.payload
  if (!p || !p.authorization || !p.signature) return fail('malformed_payload')
  const a = p.authorization

  let chainId
  try {
    chainId = networkToChainId(requirements.network)
  } catch {
    return fail('unknown_network')
  }

  const extra = requirements.extra || {}
  const domain = {
    name: extra.name || '',
    version: String(extra.version || '2'),
    chainId,
    verifyingContract: requirements.asset
  }

  let signer
  try {
    signer = recoverAuthorizationSigner(domain, TRANSFER_WITH_AUTHORIZATION, a, p.signature)
  } catch {
    return fail('bad_signature')
  }

  if (getAddress(signer) !== getAddress(a.from)) return fail('signer_mismatch')
  if (getAddress(a.to) !== getAddress(requirements.payTo)) return fail('wrong_recipient')
  if (BigInt(a.value) < BigInt(requirements.maxAmountRequired)) return fail('insufficient_amount')
  if (Number(a.validBefore) <= now) return fail('expired')
  if (Number(a.validAfter) > now) return fail('not_yet_valid')

  return { isValid: true, payer: getAddress(signer), invalidReason: null }
}
