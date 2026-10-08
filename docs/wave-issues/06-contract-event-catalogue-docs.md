# Document the contract event catalogue for indexers and clients

- **Complexity:** Trivial
- **Area:** docs
- **Labels:** `wave`, `docs`

## Context

The three contracts emit `#[contractevent]` events (`Created`, `Funded`,
`MilestoneReleased`, `DisputeOpened`, `Resolved`, `Refunded`, `Raised`,
`DisputeResolved`, `Rated`) but there is no written schema. The backend indexer
and any external indexer need to know each event's contract, topic, and data
fields.

## Acceptance criteria

- [ ] `docs/EVENTS.md` lists every event with: contract, Rust type name, the
      `#[topic]` field(s), the remaining data fields and their types, and the
      human-readable name the SDK assigns (e.g. `milestone_released`).
- [ ] It states which `Symbol`/topic a subscriber can filter on.
- [ ] The list matches the code — verify against the event structs in
      `contracts/{escrow,dispute,reputation}/src/lib.rs`.

## Files to touch

- `docs/EVENTS.md` (new)
- `README.md` or `CONTRIBUTING.md` (link to it)

## How to test

```bash
# Confirm the documented set matches the source
grep -rn "contractevent" contracts/*/src/lib.rs
```

## Notes

Keep it factual — no invented events. If a struct has multiple fields, document
field order as it appears in the Rust type.
