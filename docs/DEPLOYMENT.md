# Deployment

How to put the three pieces of this project on the internet:

| Piece | Where | Why |
|-------|-------|-----|
| Contracts | Stellar **testnet** | Unaudited; the only network this project is meant for |
| Frontend | Vercel (or any static host) | Static Vite build, no server needed |
| Backend | A container host (Railway / Render / Fly / a VPS) | Long-running event indexer + PostgreSQL |

The backend **cannot** run as a Vercel serverless function: `startIndexer()`
(`backend/src/server.ts`) keeps a polling loop alive for the life of the
process, and Prisma needs a persistent PostgreSQL connection. Vercel functions
are short-lived and recycled, so the indexer would silently stop syncing.

Everything below assumes testnet. There is no mainnet path — see
[`../README.md`](../README.md) and [`SECURITY.md`](../SECURITY.md).

## What is deployed today

| Piece | Where | Status |
|-------|-------|--------|
| Contracts | Stellar testnet | ✅ Live — ids in [`../deployments/testnet.json`](../deployments/testnet.json) |
| Frontend | Vercel project `stellar-freelance-frontend` | ✅ <https://stellar-freelance-frontend.vercel.app> — all `VITE_*` contract vars set for Production and Preview |
| Backend API | — | ❌ Not deployed yet: `VITE_API_URL` is unset, so the job list falls back to `http://localhost:3000` and will fail in the browser until the API exists |

Deployment protection (Vercel Authentication) is **off** for the frontend project so the
demo is reachable without a Vercel login. Note that the Vercel project is not connected
to GitHub — deployments are pushed with the CLI, so a `git push` does not redeploy it:

```bash
cd frontend && vercel deploy --prod
```

---

## 1. Contracts → testnet

```bash
rustup target add wasm32v1-none
stellar keys generate deployer --network testnet --fund

XLM_CONTRACT_ID=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  scripts/deploy_testnet.sh
```

This builds the Wasm, deploys escrow/dispute/reputation, initializes them
(`escrow.init(admin, dispute)`, `dispute.init(arbitrators=[admin], threshold=1)`,
`reputation.init(admin, escrow)`), and writes:

- `deployments/testnet.json` — the machine-readable record
- `frontend/.env` — the same ids as `VITE_*` vars (the previous file is backed up
  to `frontend/.env.bak`; set `KEEP_FRONTEND_ENV=1` to opt out)

Verify with an end-to-end run before touching the frontend:

```bash
scripts/demo_testnet.sh
```

It should print `status: "Completed"`, milestones with matching
`released_amount`, a `Rated` event carrying `count`/`total_score`, and a
weighted `get_aggregate` result.

**Contract ids change on every deploy.** Whatever is in `deployments/testnet.json`
is the only correct set; the ids in `README.md` and `docs/TESTNET.md` are a
snapshot for readers and must be updated when you redeploy.

## 2. Frontend → Vercel

Point a Vercel project at this repository with **Root Directory = `frontend`**.
`frontend/vercel.json` sets the Vite preset, the `dist` output, and the rewrite
that lets React Router handle deep links (`/jobs/123` would otherwise 404).

Set these environment variables in the project (Production *and* Preview). Vite
inlines them at build time, so **changing any of them requires a redeploy**:

| Variable | Value |
|----------|-------|
| `VITE_NETWORK` | `testnet` |
| `VITE_ESCROW_CONTRACT_ID` | from `deployments/testnet.json` |
| `VITE_DISPUTE_CONTRACT_ID` | from `deployments/testnet.json` |
| `VITE_REPUTATION_CONTRACT_ID` | from `deployments/testnet.json` |
| `VITE_XLM_CONTRACT_ID` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| `VITE_USDC_CONTRACT_ID` | empty until a USDC SAC is configured |
| `VITE_API_URL` | the backend origin from step 3, e.g. `https://api.example.com` |

Without `VITE_API_URL` the app falls back to `http://localhost:3000`
(`frontend/src/lib/api.ts`) and the job list will fail for every visitor.

## 3. Backend → container host

Once the API has an origin, set `VITE_API_URL` on the Vercel project to it and
redeploy the frontend (the value is inlined at build time), then set the
backend's `CORS_ORIGIN` to `https://stellar-freelance-frontend.vercel.app`.

Build is `backend/Dockerfile`; it runs `npx prisma migrate deploy && node dist/server.js`,
so migrations apply on boot. Attach a PostgreSQL instance and set:

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | connection string for the managed Postgres |
| `JWT_SECRET` | **at least 32 characters** — the config schema exits the process otherwise |
| `NODE_ENV` | `production` |
| `STELLAR_NETWORK` | `testnet` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` |
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `ESCROW_CONTRACT_ID` / `DISPUTE_CONTRACT_ID` / `REPUTATION_CONTRACT_ID` | from `deployments/testnet.json` — without them the indexer logs "No contract IDs configured" and does nothing |
| `XLM_CONTRACT_ID` | the testnet XLM SAC |
| `ARBITRATOR_ADDRESSES` | comma-separated panel addresses allowed to call `POST /api/disputes/:id/resolve`. Empty **disables** the route (it fails closed) |
| `CORS_ORIGIN` | the Vercel origin, e.g. `https://your-app.vercel.app`. Empty allows every origin — production logs a warning |
| `INDEXER_POLL_INTERVAL_MS` | `5000` is fine; raise it to reduce RPC traffic |

Any managed Postgres works. [Tiger Cloud](https://www.tigerdata.com/cloud) has a
free tier (two services, 750 MB each) and speaks plain PostgreSQL, so Prisma
needs no changes.

### Health and sanity checks after deploying

```bash
curl -fsS "$API_URL/health"                      # {"status":"ok"}
curl -fsS "$API_URL/api/jobs?limit=1"            # 200 once migrations ran
```

Then indexer progress — the cursor should be advancing past 0:

```sql
SELECT "lastLedger", "updatedAt" FROM "IndexerCursor";
```

Events the indexer could not apply are recorded rather than dropped. Check this
table after a redeploy that changed event payloads:

```sql
SELECT * FROM "IndexerDeadLetter" ORDER BY "lastSeenAt" DESC LIMIT 20;
```

Each row is state that is missing from the database; fix the handler, replay the
event, then delete the row.

## 4. Order of operations

1. Deploy contracts (step 1) and run the demo.
2. Deploy the backend (step 3) with the new contract ids in its env.
3. Deploy the frontend (step 2) with `VITE_API_URL` pointing at the backend.
4. Add `CORS_ORIGIN` = the frontend origin to the backend and restart it.
5. Smoke-test in the browser with Freighter set to **Testnet**: connect, post a
   job, fund it, release a milestone.

Contract ids and `VITE_*` values are baked in at build time, so if you redeploy
the contracts you must restart the backend and rebuild the frontend.
