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

import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress } from 'ethers'

import { ERC20_EIP3009_ABI } from './erc20-eip3009-abi.js'
import {
  CANCEL_AUTHORIZATION,
  RECEIVE_WITH_AUTHORIZATION,
  TRANSFER_WITH_AUTHORIZATION,
  assertNonce,
  buildAuthorizationMessage,
  buildDomain,
  encodeCancelAuthorization,
  encodeReceiveWithAuthorization,
  encodeTransferWithAuthorization,
  generateNonce,
  getAuthorizationTypes,
  nowInSeconds,
  recoverAuthorizationSigner,
  splitSignature
} from './eip3009.js'

/** @typedef {import('./eip3009.js').Eip712Domain} Eip712Domain */

/**
 * The minimal surface a wallet account must expose to be used with this
 * protocol. Any `@tetherto/wdk-wallet-evm` `WalletAccountEvm` (or its
 * read-only / ERC-4337 variants) satisfies it.
 *
 * @typedef {Object} Eip3009Account
 * @property {() => Promise<string>} getAddress - Returns the account's address.
 * @property {(typedData: { domain: object, types: object, message: object }) => Promise<string>} [signTypedData] - Signs EIP-712 typed data. Required for the `sign*` methods.
 * @property {(tx: { to: string, value?: bigint | number, data: string }, config?: any) => Promise<TransactionResult>} [sendTransaction] - Broadcasts a transaction. Required for the `submit*` methods.
 * @property {(tx: { to: string, value?: bigint | number, data: string }, config?: any) => Promise<{ fee: bigint }>} [quoteSendTransaction] - Estimates a transaction's cost. Required for `quote*`.
 * @property {() => Promise<number | bigint>} [getChainId] - Returns the connected chain id.
 * @property {{ provider?: string | object, chainId?: number | bigint }} [_config] - The account's runtime config (used to derive a read provider).
 */

/**
 * @typedef {Object} TransactionResult
 * @property {string} hash - The transaction's hash.
 * @property {bigint} fee - The gas cost.
 */

/**
 * A token reference: either a bare address (domain auto-resolved on-chain) or
 * an explicit descriptor that skips the network round-trip.
 *
 * @typedef {string | { address: string, name?: string, version?: string, chainId?: number | bigint }} TokenRef
 */

/**
 * @typedef {Object} SignAuthorizationOptions
 * @property {TokenRef} token - The EIP-3009 token.
 * @property {string} to - The recipient address.
 * @property {number | bigint | string} value - The amount in the token's base unit.
 * @property {number | bigint} [validAfter] - Unix seconds the authorization becomes valid. Defaults to 0 (immediately).
 * @property {number | bigint} [validBefore] - Unix seconds the authorization expires. Defaults to now + `ttlSeconds`.
 * @property {number} [ttlSeconds] - Lifetime used to compute `validBefore` when it is omitted. Defaults to the protocol's `ttlSeconds`.
 * @property {string} [nonce] - A 32-byte hex nonce. Defaults to a fresh random nonce.
 */

/**
 * @typedef {Object} SignedAuthorization
 * @property {'transfer' | 'receive'} kind - Which authorization was signed.
 * @property {string} primaryType - The EIP-712 primary type.
 * @property {string} token - The token contract address.
 * @property {Eip712Domain} domain - The EIP-712 domain used.
 * @property {string} from - The token holder (signer).
 * @property {string} to - The recipient.
 * @property {bigint} value - The transfer amount.
 * @property {bigint} validAfter - Validity start (unix seconds).
 * @property {bigint} validBefore - Validity end (unix seconds).
 * @property {string} nonce - The 32-byte hex nonce.
 * @property {string} signature - The 65-byte hex signature.
 * @property {number} v - Signature recovery id.
 * @property {string} r - Signature r component.
 * @property {string} s - Signature s component.
 */

const DEFAULT_TTL_SECONDS = 3600

/**
 * Interface to the EIP-3009 (`transferWithAuthorization`) surface of a token,
 * for EVM blockchains.
 *
 * EIP-3009 lets a token holder authorize a transfer with an off-chain
 * signature (no gas, no prior approval); anyone — a relayer, a merchant, the
 * recipient — can then submit that signature on-chain and pay the gas. This is
 * the basis for gasless USDt/USDC payments.
 *
 * The protocol is initialized with a wallet account. The `sign*` methods use
 * the account to produce signatures (the holder); the `submit*` methods use it
 * to broadcast (the relayer). The two roles are usually different accounts in
 * production, so the signing and submission halves can be used independently.
 */
export default class Eip3009ProtocolEvm {
  /**
   * Creates a new EIP-3009 protocol interface bound to a wallet account.
   *
   * @param {Eip3009Account} account - The wallet account used to sign and/or submit authorizations.
   * @param {Object} [options] - Protocol options.
   * @param {number} [options.ttlSeconds] - Default authorization lifetime in seconds (default: 3600).
   * @throws {Error} If the account does not expose a `getAddress` method.
   */
  constructor (account, options = {}) {
    if (account === null || typeof account !== 'object' || typeof account.getAddress !== 'function') {
      throw new Error("'account' must be a wallet account exposing a getAddress() method.")
    }

    /** @private */
    this._account = account

    /** @private */
    this._ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS

    /** @private */
    this._provider = undefined

    const config = account._config
    if (config && config.provider) {
      this._provider = typeof config.provider === 'string'
        ? new JsonRpcProvider(config.provider)
        : new BrowserProvider(config.provider)
    }
  }

  /**
   * Generates a fresh random 32-byte nonce.
   *
   * @returns {string} A `0x`-prefixed 32-byte hex nonce.
   */
  generateNonce () {
    return generateNonce()
  }

  /**
   * Signs a `TransferWithAuthorization` — a gasless authorization that lets
   * anyone move `value` tokens from the signer to `to`.
   *
   * @param {SignAuthorizationOptions} options - The authorization options.
   * @returns {Promise<SignedAuthorization>} The signed authorization, ready to submit.
   * @throws {Error} If the account cannot sign, or any option is invalid.
   */
  async signTransferAuthorization (options) {
    return this._signAuthorization(TRANSFER_WITH_AUTHORIZATION, 'transfer', options)
  }

  /**
   * Signs a `ReceiveWithAuthorization`. Identical to a transfer authorization
   * except the on-chain call enforces `msg.sender == to`, which prevents a
   * front-runner from submitting the authorization to a different recipient.
   * Prefer this when the recipient (e.g. a merchant) submits the transaction.
   *
   * @param {SignAuthorizationOptions} options - The authorization options.
   * @returns {Promise<SignedAuthorization>} The signed authorization, ready to submit.
   * @throws {Error} If the account cannot sign, or any option is invalid.
   */
  async signReceiveAuthorization (options) {
    return this._signAuthorization(RECEIVE_WITH_AUTHORIZATION, 'receive', options)
  }

  /**
   * Signs a `CancelAuthorization`, invalidating a not-yet-used nonce so a
   * previously-signed (but unsubmitted) authorization can never be redeemed.
   *
   * @param {Object} options - The cancellation options.
   * @param {TokenRef} options.token - The EIP-3009 token.
   * @param {string} options.nonce - The 32-byte hex nonce to cancel.
   * @returns {Promise<{ authorizer: string, token: string, domain: Eip712Domain, nonce: string, signature: string, v: number, r: string, s: string }>} The signed cancellation.
   * @throws {Error} If the account cannot sign, or any option is invalid.
   */
  async signCancelAuthorization ({ token, nonce }) {
    this._assertCanSign()
    assertNonce(nonce)

    const domain = await this._resolveDomain(token)
    const authorizer = getAddress(await this._account.getAddress())
    const message = { authorizer, nonce }

    const signature = await this._account.signTypedData({
      domain,
      types: getAuthorizationTypes(CANCEL_AUTHORIZATION),
      message
    })

    return { authorizer, token: domain.verifyingContract, domain, nonce, signature, ...splitSignature(signature) }
  }

  /**
   * Builds the unsigned transaction (`{ to, value, data }`) that submits a
   * signed transfer authorization on-chain. Useful when a relayer wants the
   * calldata to broadcast with its own signer instead of this account.
   *
   * @param {SignedAuthorization} authorization - A signed transfer authorization.
   * @returns {{ to: string, value: bigint, data: string }} The unsigned transaction.
   */
  buildTransferTransaction (authorization) {
    return {
      to: this._tokenOf(authorization),
      value: 0n,
      data: encodeTransferWithAuthorization(authorization)
    }
  }

  /**
   * Builds the unsigned transaction that submits a signed receive authorization.
   *
   * @param {SignedAuthorization} authorization - A signed receive authorization.
   * @returns {{ to: string, value: bigint, data: string }} The unsigned transaction.
   */
  buildReceiveTransaction (authorization) {
    return {
      to: this._tokenOf(authorization),
      value: 0n,
      data: encodeReceiveWithAuthorization(authorization)
    }
  }

  /**
   * Builds the unsigned transaction that submits a signed cancellation.
   *
   * @param {{ token: string, authorizer: string, nonce: string, signature: string }} cancellation - A signed cancellation.
   * @returns {{ to: string, value: bigint, data: string }} The unsigned transaction.
   */
  buildCancelTransaction (cancellation) {
    return {
      to: this._tokenOf(cancellation),
      value: 0n,
      data: encodeCancelAuthorization(cancellation)
    }
  }

  /**
   * Submits a signed transfer authorization on-chain via the bound account
   * (the relayer pays the gas).
   *
   * @param {SignedAuthorization} authorization - A signed transfer authorization.
   * @param {any} [config] - Optional account-specific send config (e.g. ERC-4337 paymaster options).
   * @returns {Promise<TransactionResult>} The broadcast transaction's result.
   * @throws {Error} If the account cannot send transactions.
   */
  async submitTransferAuthorization (authorization, config) {
    this._assertCanSend()
    return this._account.sendTransaction(this.buildTransferTransaction(authorization), config)
  }

  /**
   * Submits a signed receive authorization on-chain via the bound account.
   *
   * @param {SignedAuthorization} authorization - A signed receive authorization.
   * @param {any} [config] - Optional account-specific send config.
   * @returns {Promise<TransactionResult>} The broadcast transaction's result.
   * @throws {Error} If the account cannot send transactions.
   */
  async submitReceiveAuthorization (authorization, config) {
    this._assertCanSend()
    return this._account.sendTransaction(this.buildReceiveTransaction(authorization), config)
  }

  /**
   * Submits a signed cancellation on-chain via the bound account.
   *
   * @param {{ token: string, authorizer: string, nonce: string, signature: string }} cancellation - A signed cancellation.
   * @param {any} [config] - Optional account-specific send config.
   * @returns {Promise<TransactionResult>} The broadcast transaction's result.
   * @throws {Error} If the account cannot send transactions.
   */
  async submitCancelAuthorization (cancellation, config) {
    this._assertCanSend()
    return this._account.sendTransaction(this.buildCancelTransaction(cancellation), config)
  }

  /**
   * Quotes the gas cost of submitting a signed transfer authorization, without
   * broadcasting it.
   *
   * @param {SignedAuthorization} authorization - A signed transfer authorization.
   * @param {any} [config] - Optional account-specific send config.
   * @returns {Promise<{ fee: bigint }>} The estimated cost.
   * @throws {Error} If the account cannot quote transactions.
   */
  async quoteTransferAuthorization (authorization, config) {
    if (typeof this._account.quoteSendTransaction !== 'function') {
      throw new Error('The bound account does not support quoteSendTransaction.')
    }
    const { fee } = await this._account.quoteSendTransaction(this.buildTransferTransaction(authorization), config)
    return { fee }
  }

  /**
   * Verifies that a signed authorization was produced by its declared `from`
   * address (or `authorizer`, for cancellations).
   *
   * @param {SignedAuthorization | { authorizer: string, domain: Eip712Domain, nonce: string, signature: string }} authorization - A signed authorization or cancellation.
   * @returns {boolean} `true` if the signature recovers to the expected signer.
   */
  verifyAuthorization (authorization) {
    const { domain, signature } = authorization

    if (authorization.primaryType === CANCEL_AUTHORIZATION || authorization.authorizer !== undefined) {
      const expected = authorization.authorizer
      const message = { authorizer: getAddress(expected), nonce: authorization.nonce }
      return addressesEqual(recoverAuthorizationSigner(domain, CANCEL_AUTHORIZATION, message, signature), expected)
    }

    const primaryType = authorization.kind === 'receive' ? RECEIVE_WITH_AUTHORIZATION : TRANSFER_WITH_AUTHORIZATION
    const message = messageOf(authorization)
    return addressesEqual(recoverAuthorizationSigner(domain, primaryType, message, signature), authorization.from)
  }

  /**
   * Reads whether a given (authorizer, nonce) authorization has already been
   * used or cancelled on-chain. Requires a configured provider.
   *
   * @param {Object} options - The query.
   * @param {string} options.token - The token contract address.
   * @param {string} options.authorizer - The authorizing address.
   * @param {string} options.nonce - The 32-byte hex nonce.
   * @returns {Promise<boolean>} `true` if the nonce has been used or cancelled.
   * @throws {Error} If no provider is configured or inputs are invalid.
   */
  async getAuthorizationState ({ token, authorizer, nonce }) {
    if (!isAddress(authorizer) || authorizer === ZeroAddress) {
      throw new Error("'authorizer' must be a valid address.")
    }
    assertNonce(nonce)
    const contract = this._getTokenContract(tokenAddressOf(token))
    return contract.authorizationState(getAddress(authorizer), nonce)
  }

  /** @private */
  async _signAuthorization (primaryType, kind, { token, to, value, validAfter, validBefore, ttlSeconds, nonce }) {
    this._assertCanSign()

    const domain = await this._resolveDomain(token)
    const from = getAddress(await this._account.getAddress())

    const resolvedValidAfter = validAfter ?? 0
    const resolvedValidBefore = validBefore ?? (nowInSeconds() + BigInt(ttlSeconds ?? this._ttlSeconds))
    const resolvedNonce = nonce ?? generateNonce()

    const message = buildAuthorizationMessage({
      from,
      to,
      value,
      validAfter: resolvedValidAfter,
      validBefore: resolvedValidBefore,
      nonce: resolvedNonce
    })

    const signature = await this._account.signTypedData({
      domain,
      types: getAuthorizationTypes(primaryType),
      message
    })

    return {
      kind,
      primaryType,
      token: domain.verifyingContract,
      domain,
      ...message,
      signature,
      ...splitSignature(signature)
    }
  }

  /** @private */
  async _resolveDomain (token) {
    if (token !== null && typeof token === 'object') {
      const { address, name, version, chainId } = token
      if (!isAddress(address)) {
        throw new Error("'token.address' must be a valid address.")
      }
      if (name !== undefined && version !== undefined) {
        return buildDomain({ name, version, chainId: chainId ?? await this._resolveChainId(), verifyingContract: address })
      }
      return this._resolveDomainOnChain(address, chainId)
    }

    if (!isAddress(token)) {
      throw new Error("'token' must be a valid address or a { address, name, version } descriptor.")
    }
    return this._resolveDomainOnChain(token)
  }

  /** @private */
  async _resolveDomainOnChain (address, chainId) {
    const contract = this._getTokenContract(address)
    let name
    let version
    try {
      const domain = await contract.eip712Domain()
      name = domain.name
      version = domain.version
      chainId = chainId ?? domain.chainId
    } catch {
      name = await contract.name()
      version = await safeVersion(contract)
    }
    return buildDomain({ name, version, chainId: chainId ?? await this._resolveChainId(), verifyingContract: address })
  }

  /** @private */
  async _resolveChainId () {
    if (typeof this._account.getChainId === 'function') {
      return this._account.getChainId()
    }
    if (this._account._config && this._account._config.chainId !== undefined) {
      return this._account._config.chainId
    }
    if (this._provider) {
      const network = await this._provider.getNetwork()
      return network.chainId
    }
    throw new Error('Unable to resolve chainId: provide token.chainId, or configure the account with a provider/chainId.')
  }

  /** @private */
  _getTokenContract (address) {
    if (!this._provider) {
      throw new Error('A provider is required for on-chain reads. Configure the account with a provider, or pass token as a { address, name, version } descriptor.')
    }
    return new Contract(getAddress(address), ERC20_EIP3009_ABI, this._provider)
  }

  /** @private */
  _tokenOf (authorization) {
    return getAddress(authorization.token ?? authorization.domain.verifyingContract)
  }

  /** @private */
  _assertCanSign () {
    if (typeof this._account.signTypedData !== 'function') {
      throw new Error('This operation requires an account that can sign typed data (a non read-only WalletAccountEvm).')
    }
  }

  /** @private */
  _assertCanSend () {
    if (typeof this._account.sendTransaction !== 'function') {
      throw new Error('This operation requires an account that can send transactions (a non read-only WalletAccountEvm).')
    }
  }
}

/** @private */
function messageOf (authorization) {
  return {
    from: getAddress(authorization.from),
    to: getAddress(authorization.to),
    value: authorization.value,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce
  }
}

/** @private */
function tokenAddressOf (token) {
  return typeof token === 'object' ? token.address : token
}

/** @private */
function addressesEqual (a, b) {
  return getAddress(a) === getAddress(b)
}

/** @private */
async function safeVersion (contract) {
  try {
    return await contract.version()
  } catch {
    return '1'
  }
}
