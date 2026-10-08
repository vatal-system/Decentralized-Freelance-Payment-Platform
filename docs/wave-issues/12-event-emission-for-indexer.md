# Emit events that an indexer can rebuild job state from

- **Complexity:** Medium
- **Area:** contracts (events)
- **Labels:** `wave`, `contracts`, `events`

## Context

The backend indexer (see the related High issue) will follow contract events to
sync the database. It needs enough data on each event to update state without a
follow-up `get` call per event. Right now `Created` carries only the client, and
`Funded`/`MilestoneReleased` do not carry the freelancer, so the indexer must
read the escrow anyway.

## Acceptance criteria

- [ ] `Created` includes `freelancer` and `total_amount`.
- [ ] `Funded` includes the `freelancer`.
- [ ] `Rated` (reputation) includes the `ratee`'s resulting aggregate count and
      total score, so the indexer can update reputation without extra reads.
- [ ] Tests assert the emitted payloads using the test environment's event log.
- [ ] `cargo test`, `cargo clippy --all-targets -- -D warnings` pass, and
      `docs/EVENTS.md` (issue 06) is updated to match.

## Files to touch

- `contracts/escrow/src/lib.rs`, `contracts/escrow/src/test.rs`
- `contracts/reputation/src/lib.rs`, `contracts/reputation/src/test.rs`
- `docs/EVENTS.md`

## How to test

```bash
cd contracts && cargo test
```

## Notes

Keep one `#[topic]` per event so client-side filtering stays simple. Do not
remove existing fields — the backend and docs already rely on them.
