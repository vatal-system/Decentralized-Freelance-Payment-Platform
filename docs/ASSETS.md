# Payment assets

The escrow contract is asset-agnostic: `create` takes a token address per escrow
and moves that Stellar Asset Contract (SAC). The symbol → SAC mapping lives in
two small registries, one per app:

- `frontend/src/lib/assets.ts` — symbol, contract id (from `VITE_*`), decimals.
- `backend/src/lib/assets.ts` — symbol, decimals, and the config key holding the
  contract id.

Both are seeded with **USDC** and **XLM** on testnet. USDC and XLM both use 7
decimals; amounts are always converted with the asset's `decimals` (never a
hardcoded `1e7`).

## Adding an asset

1. **Frontend** — append an entry to `ASSETS` in `frontend/src/lib/assets.ts`:

   ```ts
   { symbol: "AQUA", contractId: import.meta.env.VITE_AQUA_CONTRACT_ID ?? "", decimals: 7 }
   ```

   and add `VITE_AQUA_CONTRACT_ID=` to `frontend/.env.example` and `.env`.

2. **Backend** — append an entry to `ASSETS` in `backend/src/lib/assets.ts`:

   ```ts
   AQUA: { symbol: "AQUA", decimals: 7, configKey: "AQUA_CONTRACT_ID" }
   ```

   add the key to the config schema in `backend/src/config.ts` (default `""`) and
   to `backend/.env.example`, then set it in the environment.

3. **Jobs** — `POST /api/jobs` accepts an `asset` symbol (defaults to `USDC`).
   `GET /api/jobs` returns it, and the Dashboard shows the symbol. The
   `/api/escrow/build/create` route pays in the job's asset and rejects any
   symbol not in the registry.

## Notes

- Use only well-known SACs; do not add project- or company-specific assets.
- A job's asset is fixed when the job is created; the on-chain escrow token is
  chosen when the transaction is built.
- The testnet demo (`scripts/demo_testnet.sh`) falls back to the native XLM SAC
  when no USDC contract id is configured.
