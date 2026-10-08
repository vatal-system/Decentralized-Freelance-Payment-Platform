# Wave issue backlog

Contributor-sized, scoped tasks ready to paste into GitHub Issues. Each has a
title, context, acceptance criteria, files to touch, how to test, and a suggested
complexity (Trivial / Medium / High).

Conventions:

- One contributor, one week or less per issue.
- A concrete, verifiable outcome — no vague "improve X" tasks.
- Nothing that needs a dedicated security audit to merge safely without being
  flagged.

See [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for how complexity maps to
scope.

## Index

| # | Issue | Complexity | Area |
|---|-------|-----------|------|
| 01 | [Add authorization tests for the remaining `require_auth` entry points](./01-remaining-auth-tests.md) | Trivial | contracts |
| 02 | [Show friendly messages for contract errors in the frontend](./02-friendly-contract-error-messages.md) | Trivial | frontend |
| 03 | [Give the app a shared layout and consistent status badges](./03-shared-layout-and-status-badges.md) | Trivial | frontend |
| 04 | [Show the transaction hash and an explorer link after each action](./04-show-transaction-hash-and-explorer-link.md) | Trivial | frontend |
| 05 | [Add a Vitest test for the milestone ScVal encoding](./05-vitest-milestone-scval-test.md) | Trivial | frontend |
| 06 | [Document the contract event catalogue for indexers and clients](./06-contract-event-catalogue-docs.md) | Trivial | docs |
| 07 | [Allow editing milestones before an escrow is funded](./07-milestone-editing-before-funding.md) | Medium | contracts |
| 08 | [Support releasing part of a milestone](./08-partial-milestone-release.md) | Medium | contracts |
| 09 | [Show a filterable job list on the Dashboard](./09-job-listing-and-filtering.md) | Medium | frontend |
| 10 | [Fix the milestone ScVal encoding in `POST /api/escrow/build/create`](./10-fix-backend-create-milestone-encoding.md) | Medium | backend |
| 11 | [Make frontend transaction state handling robust](./11-frontend-transaction-state-handling.md) | Medium | frontend |
| 12 | [Emit events that an indexer can rebuild job state from](./12-event-emission-for-indexer.md) | Medium | contracts |
| 13 | [Persist auth nonces in the database instead of memory](./13-persist-auth-nonce-in-database.md) | Medium | backend ⚠️ |
| 14 | [Multi-arbitrator disputes and a timelock escape hatch](./14-multi-arbitrator-and-dispute-timelock.md) | High | contracts ⚠️ |
| 15 | [Support payment assets beyond USDC](./15-support-assets-beyond-usdc.md) | High | frontend + backend |
| 16 | [Implement the backend contract-event indexer](./16-implement-contract-event-indexer.md) | High | backend |
| 17 | [Add reputation weighting and anti-spam](./17-reputation-weighting-and-anti-spam.md) | High | contracts ⚠️ |

⚠️ = requires a careful security/design review before merge.
