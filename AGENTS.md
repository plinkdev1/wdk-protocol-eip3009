# Agent Guide

This repository is a community module for the Tether WDK (Wallet Development Kit)
ecosystem. It follows the same coding conventions and tooling standards as the
official `@tetherto/wdk-protocol-*` packages to ensure consistency, reliability,
and cross-platform compatibility (Node.js and Bare runtime).

## Project Overview
- **Domain:** EIP-3009 (`transferWithAuthorization`) — gasless, signature-based stablecoin transfers.
- **Architecture:** A WDK protocol module. It operates on a wallet account (from `@tetherto/wdk-wallet-evm`) and exposes a single protocol class plus pure helpers.
- **Runtime:** Supports both Node.js and Bare runtime.

## Tech Stack & Tooling
- **Language:** JavaScript (ES2022+). Source stays JavaScript; TypeScript is used only to generate `.d.ts`.
- **Module System:** ES Modules (`"type": "module"`).
- **Type Declarations:** `npm run build:types` (tsc, declaration-only, from JSDoc).
- **Linting:** `standard` (JavaScript Standard Style) — `npm run lint` / `npm run lint:fix`.
- **Testing:** `brittle` (the holepunch TAP framework, Bare-compatible) — `npm test` (Node) and `npm run test:bare` (Bare).
- **Key dependency:** `ethers` v6 for EIP-712 encoding, signing recovery, and ABI calldata.

## Coding Conventions
- **File Naming:** kebab-case (e.g. `eip3009-protocol-evm.js`).
- **Class Naming:** PascalCase (e.g. `Eip3009ProtocolEvm`).
- **Private Members:** prefixed with `_` and documented with `@private`.
- **Imports:** explicit `.js` extensions are mandatory.
- **Copyright:** every source file carries the Apache-2.0 header.

## Documentation (JSDoc)
Source is strictly annotated with JSDoc so `build:types` produces complete declarations.
- `@typedef` for shared shapes, `@param` / `@returns` / `@throws` on every public method.

## Layout
- `index.js` — main entry (Node/default). Re-exports the protocol class and pure helpers.
- `bare.js` — Bare runtime entry (`bare-node-runtime`).
- `src/eip3009-protocol-evm.js` — the `Eip3009ProtocolEvm` class.
- `src/eip3009.js` — pure, account-free helpers (domain, types, nonce, hash, recover, encode).
- `src/erc20-eip3009-abi.js` — the minimal EIP-3009 token ABI.
- `test/*.test.js` — brittle tests.
- `examples/` — runnable usage examples.
- `types/` — generated declarations (not committed; built on publish).

## Development Workflow
1. `npm install`
2. `npm run lint`
3. `npm test`
4. `npm run build:types`
