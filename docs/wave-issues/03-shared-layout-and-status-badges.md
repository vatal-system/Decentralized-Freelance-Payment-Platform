# Give the app a shared layout and consistent status badges

- **Complexity:** Trivial
- **Area:** frontend (UI polish)
- **Labels:** `wave`, `frontend`, `ui`

## Context

Every page currently inlines its own styles and renders bare `<h1>`/`<p>`. There
is no shared stylesheet, so the app looks unstyled and status is plain text
(`Active`, `Disputed`, …).

## Acceptance criteria

- [ ] A single stylesheet (`frontend/src/styles.css`) is imported once in
      `main.tsx`; pages reuse classes instead of inline styles.
- [ ] A shared `<Layout>` component wraps the page content (the nav stays in
      `App.tsx`).
- [ ] A `<StatusBadge status={...} />` component renders the escrow status with a
      distinct colour per status (`Created`, `Active`, `Completed`, `Disputed`,
      `Refunded`).
- [ ] `npm run lint`, `npx tsc --noEmit`, and `npm run build` all pass.

## Files to touch

- `frontend/src/styles.css` (new)
- `frontend/src/main.tsx`
- `frontend/src/components/Layout.tsx` (new)
- `frontend/src/components/StatusBadge.tsx` (new)
- `frontend/src/pages/*.tsx`, `frontend/src/App.tsx`

## How to test

```bash
cd frontend
npm run lint && npx tsc --noEmit && npm run build
npm run dev   # check each route at http://localhost:5173
```

## Notes

Keep it dependency-free CSS — no component library. This is polish, not a
redesign; do not change page behaviour.
