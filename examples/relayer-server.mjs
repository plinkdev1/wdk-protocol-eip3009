// Copyright 2026 wdk-protocol-eip3009 contributors
// Licensed under the Apache License, Version 2.0. See the LICENSE file.

/**
 * Reference relayer service — the deployable end-to-end gasless path.
 *
 * A dependency-free Node HTTP server (uses only `node:http` + ethers, already a
 * dep) that accepts a signed EIP-3009 authorization, verifies it, and submits it
 * on-chain, paying gas. The holder's transfer is therefore gasless.
 *
 * Run:
 *   RPC_URL=https://… RELAYER_PRIVATE_KEY=0x… node examples/relayer-server.mjs
 *
 * Then POST a signed authorization:
 *   curl -sX POST localhost:8787/relay -H 'content-type: application/json' -d '{
 *     "domain":   { "name":"USD Coin","version":"2","chainId":1,"verifyingContract":"0x…" },
 *     "message":  { "from":"0x…","to":"0x…","value":"1000000","validAfter":"0","validBefore":"99999999999","nonce":"0x…" },
 *     "signature":"0x…"
 *   }'
 *   → { "txHash": "0x…", "payer": "0x…" }
 *
 * This is a REFERENCE: you supply RPC_URL + RELAYER_PRIVATE_KEY (the gas payer —
 * never a user key). Add your own allow-listing / rate-limiting / reimbursement
 * metering (see quoteRelayerFee) before production.
 */
import { createServer } from 'node:http'
import { JsonRpcProvider, Wallet } from 'ethers'
import { relayAuthorization } from '../index.js'

const { RPC_URL, RELAYER_PRIVATE_KEY, PORT = '8787' } = process.env
if (!RPC_URL || !RELAYER_PRIVATE_KEY) {
  console.error('Set RPC_URL and RELAYER_PRIVATE_KEY in the environment.')
  process.exit(1)
}

const wallet = new Wallet(RELAYER_PRIVATE_KEY, new JsonRpcProvider(RPC_URL))

/** Broadcasts the encoded call and pays gas. */
async function submitTransaction ({ to, data }) {
  const tx = await wallet.sendTransaction({ to, data })
  return { txHash: tx.hash }
}

function readJson (req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 1_000_000) reject(new Error('payload too large')) })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { reject(new Error('invalid JSON body')) } })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  if (req.method !== 'POST' || req.url !== '/relay') {
    return json(404, { error: 'POST /relay' })
  }
  try {
    const { domain, primaryType, message, signature } = await readJson(req)
    const result = await relayAuthorization({ domain, primaryType, message, signature, submitTransaction })
    json(200, result)
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) })
  }
})

server.listen(Number(PORT), () => console.log(`eip3009 reference relayer on :${PORT} (POST /relay)`))
