/**
 * StatusBadge.tsx
 *
 * Renders an escrow status with a distinct colour per state. Unknown statuses
 * fall back to a neutral badge rather than throwing.
 */

const STATUS_CLASS: Record<string, string> = {
  Created: "badge badge-created",
  Active: "badge badge-active",
  Completed: "badge badge-completed",
  Disputed: "badge badge-disputed",
  Refunded: "badge badge-refunded",
};

export default function StatusBadge({ status }: { status: string }) {
  const className = STATUS_CLASS[status] ?? "badge badge-unknown";
  return <span className={className}>{status}</span>;
}
