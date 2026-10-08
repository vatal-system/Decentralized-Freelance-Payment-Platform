# Add reputation weighting and anti-spam

- **Complexity:** High
- **Area:** contracts (reputation)
- **Labels:** `wave`, `contracts`, `design`

> ⚠️ **Design sensitive.** Agree the weighting rule before coding; it is easy to
> introduce an incentive to farm cheap jobs.

## Context

`reputation.submit` accepts any rating once the job is `Completed` and the rater
is a participant. A user can farm reputation with many tiny escrows between
colluding accounts, and every rating counts equally regardless of job size or
recency. We want a defensible, simple rule — not a full sybil-proof design.

## Acceptance criteria

- [ ] A documented, deterministic weighting rule (e.g. weight each rating by the
      escrow's total amount, or decay older ratings) implemented in `get_aggregate`
      without changing the stored raw ratings.
- [ ] An anti-spam guard, e.g. at most one rating per (rater, ratee) pair counts
      toward the aggregate, or a minimum escrow amount below which a rating is
      recorded but not weighted.
- [ ] `get_aggregate` returns the weighted average (or `total_score`/`count`
      become weighted), and the return shape stays usable by the frontend.
- [ ] Tests cover: equal-size jobs, very different sizes, recency decay (if chosen),
      and the anti-spam guard rejecting/neutralising a repeat pair.
- [ ] The frontend `Profile` still renders the aggregate correctly.

## Files to touch

- `contracts/reputation/src/lib.rs`, `contracts/reputation/src/test.rs`
- `contracts/interface/src/lib.rs` (if `Aggregate` changes)
- `frontend/src/hooks/useEscrow.ts`, `frontend/src/pages/Profile.tsx`
- `docs/`

## How to test

```bash
cd contracts && cargo test -p reputation
cd ../frontend && npx tsc --noEmit
```

## Notes

Keep it simple and explainable. Avoid floating point on-chain — use integer
scaling and document the rounding. Explicitly state the residual sybil risk in
the issue/PR; this is a mitigation, not a guarantee.
