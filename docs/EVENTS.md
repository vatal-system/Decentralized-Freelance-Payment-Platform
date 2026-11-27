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

The backend indexer applies these events to the mirrored state *and* stores every
recognised one in the `ChainEvent` table — the escrow id, the event name, the
amount it moved (in base units), the ledger, and the transaction hash. That table
is what a per-user transaction history (`GET /api/users/:address/transactions`)
and an escrow receipt (`GET /api/escrow/:escrowId/receipt`) read from, since none
of the state tables keeps a transaction hash.

## Escrow — `contracts/escrow`

| Rust type | topic0 (`Symbol`) | topic1 (`#[topic]`) | data fields | Trigger / state transition |
|-----------|-------------------|---------------------|-------------|----------------------------|
| `Created` | `created` | `client: Address` | `escrow_id: u64`, `freelancer: Address`, `total_amount: i128` | `create` — initializes a new escrow in `Created` state. |
| `Funded` | `funded` | `client: Address` | `escrow_id: u64`, `amount: i128`, `freelancer: Address` | `fund` — client transfers `total_amount` into escrow; `Created` → `Active`. |
| `MilestonesUpdated` | `milestones_updated` | `escrow_id: u64` | `count: u32`, `total_amount: i128` | `update_milestones` — client edits milestones while escrow is still `Created` (unfunded). |
| `Cancelled` | `cancelled` | `escrow_id: u64` | `client: Address` | `cancel` — client closes an unfunded `Created` escrow; `Created` → `Cancelled`. |
| `MilestoneReleased` | `milestone_released` | `escrow_id: u64` | `index: u32`, `amount: i128` | `release_milestone` / `release_partial` — pays `amount` to freelancer while `Active`; when all milestones are paid out, `Active` → `Completed`. |
| `MilestoneReclaimed` | `milestone_reclaimed` | `escrow_id: u64` | `index: u32`, `amount: i128` | `reclaim_milestone` — client refunds one overdue milestone's unreleased remainder once its own `deadline` has passed; the escrow becomes `Refunded` when nothing is left outstanding, otherwise it stays `Active`. |
| `DisputeOpened` | `dispute_opened` | `escrow_id: u64` | `initiator: Address` | `open_dispute` — client or freelancer freezes an `Active` escrow; `Active` → `Disputed`. |
| `Resolved` | `resolved` | `escrow_id: u64` | `client_share: i128`, `freelancer_share: i128` | `resolve` (dispute contract only) — distributes funds between client and freelancer; `Disputed` → `Resolved`. |
| `Refunded` | `refunded` | `escrow_id: u64` | `client: Address`, `amount: i128` | `refund_expired` (`Active` past expiry) or `reclaim_disputed` (`Disputed` past timelock) — returns unreleased balance to client; `Active`/`Disputed` → `Refunded`. `reclaim_milestone` emits `milestone_reclaimed` instead, and does not emit this event even when it closes the escrow. |
| `DisputeContractProposed` | `dispute_contract_proposed` | `admin: Address` | `new_contract: Address`, `effective_at: u64` | `set_dispute_contract` — admin schedules a dispute-contract rotation with a timelock. |
| `DisputeContractCancelled` | `dispute_contract_cancelled` | `admin: Address` | `cancelled_contract: Address` | `cancel_dispute_contract` — admin cancels a pending dispute-contract proposal. |
| `DisputeContractUpdated` | `dispute_contract_updated` | `admin: Address` | `old_contract: Address`, `new_contract: Address` | `apply_dispute_contract` — admin applies a proposed dispute-contract rotation after `effective_at`. |
| `CodeUpdated` | `code_updated` | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` — admin upgrades the escrow contract WASM bytecode in place. |

> `MilestoneReleased` is emitted by **both** `release_milestone` and
> `release_partial`, and its `amount` is the sum paid by *that* call — not the
> milestone's total. A consumer must accumulate the amounts for a milestone (and
> compare them against the milestone's amount) to tell a partial release from a
> complete one; the indexer stores that running total in `Milestone.releasedAmount`.
>
> `MilestoneReclaimed` settles the milestone *in full*, even though `amount` is
> only the remainder refunded by that call — anything released earlier stays with
> the freelancer and is not clawed back. Do not accumulate it as a payment; the
> indexer sets `Milestone.releasedAmount` to the milestone's full amount.
>
> `escrow.resolve` emits only `resolved`, and it sets every milestone's on-chain
> `released_amount` to its full `amount`; the indexer writes the same full amount
> to each milestone when it handles that event.
>
> Dispute-contract rotation is a two-step, timelocked flow: `set_dispute_contract`
> emits `dispute_contract_proposed`; after `effective_at`, `apply_dispute_contract`
> emits `dispute_contract_updated` and only then does `resolve` authority change.

## Dispute — `contracts/dispute`

| Rust type | topic0 (`Symbol`) | topic1 (`#[topic]`) | data fields | Trigger / state transition |
|-----------|-------------------|---------------------|-------------|----------------------------|
| `Raised` | `raised` | `escrow_id: u64` | `dispute_id: u64`, `raised_by: Address` | `raise` — party raises a dispute against a `Disputed` escrow; creates dispute in `Open` state. |
| `Approved` | `approved` | `dispute_id: u64` | `arbitrator: Address` | `arbitrate` — panel arbitrator records an approval vote for a proposed split (`Open` remains `Open` until threshold is met). |
| `DisputeResolved` | `dispute_resolved` | `escrow_id: u64` | `dispute_id: u64`, `client_share: i128`, `freelancer_share: i128` | `arbitrate` — final threshold approval met and `escrow.resolve` succeeds; `Open` → `Resolved`. |
| `ThresholdUpdated` | `threshold_updated` | `admin: Address` | `old_threshold: u32`, `new_threshold: u32` | `set_threshold` — admin updates the panel approval threshold. |
| `ArbitratorAdded` | `arbitrator_added` | `admin: Address` | `arbitrator: Address`, `panel_size: u32` | `add_arbitrator` — admin adds an arbitrator seat to the panel. |
| `ArbitratorRemoved` | `arbitrator_removed` | `admin: Address` | `arbitrator: Address`, `panel_size: u32` | `remove_arbitrator` — admin removes an arbitrator seat and bumps `panel_version`. |
| `CodeUpdated` | `code_updated` | `admin: Address` | `new_wasm_hash: BytesN<32>` | `upgrade` — admin upgrades the dispute contract WASM bytecode in place. |

> `ThresholdUpdated` is emitted by `set_threshold` only, after the new value is
> validated and stored. `set_panel` also writes a threshold but emits no event of
> its own; it bumps `panel_version()` instead. `add_arbitrator` and
> `remove_arbitrator` change one seat at a time and emit the events above.
> `remove_arbitrator` bumps the panel version (like `set_panel`); `add_arbitrator`
> does not, so votes already cast stay valid when a seat is added.

## Reputation — `contracts/reputation`

| Rust type | topic0 (`Symbol`) | topic1 (`#[topic]`) | data fields | Trigger / state transition |
|-----------|-------------------|---------------------|-------------|----------------------------|
| `Rated` | `rated` | `escrow_id: u64` | `rater: Address`, `ratee: Address`, `score: u32`, `count: u64`, `total_score: u64` | `rate` — client or freelancer rates counterparty on a `Completed` escrow; records one-time `(escrow_id, rater)` rating and updates ratee's weighted aggregate. |

`count` and `total_score` are the ratee's **weighted** aggregate after this rating
(see [`REPUTATION.md`](./REPUTATION.md)); `total_score` is `sum(score * weight)`
and `count` the number of ratings that counted.

## Verifying this list against the source

```bash
grep -rn "contractevent" contracts/*/src/lib.rs
```

Each struct listed above should have exactly one corresponding `#[contractevent]`
declaration.
