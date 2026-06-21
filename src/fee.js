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
 * Relayer fee quoting.
 *
 * A relayer submits the signed authorization and pays gas in the chain's native
 * token (ETH/MATIC/…). To be sustainable it wants reimbursement in the
 * *transferred* token (e.g. USDt). This helper computes that reimbursement so a
 * UI can show the user the net amount before they sign:
 *
 *   feeToken = gasUnits · gasPrice (in native) · nativeUsdPrice / tokenUsdPrice
 *
 * Prices are supplied by the caller (any oracle) — nothing is hard-coded. The
 * math is exact BigInt; USD prices are scaled to micro-USD (6 dp) which is ample
 * for a fee quote and cancels cleanly in the native/token ratio.
 */

import { toBigInt } from 'ethers'

const WEI_PER_NATIVE = 10n ** 18n
const PRICE_SCALE = 1_000_000n // micro-USD

function toScaledPrice (price, label) {
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
    throw new Error(`'${label}' must be a positive finite number.`)
  }
  return BigInt(Math.round(price * Number(PRICE_SCALE)))
}

/**
 * Quote a relayer's reimbursement for submitting an authorization, denominated
 * in the transferred token's base units.
 *
 * @param {Object} args
 * @param {number | bigint | string} args.gasUnits - Estimated gas for the submit tx.
 * @param {number | bigint | string} args.gasPriceWei - Gas price in wei (native token).
 * @param {number} args.nativeUsdPrice - USD price of the native gas token (e.g. ETH).
 * @param {number} args.tokenUsdPrice - USD price of the transferred token (e.g. ~1 for USDt).
 * @param {number} args.tokenDecimals - Decimals of the transferred token.
 * @param {number} [args.marginBps=0] - Optional markup the relayer adds, in basis points.
 * @returns {bigint} The fee in token base units.
 */
export function quoteRelayerFee ({ gasUnits, gasPriceWei, nativeUsdPrice, tokenUsdPrice, tokenDecimals, marginBps = 0 }) {
  const gas = toBigInt(gasUnits)
  const gasPrice = toBigInt(gasPriceWei)
  if (gas < 0n || gasPrice < 0n) {
    throw new Error("'gasUnits' and 'gasPriceWei' must be non-negative.")
  }
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0) {
    throw new Error("'tokenDecimals' must be a non-negative integer.")
  }
  if (!Number.isInteger(marginBps) || marginBps < 0) {
    throw new Error("'marginBps' must be a non-negative integer.")
  }

  const nativeMicro = toScaledPrice(nativeUsdPrice, 'nativeUsdPrice')
  const tokenMicro = toScaledPrice(tokenUsdPrice, 'tokenUsdPrice')

  const gasCostWei = gas * gasPrice
  const tokenFactor = 10n ** BigInt(tokenDecimals)

  // feeBase = gasCostWei * nativeMicro * 10^tokenDecimals / (tokenMicro * 10^18)
  // (the micro-USD scale cancels between native and token prices)
  let feeBase = (gasCostWei * nativeMicro * tokenFactor) / (tokenMicro * WEI_PER_NATIVE)

  if (marginBps > 0) {
    feeBase = (feeBase * BigInt(10000 + marginBps)) / 10000n
  }
  return feeBase
}
