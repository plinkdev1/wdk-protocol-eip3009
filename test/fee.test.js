// Copyright 2026 wdk-protocol-eip3009 contributors
//
// Licensed under the Apache License, Version 2.0 (the "License").
// See the LICENSE file for details.

'use strict'

import test from 'brittle'

import { quoteRelayerFee } from '../index.js'

test('quoteRelayerFee converts gas cost to token base units', (t) => {
  // 100k gas @ 20 gwei = 0.002 ETH; ETH=$3000, USDt=$1 → $6 → 6.000000 USDt
  const fee = quoteRelayerFee({
    gasUnits: 100000n,
    gasPriceWei: 20000000000n, // 20 gwei
    nativeUsdPrice: 3000,
    tokenUsdPrice: 1,
    tokenDecimals: 6
  })
  t.is(fee, 6000000n)
})

test('quoteRelayerFee applies a margin (bps)', (t) => {
  const base = { gasUnits: 100000n, gasPriceWei: 20000000000n, nativeUsdPrice: 3000, tokenUsdPrice: 1, tokenDecimals: 6 }
  t.is(quoteRelayerFee({ ...base, marginBps: 1000 }), 6600000n) // +10%
})

test('quoteRelayerFee handles a non-$1 token and 18-decimals', (t) => {
  // 50k gas @ 10 gwei = 0.0005 ETH; ETH=$2000 → $1; token=$2 → 0.5 token (18 dp)
  const fee = quoteRelayerFee({
    gasUnits: 50000n,
    gasPriceWei: 10000000000n,
    nativeUsdPrice: 2000,
    tokenUsdPrice: 2,
    tokenDecimals: 18
  })
  t.is(fee, 500000000000000000n) // 0.5 * 1e18
})

test('quoteRelayerFee accepts string/number gas inputs', (t) => {
  const fee = quoteRelayerFee({ gasUnits: '100000', gasPriceWei: '20000000000', nativeUsdPrice: 3000, tokenUsdPrice: 1, tokenDecimals: 6 })
  t.is(fee, 6000000n)
})

test('quoteRelayerFee rejects invalid prices and inputs', (t) => {
  const base = { gasUnits: 100000n, gasPriceWei: 20000000000n, nativeUsdPrice: 3000, tokenUsdPrice: 1, tokenDecimals: 6 }
  t.exception(() => quoteRelayerFee({ ...base, nativeUsdPrice: 0 }))
  t.exception(() => quoteRelayerFee({ ...base, tokenUsdPrice: -1 }))
  t.exception(() => quoteRelayerFee({ ...base, tokenDecimals: -1 }))
  t.exception(() => quoteRelayerFee({ ...base, marginBps: -5 }))
})
