# Examples

Runnable demonstrations of the two halves of the gasless path.

## `gasless-transfer.mjs` — the client half

Build, sign, and (optionally) submit a `transferWithAuthorization`. Run:

```bash
npm run example
```

## `relayer-server.mjs` — the server half (reference relayer)

A dependency-free Node HTTP service (just `node:http` + ethers) that accepts a
signed authorization, verifies it, and submits it on-chain — paying the gas so
the holder's transfer is gasless. It's the deployable counterpart to the
client-side builders.

```bash
RPC_URL=https://your-rpc RELAYER_PRIVATE_KEY=0xYOUR_GAS_PAYER_KEY \
  node examples/relayer-server.mjs
# → eip3009 reference relayer on :8787 (POST /relay)
```

Submit a signed authorization (the wallet/extension produces this):

```bash
curl -sX POST localhost:8787/relay -H 'content-type: application/json' -d '{
  "domain":   { "name":"USD Coin","version":"2","chainId":1,"verifyingContract":"0xTOKEN" },
  "message":  { "from":"0xHOLDER","to":"0xMERCHANT","value":"1000000","validAfter":"0","validBefore":"99999999999","nonce":"0x…" },
  "signature":"0xHOLDER_SIGNATURE"
}'
# → { "txHash": "0x…", "payer": "0xHOLDER" }
```

The verify-and-submit core is the exported `relayAuthorization` (unit-tested);
the server just wires an ethers submitter and HTTP around it. **This is a
reference** — `RELAYER_PRIVATE_KEY` is the gas payer (never a user key). Add your
own allow-listing, rate-limiting, and reimbursement metering (see
`quoteRelayerFee`) before production.
