# Show friendly messages for contract errors in the frontend

- **Complexity:** Trivial
- **Area:** frontend
- **Labels:** `wave`, `frontend`, `error-handling`

## Context

When a contract call fails, the UI shows the raw SDK string, e.g.
`HostError: Error(Contract, #7)` (which is `EscrowError::NotExpired`) or an
opaque `Transaction rejected`. The error codes are defined in
`contracts/interface/src/lib.rs` (`EscrowError`), `contracts/dispute/src/lib.rs`
(`DisputeError`) and `contracts/reputation/src/lib.rs` (`ReputationError`).

## Acceptance criteria

- [ ] A helper (e.g. `frontend/src/lib/errors.ts`) turns an error into a friendly
      message, mapping at least: `#7 NotExpired`, `#2 InvalidStatus`,
      `#4 MilestoneAlreadyReleased`, `#5 MilestoneIndexOutOfBounds`,
      `#13 InvalidShares` (escrow), and the reputation equivalents used by `submit`.
- [ ] Unrecognized errors fall back to the original message (never throw).
- [ ] `useEscrow` passes errors through this helper before storing them.
- [ ] A unit test covers a known code, an unknown code, and a non-contract error.

## Files to touch

- `frontend/src/lib/errors.ts` (new)
- `frontend/src/lib/errors.test.ts` (new)
- `frontend/src/hooks/useEscrow.ts`

## How to test

```bash
cd frontend
npm run lint && npx tsc --noEmit && npm test
```

## Notes

The error code appears in the simulation error text as `Error(Contract, #N)`;
parse it defensively and never rely on the message beyond that pattern.
