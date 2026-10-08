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
| `reputation` contract | ✅ Complete — escrow-verified 1–5 ratings, amount-weighted aggregates (`docs/REPUTATION.md`) |
| Contract tests | ✅ 81 tests: every state transition + failure path, plus 3 cross-contract integration tests |
| Testnet deployment | ✅ Deployed and initialized (IDs in `deployments/testnet.json`) |
| Frontend | 🟡 Functional MVP — connect Freighter, create/fund a job, release milestones, view status, open a dispute, read reputation |
| Backend API | ✅ Routes + auth implemented; contract-event indexer syncs DB state from Soroban RPC, with a dead-letter table for events it cannot apply |
| Job discovery / filtering | ✅ Dashboard lists jobs with status/pagination (from the backend API) |
| Multi-arbitrator / timelocked disputes | ✅ Multi-arbitrator panel with a timelock escape hatch from `Disputed` (see `docs/DISPUTES.md`) |
| Dispute resolution authorization | ✅ `POST /api/disputes/:id/resolve` requires an `ARBITRATOR_ADDRESSES` allowlist entry |
| USDC configuration | ❌ Not wired on testnet yet — the demo uses the XLM SAC |
| Security audit | ❌ Not audited |

Scoped work is tracked in [`docs/wave-issues/`](./docs/wave-issues/).

## Deployed contracts (testnet)

| Contract | Contract ID |
|----------|-------------|
| escrow | `CALNRFGMUI7MLNLWO445U2BSDENF6DENURHXXFFRT6PV5GSOQX7GZGP7` |
| dispute | `CB24TF5GPP7EA6VWK4KZWBHHSY6FWNV3DKOGSZSDK347EODGGNPN7IMF` |
| reputation | `CA5GXR4LVH5DYGB2RZDFAM3VNJW6LQ5EKUKURSLZBJGAH7LFJAOHKSET` |

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
emits are catalogued in [`docs/EVENTS.md`](./docs/EVENTS.md). A job can pay in
any registered Stellar Asset Contract; see [`docs/ASSETS.md`](./docs/ASSETS.md)
for the registry and how to add one.

## Stack

- **Smart contracts**: Rust + Soroban SDK v29, compiled to Wasm (`wasm32v1-none`)
- **Frontend**: React 18 + TypeScript + Vite
- **Wallet**: Freighter browser extension
- **Payments**: Stellar Asset Contract (USDC in production)
- **Data**: Soroban RPC + Horizon API
- **Backend**: Express + Prisma + PostgreSQL

## Deployment

Contract ids are recorded in [`deployments/testnet.json`](./deployments/testnet.json)
and change on every deploy. `scripts/deploy_testnet.sh` regenerates
`frontend/.env` automatically (backing up the previous file) so the app never
keeps pointing at superseded contracts.

- **Frontend** — static Vite build, deployable to any static host (Vercel,
  Netlify, GitHub Pages). Set the `VITE_*` variables at build time; Vite inlines
  them, so changing one requires a rebuild. `frontend/vercel.json` ships the SPA
  rewrite that React Router needs for deep links.
- **Backend** — needs a long-running process (the event indexer polls Soroban RPC
  in-process) plus PostgreSQL, so it runs as a container rather than a serverless
  function. `backend/Dockerfile` applies migrations on start.
- **CORS** — set `CORS_ORIGIN` to the frontend origin so the API is not open to
  every origin. Comma-separate multiple origins.

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for the full checklist.

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
