# Show the transaction hash and an explorer link after each action

- **Complexity:** Trivial
- **Area:** frontend
- **Labels:** `wave`, `frontend`, `ux`

## Context

`useEscrow`'s `submit` already polls the transaction and knows its hash, but it
throws the hash away. Users get no confirmation of what happened on-chain and no
way to verify it, which is exactly what reviewers want to see.

## Acceptance criteria

- [ ] `submit` returns the transaction hash (keep the decoded return value too).
- [ ] After a successful release/dispute/create+fund, the page shows the hash and
      a link to `https://stellar.expert/explorer/<network>/tx/<hash>`, built from
      the configured network in `lib/stellar.ts`.
- [ ] The last transaction hash is visible on `JobDetail` and `PostJob` without a
      full page reload.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` pass.

## Files to touch

- `frontend/src/hooks/useEscrow.ts`
- `frontend/src/lib/stellar.ts` (explorer URL helper)
- `frontend/src/pages/JobDetail.tsx`
- `frontend/src/pages/PostJob.tsx`

## How to test

```bash
cd frontend
npm run lint && npx tsc --noEmit && npm run build
```

Then perform a release on testnet and confirm the link opens the correct
transaction.

## Notes

The explorer host differs per network; derive it from `ACTIVE_NETWORK` rather
than hardcoding `testnet`.
