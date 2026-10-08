## Summary

<!-- What does this PR change, and why? -->

## Related issue

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / tests

## How was it tested?

<!-- Commands you ran and what you observed. Include tx hashes for testnet changes. -->

## Checklist

- [ ] Contracts: `cd contracts && cargo fmt --all && cargo clippy --all-targets -- -D warnings && cargo test`
- [ ] Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`
- [ ] New contract functions have tests for both success and failure paths
- [ ] Behaviour changes are reflected in `README.md` / `CONTRIBUTING.md`
- [ ] No secrets committed; testnet only

## Wave complexity

- [ ] Trivial
- [ ] Medium
- [ ] High
