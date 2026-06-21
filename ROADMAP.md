# wdk-protocol-eip3009 — Roadmap

> This module is one node in a deliberately larger plan: a **family of WDK
> protocol modules** that give any `@tetherto/wdk` wallet account high-level,
> gasless, standards-based capabilities. This document shows what ships today and
> how the module grows into that standard. Everything in "Shipped" is in this
> repo with brittle tests; later phases are scoped against the real
> `@tetherto/wdk-protocol-*` family that already exists on npm.

## ✅ Phase 1 — Gasless EIP-3009 transfers (SHIPPED)

- ✅ **x402 (HTTP 402 payments)** — this package is the settlement primitive for
  the x402 "exact" scheme (a signed `transferWithAuthorization`). Ships
  `buildPaymentRequirements`, `authorizationForRequirements`, `buildExactPayment`,
  `encode/decodePaymentHeader`, and `verifyExactPayment` (see the README). Powers
  the wallet x402 client and the wdk-checkout facilitator. 27/27 tests pass.

Follows the official `@tetherto/wdk-protocol-*` conventions exactly (JS + JSDoc,
`index.js` + `bare.js` Bare-runtime entry points, `standard` lint, Apache-2.0).

- **TransferWithAuthorization** — sign / verify / submit gasless USDt/USDC transfers.
- **ReceiveWithAuthorization** — front-run-safe variant.
- **CancelAuthorization** — invalidate an unused authorization.
- `build*Transaction` for relayer-side submission; `getAuthorizationState` reads
  on-chain nonce status; EIP-712 domain auto-resolution (EIP-5267).
- Pure, account-free helpers for stateless relayers/back-ends.
- 21 brittle tests (63 asserts), generated TypeScript declarations, runnable
  example, CI (lint + test + types + example), Node + Bare runtime.

This module already powers the gasless path of the
[WDK Pay checkout](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin).

## ⏳ Phase 2 — Permit & meta-transaction breadth

1. ✅ **ERC-2612 `permit`** — done. `src/permit.js` ships the permit sibling of
   the EIP-3009 builders behind the same module surface (same EIP-712 domain):
   `buildPermitMessage` / `buildPermitTypedData` / `hashPermit` /
   `recoverPermitSigner` (+ `encodePermit` and `encodeNoncesCall` for relayer
   submission and reading the sequential `nonces(owner)`). Brittle-tested incl. a
   real-Wallet sign→recover round-trip and cross-impl hash agreement.
2. **Batch authorizations** — sign N transfers in one UX, submit independently.
3. **Gas/fee quoting** — estimate the relayer's reimbursement (in token terms)
   so the UI can show the user the net amount before signing.

## ⏳ Phase 3 — Reference relayer service

4. A small, deployable **reference relayer** (the counterpart to this client-side
   module): accepts signed authorizations, validates them with the pure helpers
   here, submits on-chain, and meters reimbursement. Ships as an example so
   integrators have an end-to-end gasless path, not just the signing half.

## ⏳ Phase 4 — Protocol-family alignment

5. Align with the sibling `@tetherto/wdk-protocol-*` modules so a wallet can
   compose them: **swap** (`-swap-velora-evm`), **lending** (`-lending-aave-evm`),
   **bridge** (`-bridge-usdt0-evm`), **fiat** (`-fiat-moonpay`). EIP-3009 becomes
   the gasless settlement leg those flows can opt into.

---

Part of the WDK reference suite — see the
[Browser Extension](https://github.com/plinkdev1/wdk-wallet-extension/blob/main/ROADMAP.md),
[Template Wallet](https://github.com/plinkdev1/wdk-wallet-template/blob/main/ROADMAP.md),
and [WooCommerce checkout](https://github.com/plinkdev1/wdk-checkout-and-woocommerce-plugin/blob/main/ROADMAP.md)
roadmaps.
