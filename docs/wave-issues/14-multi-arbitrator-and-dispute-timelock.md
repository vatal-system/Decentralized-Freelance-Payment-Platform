# Multi-arbitrator disputes and a timelock escape hatch

- **Complexity:** High
- **Area:** contracts (dispute + escrow)
- **Labels:** `wave`, `contracts`, `design`

> ⚠️ **Design + security sensitive.** This changes how frozen funds can move.
> Agree the design in the issue thread first; expect a careful review.

## Context

`dispute` has a single trusted arbitrator set once in `init`, and a `Disputed`
escrow can only leave that state through the arbitrator. If the arbitrator is
unavailable or malicious, the funds are stuck forever. Two related improvements:

1. Replace the single arbitrator with a small panel that resolves by majority.
2. Add a dispute timelock: if no ruling is made within N ledgers, the client can
   reclaim the still-unreleased funds.

## Acceptance criteria

- [ ] `dispute` stores a panel of arbitrator addresses; `arbitrate` requires M-of-N
      approvals (or an admin-set threshold) before calling `escrow.resolve`.
- [ ] `escrow.resolve` still validates the shares sum to the held amount and still
      only accepts the registered dispute contract.
- [ ] `escrow.reclaim_expired` (or a new `reclaim_after_dispute_timeout`) can refund
      the client from a `Disputed` escrow once a dispute deadline has passed.
- [ ] Tests cover: panel approval reaching threshold, insufficient approvals
      rejected, timeout reclaim from `Disputed`, and that a late ruling cannot
      double-spend.
- [ ] Design is documented in `docs/` and the contract reference in
      `CONTRIBUTING.md` is updated.

## Files to touch

- `contracts/dispute/src/lib.rs`, `contracts/dispute/src/test.rs`
- `contracts/escrow/src/lib.rs`, `contracts/escrow/src/test.rs`
- `contracts/dispute/tests/full_flow.rs`
- `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`

## How to test

```bash
cd contracts
cargo test
cargo clippy --all-targets -- -D warnings
```

## Notes

Do not weaken `resolve`'s authorization: it must remain callable only by the
escrow's registered dispute contract, and shares must still sum to the funds
held. Keep the timeout as a genuine escape hatch, not a way to front-run a
ruling.
