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

/** @typedef {import('./src/eip3009-protocol-evm.js').Eip3009Account} Eip3009Account */
/** @typedef {import('./src/eip3009-protocol-evm.js').SignAuthorizationOptions} SignAuthorizationOptions */
/** @typedef {import('./src/eip3009-protocol-evm.js').SignedAuthorization} SignedAuthorization */
/** @typedef {import('./src/eip3009-protocol-evm.js').TokenRef} TokenRef */
/** @typedef {import('./src/eip3009-protocol-evm.js').TransactionResult} TransactionResult */
/** @typedef {import('./src/eip3009.js').Eip712Domain} Eip712Domain */
/** @typedef {import('./src/eip3009.js').TransferAuthorizationMessage} TransferAuthorizationMessage */

export { default } from './src/eip3009-protocol-evm.js'
export { default as Eip3009ProtocolEvm } from './src/eip3009-protocol-evm.js'

// Pure, account-free helpers — useful for relayers/back-ends that only need to
// verify or encode authorizations without a wallet account.
export {
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
  getEip3009Interface,
  hashAuthorization,
  nowInSeconds,
  recoverAuthorizationSigner,
  serializeSignature,
  splitSignature
} from './src/eip3009.js'

export { ERC20_EIP3009_ABI } from './src/erc20-eip3009-abi.js'
