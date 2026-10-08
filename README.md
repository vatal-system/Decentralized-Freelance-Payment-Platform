# Stellar Freelance Payment Platform

A decentralized freelance payment platform built on Stellar. Enables secure, fast, transparent, and low-cost transactions between freelancers and clients — no intermediaries, no borders.

> **Testnet only.** The contracts are unaudited. Do not deploy them to mainnet or move real funds.

## Why Stellar?

- **~5 second finality** — payments confirm faster than a bank transfer clears
- **~$0.00001 per transaction** — fees are negligible even for small milestone payments
- **USDC on Stellar** — stablecoin payments via Circle's SAC-wrapped USDC, eliminating crypto volatility for both parties
- **Soroban smart contracts** — Rust/Wasm contracts with a rich SDK and local testing environment

## How It Works

1. **Client posts a job** — defines milestones (amount + deadline each) and funds the escrow contract.
2. **Freelancer delivers work** — the client releases each milestone as deliverables are approved.
3. **Dispute resolution** — either party can freeze the escrow and raise a dispute; an arbitrator distributes funds fairly.
4. **Reputation** — both parties rate each other on-chain after completion; scores are permanent and verifiable.

## Project status

Honest snapshot of what works today (see [`docs/TESTNET.md`](./docs/TESTNET.md) for live IDs):

| Area | Status |
|------|--------|
| `escrow` contract | ✅ Complete — milestones, expiry refunds, validated inputs, TTL, events |
| `dispute` contract | ✅ Complete — verified raise, M-of-N arbitrator panel resolution that calls back into escrow |
| `reputation` contract | ✅ Complete — escrow-verified 1–5 ratings |
| Contract tests | ✅ 48 tests: every state transition + failure path, plus 3 cross-contract integration tests |
| Testnet deployment | ✅ Deployed and initialized (IDs in `deployments/testnet.json`) |
| Frontend | 🟡 Functional MVP — connect Freighter, create/fund a job, release milestones, view status, open a dispute, read reputation |
| Backend API | 🟡 Routes + auth implemented; **event indexer is still a stub** (DB does not sync from chain yet) |
| Job discovery / filtering | ❌ Not built — you open jobs by id |
| Multi-arbitrator / timelocked disputes | ✅ Multi-arbitrator panel with a timelock escape hatch from `Disputed` (see `docs/DISPUTES.md`) |
| USDC configuration | ❌ Not wired on testnet yet — the demo uses the XLM SAC |
| Security audit | ❌ Not audited |

Scoped work is tracked in [`docs/wave-issues/`](./docs/wave-issues/).

## Deployed contracts (testnet)

| Contract | Contract ID |
|----------|-------------|
| escrow | `CBC4AW7IGPPIVYWASG2QKWZZXBKUSZXQXFS5ZZMAH7YN55DCHKCH65NJ` |
| dispute | `CAKXHJQHJENFY4UYWH5LAMORP4TE3T223AVHGWRN7T6K2OQUPK7E4BEW` |
| reputation | `CCHFZMOHTD26BAYF4NQHTXEAHOW66HPK7DRXHUWQDUQBM7OFNJT7UZTP` |

See [`docs/TESTNET.md`](./docs/TESTNET.md) for explorer links and reproduction steps.

## Architecture

Three Soroban contracts work together; the escrow contract holds the funds and
is the only contract that can move them.

```
Client ── create / fund / release_milestone / reclaim_expired ──► EscrowContract
                                                                     │  ▲
                                          arbitrate() ── resolve() ──┘  │ (dispute contract only)
DisputeContract ◄── Arbitrator                                       │
      │  verifies escrow is Disputed + caller is a party             │
      └── submit(rater, ratee, escrow_id, score) ─► ReputationContract
                      (verifies the job Completed + participants)
```

- **escrow** enforces the state machine `Created → Active → Completed`, with
  `Disputed → Completed` (via arbitration) and `Active → Refunded` (expiry).
- **dispute** can only change escrow funds through `escrow.resolve`, which
  independently checks that the shares sum to the funds held.
- **reputation** refuses any rating unless escrow reports the job `Completed`
  and the rater/ratee are the two participants.

Full details, the contract reference table, and the shared `interface` crate
rationale are in [`CONTRIBUTING.md`](./CONTRIBUTING.md). The events each contract
emits are catalogued in [`docs/EVENTS.md`](./docs/EVENTS.md).

## Stack

- **Smart contracts**: Rust + Soroban SDK v29, compiled to Wasm (`wasm32v1-none`)
- **Frontend**: React 18 + TypeScript + Vite
- **Wallet**: Freighter browser extension
- **Payments**: Stellar Asset Contract (USDC in production)
- **Data**: Soroban RPC + Horizon API
- **Backend**: Express + Prisma + PostgreSQL

## Getting Started

One command (Docker):

```bash
docker compose up --build
```

Or see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the manual setup, testnet
deployment, and contributor conventions.

## Inspiration

This project draws on patterns proven by:
- **Braintrust** (Ethereum/Polygon) — user-owned talent network, 0% freelancer fees
- **Canwork.io** (BNB Chain) — 1% fee, smart-contract escrow
- **.escrow** (Polkadot) — USDT-based escrow with configurable timelocks

Stellar's fee structure and finality speed make it a better fit for the global freelance market than any of these predecessors.

## License

MIT
