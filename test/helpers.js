// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import { Wallet } from 'ethers'

// A well-known deterministic test key (Hardhat account #0). NOT a secret — it
// is published in every Ethereum dev toolchain and holds no real funds.
export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// A representative EIP-3009 token reference (USDC on Ethereum mainnet shape),
// in the { address, name, version } form the protocol's sign* methods accept.
export const TEST_TOKEN = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  name: 'USD Coin',
  version: '2',
  chainId: 1
}

// The same token expressed as a raw EIP-712 domain ({ verifyingContract }
// form), which the pure helpers (buildDomain, hashAuthorization, ...) consume.
export const TEST_DOMAIN = {
  name: TEST_TOKEN.name,
  version: TEST_TOKEN.version,
  chainId: TEST_TOKEN.chainId,
  verifyingContract: TEST_TOKEN.address
}

/**
 * Creates a mock wallet account that signs with a real ethers Wallet (so
 * signatures verify) and records broadcast transactions.
 *
 * @param {Object} [options]
 * @param {string} [options.privateKey]
 * @param {bigint} [options.chainId]
 * @returns {Object} The mock account.
 */
export function createMockAccount ({ privateKey = TEST_PRIVATE_KEY, chainId = 1n } = {}) {
  const wallet = new Wallet(privateKey)
  const sent = []

  return {
    wallet,
    sent,
    async getAddress () {
      return wallet.address
    },
    async getChainId () {
      return chainId
    },
    async signTypedData ({ domain, types, message }) {
      return wallet.signTypedData(domain, types, message)
    },
    async sendTransaction (tx, config) {
      sent.push({ tx, config })
      return { hash: '0x' + 'ab'.repeat(32), fee: 21000n }
    },
    async quoteSendTransaction () {
      return { fee: 21000n }
    }
  }
}

/**
 * Creates a read-only mock account (can derive an address but cannot sign or
 * send).
 *
 * @param {Object} [options]
 * @param {bigint} [options.chainId]
 * @returns {Object} The read-only mock account.
 */
export function createReadOnlyMockAccount ({ chainId = 1n } = {}) {
  return {
    async getAddress () {
      return TEST_ADDRESS
    },
    async getChainId () {
      return chainId
    }
  }
}
