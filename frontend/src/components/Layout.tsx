/**
 * Layout.tsx
 *
 * Shared page wrapper. The wallet-aware navigation stays in `App.tsx`; this
 * component only provides the consistent content container used by every route.
 */

import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="page">{children}</main>;
}
