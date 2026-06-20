// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.
//
// Runnable example: a holder signs a gasless USDC transfer authorization, a
// relayer verifies it and builds the on-chain transaction — all offline, with
// no RPC and no real funds. Run with: `npm run example`.

import Eip3009ProtocolEvm from '../index.js'
import { Wallet } from 'ethers'

// 1. The token holder's account. In a real app this is a
//    `@tetherto/wdk-wallet-evm` WalletAccountEvm; here we wrap an ethers Wallet
//    in the minimal account interface the protocol needs.
const holderWallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')

const holderAccount = {
  async getAddress () {
    return holderWallet.address
  },
  async getChainId () {
    return 1n
  },
  async signTypedData ({ domain, types, message }) {
    return holderWallet.signTypedData(domain, types, message)
  }
}

// 2. USDC on Ethereum mainnet. Passing name/version inline avoids any RPC call.
const USDC = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  name: 'USD Coin',
  version: '2'
}

const protocol = new Eip3009ProtocolEvm(holderAccount)

// 3. The holder signs a transfer authorization — no gas, no prior approval.
const authorization = await protocol.signTransferAuthorization({
  token: USDC,
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  value: 25_000_000n // 25 USDC (6 decimals)
})

console.log('Signed authorization:')
console.log({
  from: authorization.from,
  to: authorization.to,
  value: authorization.value.toString(),
  validBefore: authorization.validBefore.toString(),
  nonce: authorization.nonce,
  signature: authorization.signature.slice(0, 22) + '…'
})

// 4. A relayer/merchant verifies the signature is authentic before paying gas.
console.log('\nSignature verifies:', protocol.verifyAuthorization(authorization))

// 5. The relayer builds the on-chain transaction (and would broadcast it with
//    its own gas via `protocol.submitTransferAuthorization(authorization)`).
const tx = protocol.buildTransferTransaction(authorization)
console.log('\nRelayer transaction:')
console.log({ to: tx.to, value: tx.value.toString(), data: tx.data.slice(0, 26) + '…' })

console.log('\nThe holder spent no gas. The relayer submits and pays. ✅')
