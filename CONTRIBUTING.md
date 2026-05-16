# Contributing

Thank you for your interest in contributing. This document explains how the project is structured, how to get your environment running, and the conventions to follow.

---

## Project Structure

```
.
├── contracts/               # Soroban smart contracts (Rust)
│   ├── escrow/              # Core escrow + milestone logic
│   ├── dispute/             # Dispute arbitration
│   └── reputation/          # On-chain ratings
├── frontend/                # React + TypeScript dapp
│   └── src/
│       ├── lib/stellar.ts   # Network config & SDK wrapper
│       ├── hooks/           # Contract interaction hooks
│       └── pages/           # Route-level components
└── docs/                    # Architecture diagrams, ADRs
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target | – | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | latest | `cargo install --locked stellar-cli --features opt` |
| Node.js | ≥ 20 | https://nodejs.org |

---

## Local Development

### Contracts

```bash
cd contracts

# Build all contracts
stellar contract build

# Run tests
cargo test

# Deploy to testnet (requires funded testnet account)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --network testnet \
  --source <YOUR_SECRET_KEY>
```

After deploying, copy the contract IDs into `frontend/.env` (see `frontend/.env.example`).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # fill in contract IDs
npm run dev            # starts at http://localhost:5173
```

---

## Architecture Overview

### Smart Contracts

Three Soroban contracts work together:

```
Client ──fund()──► EscrowContract ──release_milestone()──► Freelancer
                        │
                   open_dispute()
                        │
                        ▼
                  DisputeContract ──arbitrate()──► EscrowContract.resolve()
                        
ReputationContract  ◄──submit()── (either party, after completion)
```

**EscrowContract** is the central contract. It holds funds and enforces the job state machine:

```
Created → Funded/Active → Completed
                       ↘ Disputed → Resolved
                       ↘ Expired  → Refunded
```

**DisputeContract** is called when either party raises a dispute. Phase 1 uses a single trusted arbitrator. Phase 2 will use a multi-sig panel.

**ReputationContract** stores immutable post-job ratings (1–5 stars) keyed by `(rater, escrow_id)` to prevent duplicates.

### Token

All payments use USDC on Stellar (Circle's SAC-wrapped asset). This eliminates volatility risk for both parties. XLM is only used for network fees (~$0.00001 per transaction).

### Frontend

React + TypeScript SPA. Freighter browser wallet handles key management and transaction signing — no private keys ever touch the frontend code.

---

## Good First Issues

Search for `TODO` comments in the codebase. Each one is a scoped, self-contained task:

- `contracts/escrow/src/lib.rs` — fill in the three test stubs
- `contracts/dispute/src/lib.rs` — wire the cross-contract call to `escrow.resolve()`
- `contracts/reputation/src/lib.rs` — add cross-contract escrow verification in `submit()`
- `frontend/src/pages/PostJob.tsx` — build the dynamic milestone form fields
- `frontend/src/pages/Dashboard.tsx` — implement Freighter wallet connection
- `frontend/src/pages/JobDetail.tsx` — poll for escrow status updates

---

## Conventions

- **Checks-Effects-Interactions**: in every contract function, validate state first, update storage second, transfer tokens last.
- **No panics in production paths**: use `Result` / `contracttype` errors instead of `assert!` in non-test code (the current `assert!` calls are placeholders).
- **One PR per concern**: keep contract changes and frontend changes in separate PRs when possible.
- **Test coverage**: every new contract function needs at least one passing test before merge.

---

## Roadmap

| Phase | Scope |
|-------|-------|
| 1 – MVP | Escrow + milestone release + single-arbitrator dispute + basic frontend |
| 2 – Reputation | On-chain ratings, profile pages, reputation-gated job visibility |
| 3 – Governance | Multi-sig dispute panel, community arbitrator election |
| 4 – Discovery | Job board, search, skill tags, off-chain metadata via IPFS |
