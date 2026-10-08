# Contract event catalogue

Every event emitted by the three Soroban contracts, for indexers and clients.
This matches the `#[contractevent]` structs in
`contracts/{escrow,dispute,reputation}/src/lib.rs`.

## How events are shaped

Each event is a struct annotated with `#[contractevent]`, which produces:

- **topic0** — the event name as a `Symbol`, the struct name in `snake_case`
  (e.g. `MilestoneReleased` → `milestone_released`). A subscriber filters on
  this symbol.
- **topic1** — the field annotated `#[topic]`, serialized with its declared type
  (`Address` or `u64`). Each event has exactly one such field.
- **data** — a `ScMap` of the remaining fields, keyed by field-name symbols.

So an RPC `getEvents` filter can match `contractId` + `topics: [[<event symbol>]]`
and, if desired, a second topic for the id/address in the `#[topic]` field.

## Escrow — `contracts/escrow`

| Rust type | topic0 (`Symbol`) | topic1 (`#[topic]`) | data fields |
|-----------|-------------------|---------------------|-------------|
| `Created` | `created` | `client: Address` | `escrow_id: u64` |
| `Funded` | `funded` | `client: Address` | `escrow_id: u64`, `amount: i128` |
| `MilestoneReleased` | `milestone_released` | `escrow_id: u64` | `index: u32`, `amount: i128` |
| `DisputeOpened` | `dispute_opened` | `escrow_id: u64` | `initiator: Address` |
| `Resolved` | `resolved` | `escrow_id: u64` | `client_share: i128`, `freelancer_share: i128` |
| `Refunded` | `refunded` | `escrow_id: u64` | `client: Address`, `amount: i128` |

## Dispute — `contracts/dispute`

| Rust type | topic0 (`Symbol`) | topic1 (`#[topic]`) | data fields |
|-----------|-------------------|---------------------|-------------|
| `Raised` | `raised` | `escrow_id: u64` | `dispute_id: u64`, `raised_by: Address` |
| `DisputeResolved` | `dispute_resolved` | `escrow_id: u64` | `dispute_id: u64`, `client_share: i128`, `freelancer_share: i128` |

## Reputation — `contracts/reputation`

| Rust type | topic0 (`Symbol`) | topic1 (`#[topic]`) | data fields |
|-----------|-------------------|---------------------|-------------|
| `Rated` | `rated` | `escrow_id: u64` | `rater: Address`, `ratee: Address`, `score: u32` |

## Verifying this list against the source

```bash
grep -rn "contractevent" contracts/*/src/lib.rs
```

Each struct listed above should have exactly one corresponding `#[contractevent]`
declaration.
