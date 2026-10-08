# Implement the backend contract-event indexer

- **Complexity:** High
- **Area:** backend
- **Labels:** `wave`, `backend`, `indexer`

## Context

`backend/src/indexer.ts` is a stub: `processContractEvents()` does nothing, so the
database never syncs from chain. The event handlers (`handleFunded`,
`handleMilestoneReleased`, `handleDisputeOpened`, `handleResolved`,
`handleRefunded`) and the `IndexerCursor` model already exist. The contracts now
emit `#[contractevent]` events (see `docs/EVENTS.md`).

## Acceptance criteria

- [ ] `processContractEvents` calls `SorobanRpc.Server.getEvents` with
      `startLedger` from `IndexerCursor` and a filter per contract id.
- [ ] Each event is decoded by topic (`created`, `funded`, `milestone_released`,
      `dispute_opened`, `resolved`, `refunded`, `raised`, `rated`) and dispatched
      to the matching handler; unknown events are ignored, not fatal.
- [ ] The cursor advances only after events are processed, and a failed event does
      not block the rest (log and continue).
- [ ] On start, the indexer resumes from the persisted cursor and does not
      reprocess already-applied ledgers.
- [ ] Unit tests decode a captured event for at least `milestone_released` and
      `rated`; a test asserts the cursor advances correctly.
- [ ] `npx tsc --noEmit` and `npm test` pass.

## Files to touch

- `backend/src/indexer.ts`
- `backend/src/lib/events.ts` (new, decoding helpers)
- `backend/src/__tests__/indexer.test.ts` (new)
- `backend/src/config.ts` (if an RPC URL rename is needed)

## How to test

```bash
cd backend
npx tsc --noEmit && npm test
# then run against testnet with contract ids set and watch logs
```

## Notes

Use `SOROBAN_RPC_URL` (already configured) rather than Horizon. The sibling
issue on event payloads (issue 12) makes single-event DB updates possible.
