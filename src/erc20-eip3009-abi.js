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
 * Minimal human-readable ABI for the EIP-3009 surface of a token contract,
 * plus the EIP-712 metadata reads (`name`, `version`) and the EIP-5267
 * `eip712Domain()` accessor used for domain auto-resolution.
 *
 * Only the `(v, r, s)` signature variants are included: they are the original
 * EIP-3009 spec form and are implemented by every shipped EIP-3009 token
 * (USDC, USDt, EURC, ...). The packed-`bytes signature` overload is optional
 * in the standard and not universally deployed, so it is intentionally omitted.
 *
 * @internal
 */
export const ERC20_EIP3009_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)'
]

export default ERC20_EIP3009_ABI
