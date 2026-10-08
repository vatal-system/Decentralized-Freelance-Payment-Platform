# Fix the milestone ScVal encoding in `POST /api/escrow/build/create`

- **Complexity:** Medium
- **Area:** backend
- **Labels:** `wave`, `backend`, `bug`

## Context

`backend/src/routes/escrow.ts` builds the `create` call like this:

```ts
const milestoneScVals = job.milestones.map((m) => nativeToScVal({ amount: ..., released: false, deadline: ... }));
// ...
contract.call("create", ..., nativeToScVal(milestoneScVals), nativeToScVal(BigInt(expiryTimestamp)))
```

`milestoneScVals` are already `ScVal`s, so `nativeToScVal(...)` double-encodes
them, and `nativeToScVal` on a plain object does not reliably produce the
contract's `Milestone` struct. `deadline`/`expiry` are also untyped, so the
default integer type may not be `u64`.

## Acceptance criteria

- [ ] A pure, exported helper builds the arguments explicitly as ScVal maps/vecs
      with the correct types — `amount: i128`, `released: bool`, `deadline: u64`,
      `expiry: u64` — matching `contracts/interface/src/lib.rs`.
- [ ] `create` is called with that helper, with no double `nativeToScVal`.
- [ ] A vitest test round-trips the helper through `scValToNative` and asserts the
      decoded structure.
- [ ] `npx tsc --noEmit` and `npm test` pass.

## Files to touch

- `backend/src/lib/escrowArgs.ts` (new)
- `backend/src/routes/escrow.ts`
- `backend/src/__tests__/escrowArgs.test.ts` (new)

## How to test

```bash
cd backend
npx tsc --noEmit && npm test
```

## Notes

The frontend already solves this correctly in `milestonesToScVal`
(`frontend/src/lib/stellar.ts`) — mirror that shape.
