# Add a Vitest test for the milestone ScVal encoding

- **Complexity:** Trivial
- **Area:** frontend (test coverage)
- **Labels:** `wave`, `tests`, `frontend`

## Context

`milestonesToScVal` in `frontend/src/lib/stellar.ts` hand-encodes the contract's
`Milestone` struct as a `ScVal`. If it drifts from the Rust struct, `create`
fails only at runtime on testnet. There are currently no frontend tests at all.

## Acceptance criteria

- [ ] `frontend/src/lib/stellar.test.ts` asserts that `milestonesToScVal([...])`
      round-trips through `scValToNative` to
      `[{ amount, released, deadline }, ...]` with the expected field names and
      false `released`.
- [ ] A second test covers the empty list.
- [ ] `npm test` runs the suite and passes.
- [ ] CI runs `npm test` in the frontend job.

## Files to touch

- `frontend/src/lib/stellar.test.ts` (new)
- `.github/workflows/ci.yml` (add a `npm test` step)

## How to test

```bash
cd frontend
npm test
```

## Notes

`vitest` is already a dev dependency and `npm test` is wired to
`vitest run --passWithNoTests`.
