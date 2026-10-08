# Support payment assets beyond USDC

- **Complexity:** High
- **Area:** frontend + backend (+ docs)
- **Labels:** `wave`, `frontend`, `backend`, `feature`

## Context

The escrow contract is already asset-agnostic — `create` takes the token address
per escrow, and `deployments/testnet.json` must be configured with a USDC SAC.
What is missing is everything around it: the frontend hardcodes
`VITE_USDC_CONTRACT_ID` and assumes 7 decimals, the backend `build/create` route
hardcodes `config.USDC_CONTRACT_ID`, and nothing tells the user which asset a job
pays in.

## Acceptance criteria

- [ ] A small, documented asset registry (config or `lib/assets.ts`) maps a symbol
      to its SAC contract id and decimals, seeded with USDC and XLM on testnet.
- [ ] `PostJob` lets the client choose the asset, and amounts are converted using
      that asset's decimals.
- [ ] `JobDetail` and the job list display the asset symbol; the create flow shows
      which token will be transferred.
- [ ] `POST /api/escrow/build/create` uses the job's configured asset instead of a
      hardcoded USDC id; the value is validated against the registry.
- [ ] Tests cover decimals conversion for at least two assets (e.g. 7 vs 7) and
      rejection of an unknown asset.
- [ ] `docs/` explains how to add a new asset.

## Files to touch

- `frontend/src/lib/assets.ts` (new), `frontend/src/pages/PostJob.tsx`,
  `frontend/src/pages/JobDetail.tsx`, `frontend/.env.example`
- `backend/src/routes/escrow.ts`, `backend/src/config.ts`, `backend/prisma/schema.prisma`
- `docs/`

## How to test

```bash
cd contracts && cargo test          # escrow is already token-agnostic
cd ../frontend && npm run lint && npx tsc --noEmit && npm test
cd ../backend && npx tsc --noEmit && npm test
```

## Notes

Do not introduce company-specific assets. Keep the registry data-driven so a new
SAC is a one-line addition. Remember the demo uses the testnet XLM SAC.
