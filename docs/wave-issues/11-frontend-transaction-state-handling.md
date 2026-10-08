# Make frontend transaction state handling robust

- **Complexity:** Medium
- **Area:** frontend
- **Labels:** `wave`, `frontend`, `ux`

## Context

`useEscrow` has a single `loading` flag shared by every operation, and buttons
are only sometimes disabled. A user can double-click "Release" and submit twice,
and the 5s polling in `JobDetail` can race with an in-flight write. `error` is
never cleared by a subsequent successful read.

## Acceptance criteria

- [ ] `useEscrow` tracks the in-flight operation (e.g. `{ kind, key }`) instead of
      one boolean, so unrelated buttons are not disabled.
- [ ] An action cannot be started twice for the same target (double-submit guard).
- [ ] A successful action clears the previous error and triggers a refresh of the
      latest escrow state.
- [ ] While a write is pending, the poll in `JobDetail` does not overwrite the
      just-submitted state with a stale read.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` pass.

## Files to touch

- `frontend/src/hooks/useEscrow.ts`
- `frontend/src/pages/JobDetail.tsx`
- `frontend/src/pages/PostJob.tsx`

## How to test

```bash
cd frontend
npm run lint && npx tsc --noEmit && npm run build
```

Manual: open a funded job, double-click Release, confirm only one transaction is
submitted.

## Notes

Do not add a state-management library; React state plus `useCallback` is enough.
