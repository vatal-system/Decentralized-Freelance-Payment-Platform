# Add authorization tests for the remaining `require_auth` entry points

- **Complexity:** Trivial
- **Area:** contracts (tests only)
- **Labels:** `wave`, `tests`

## Context

Only `escrow.create` has a `#[should_panic]` test proving it requires the
caller's authorization. Every other `require_auth` site is untested, so a
regression that drops an auth check would pass CI.

Untested site (all should panic without `mock_all_auths`):

- `escrow`: `init`, `fund`, `release_milestone`, `open_dispute`, `reclaim_expired`
- `dispute`: `arbitrate`
- `reputation`: `init`, `submit`

## Acceptance criteria

- [ ] Each entry point above has a `#[should_panic]` test that calls it **without**
      `env.mock_all_auths()` and asserts it panics.
- [ ] Tests are named `*_requires_auth` and live in the existing `test.rs` modules.
- [ ] `cargo test` passes; `cargo clippy --all-targets -- -D warnings` is clean.

## Files to touch

- `contracts/escrow/src/test.rs`
- `contracts/dispute/src/test.rs`
- `contracts/reputation/src/test.rs`

## How to test

```bash
cd contracts
cargo test
cargo clippy --all-targets -- -D warnings
```

## Notes

Follow the pattern already used by `create_requires_client_auth` in
`contracts/escrow/src/test.rs`. Keep each test minimal: deploy the contract,
call the function with generated addresses, expect a panic.
