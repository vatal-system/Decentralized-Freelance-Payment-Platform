# Show a filterable job list on the Dashboard

- **Complexity:** Medium
- **Area:** frontend (+ uses the existing backend API)
- **Labels:** `wave`, `frontend`, `feature`

## Context

The Dashboard only lets you open a job by id. The backend already exposes
`GET /api/jobs` with `status`, `client`, `freelancer`, `page`, and `limit`
filters, but nothing consumes it.

## Acceptance criteria

- [ ] A small API client (`frontend/src/lib/api.ts`) calls `GET /api/jobs` against
      a configurable base URL (`VITE_API_URL`, default `http://localhost:3000`).
- [ ] Dashboard lists jobs with title, status, client, and total, and offers a
      status filter plus "load more" pagination.
- [ ] Loading, empty, and error states are rendered explicitly.
- [ ] Each row links to `/jobs/:escrowId` when the job has an on-chain escrow.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` pass; a unit test covers
      the query-string builder.

## Files to touch

- `frontend/src/lib/api.ts` (new)
- `frontend/src/lib/api.test.ts` (new)
- `frontend/src/pages/Dashboard.tsx`
- `frontend/.env.example` (`VITE_API_URL`)

## How to test

```bash
docker compose up --build                      # backend + db
cd frontend && npm run dev
# create a couple of jobs, then confirm listing + filtering works
```

## Notes

The backend indexer is still a stub, so jobs only appear once created through the
API. That is expected for this issue.
