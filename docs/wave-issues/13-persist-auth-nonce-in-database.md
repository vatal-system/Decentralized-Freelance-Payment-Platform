# Persist auth nonces in the database instead of memory

- **Complexity:** Medium
- **Area:** backend
- **Labels:** `wave`, `backend`, `auth`

> ⚠️ **Touches authentication.** Get a careful review before merging. The change
> must not weaken replay protection — it should strictly improve it.

## Context

`backend/src/routes/users.ts` keeps challenge nonces in an in-memory `Map`. A
restart, a second instance, or a crash between challenge and verification loses
the nonce, and the map grows unbounded under load. The file itself carries a
TODO for this.

## Acceptance criteria

- [ ] A Prisma model `AuthNonce { address (unique), nonce, expiresAt }` with a
      committed migration.
- [ ] `/api/users/challenge` upserts a nonce with a 60s expiry; `/api/users/auth`
      verifies against the stored row and **deletes it** on success (single use).
- [ ] Expired nonces are rejected and opportunistically pruned.
- [ ] Tests cover: valid flow, replay of a used nonce is rejected, expired nonce is
      rejected, nonce for a different address is rejected.
- [ ] `npx tsc --noEmit` and `npm test` pass.

## Files to touch

- `backend/prisma/schema.prisma` (+ new migration)
- `backend/src/routes/users.ts`
- `backend/src/__tests__/auth.test.ts` (new)

## How to test

```bash
cd backend
npx prisma generate && npx tsc --noEmit && npm test
```

## Notes

The expiry check must use the database clock or a stored timestamp, not an
in-memory `Date.now()` value from challenge creation only. Keep the nonce single
use.
