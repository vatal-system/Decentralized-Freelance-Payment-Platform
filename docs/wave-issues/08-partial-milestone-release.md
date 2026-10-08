# Support releasing part of a milestone

- **Complexity:** Medium
- **Area:** contracts (escrow)
- **Labels:** `wave`, `contracts`, `feature`

## Context

`release_milestone` pays the whole milestone at once. Real work is often paid in
instalments (e.g. 30% on draft, 70% on delivery). This requires tracking how much
of each milestone has been released.

## Acceptance criteria

- [ ] `Milestone` gains a `released_amount: i128` field (default 0) in the shared
      `interface` crate, and `released: bool` stays as the completion flag.
- [ ] New escrow function `release_partial(env, escrow_id, milestone_index, amount)`
      that:
  - requires the client's auth, is `Active`-only,
  - rejects `amount <= 0` (`ZeroAmount`) and `amount > remaining on that milestone`
    (`InvalidShares` or a new `AmountExceedsMilestone` error),
  - adds to `released_amount`, flips `released = true` when it reaches the
    milestone amount, and completes the escrow when every milestone is released.
- [ ] `release_milestone` continues to release the full remainder and stays
      backwards compatible.
- [ ] Tests: partial then remainder completes; over-release rejected; zero/negative
      rejected; releasing after a dispute rejected.
- [ ] Frontend `MilestoneView` and the release UI show released vs remaining.

## Files to touch

- `contracts/interface/src/lib.rs`
- `contracts/escrow/src/lib.rs`
- `contracts/escrow/src/test.rs`
- `frontend/src/hooks/useEscrow.ts`, `frontend/src/pages/JobDetail.tsx`

## How to test

```bash
cd contracts && cargo test -p escrow
cd ../frontend && npm run lint && npx tsc --noEmit
```

## Notes

This changes a shared storage type. Confirm the `escrow` integration test in
`contracts/dispute/tests/full_flow.rs` still passes.
