# Allow editing milestones before an escrow is funded

- **Complexity:** Medium
- **Area:** contracts (escrow)
- **Labels:** `wave`, `contracts`, `feature`

## Context

Today `create` fixes the milestones forever. A client who mistypes an amount has
to create a second escrow and leave the first one unfunded. Before any money
moves (`status == Created`) it is safe for the client to correct the breakdown.

## Acceptance criteria

- [ ] New escrow function `update_milestones(env, escrow_id, milestones)` that:
  - requires the **client's** auth,
  - is only allowed while `status == Created`,
  - re-runs the same validation as `create` (non-empty, every amount > 0,
    non-empty total, `freelancer != client` unchanged),
  - recomputes and stores `total_amount`,
  - extends storage TTL and emits an event.
- [ ] Tests: success updates the milestones and total; rejected after `fund`;
      rejected for a non-client; rejected for empty/zero/negative milestones.
- [ ] `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` pass.

## Files to touch

- `contracts/escrow/src/lib.rs`
- `contracts/escrow/src/test.rs`
- `contracts/interface/src/lib.rs` (only if a new error variant is needed)
- `docs/wave-issues/06-contract-event-catalogue-docs.md` output, if a new event
  is added

## How to test

```bash
cd contracts
cargo test -p escrow
cargo clippy --all-targets -- -D warnings
```

## Notes

Do not allow editing once the escrow is `Active` — funds are already committed.
Return `EscrowError::InvalidStatus` in that case.
