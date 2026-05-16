# Stellar Freelance Payment Platform

A decentralized freelance payment platform built on Stellar. Enables secure, fast, transparent, and low-cost transactions between freelancers and clients — no intermediaries, no borders.

## Why Stellar?

- **~5 second finality** — payments confirm faster than a bank transfer clears
- **~$0.00001 per transaction** — fees are negligible even for small milestone payments
- **USDC on Stellar** — stablecoin payments via Circle's SAC-wrapped USDC, eliminating crypto volatility for both parties
- **Soroban smart contracts** — Rust/Wasm contracts with a rich SDK and local testing environment

## How It Works

1. **Client posts a job** — defines milestones (amount + deadline each) and funds the escrow contract with USDC.
2. **Freelancer delivers work** — client releases each milestone as deliverables are approved.
3. **Dispute resolution** — either party can freeze the escrow and raise a dispute; an arbitrator distributes funds fairly.
4. **Reputation** — both parties rate each other on-chain after completion; scores are permanent and verifiable.

## Contracts

| Contract | Purpose |
|----------|---------|
| `escrow` | Holds funds, enforces milestone state machine, handles expiry refunds |
| `dispute` | Arbitration logic; calls back into escrow to distribute frozen funds |
| `reputation` | Immutable on-chain ratings (1–5 stars) per completed job |

## Stack

- **Smart contracts**: Rust + Soroban SDK, compiled to Wasm
- **Frontend**: React 18 + TypeScript + Vite
- **Wallet**: Freighter browser extension
- **Payments**: USDC via Stellar Asset Contract
- **Data**: Soroban RPC + Horizon API

## Getting Started

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions, architecture details, and a list of good first issues.

## Inspiration

This project draws on patterns proven by:
- **Braintrust** (Ethereum/Polygon) — user-owned talent network, 0% freelancer fees, ~$90M gross service volume
- **Canwork.io** (BNB Chain) — 1% fee, smart-contract escrow
- **.escrow** (Polkadot) — USDT-based escrow with configurable timelocks

Stellar's fee structure and finality speed make it a better fit for the global freelance market than any of these predecessors.

## License

MIT
