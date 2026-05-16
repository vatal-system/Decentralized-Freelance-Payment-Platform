/**
 * JobDetail.tsx
 *
 * Shows milestone progress for a single escrow job.
 * Client can release milestones or open a dispute.
 * Freelancer can see payment status.
 *
 * TODO:
 * - Fetch EscrowData via escrow.get(id) on mount.
 * - Render milestone list with release buttons (client only).
 * - Show dispute button when status == Active.
 * - Poll for status changes every 5 s (Stellar ~5 s finality).
 */

import { useParams } from "react-router-dom";
import { useEscrow } from "../hooks/useEscrow";

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { releaseMilestone, loading, error } = useEscrow();

  // TODO: fetch escrow data
  // TODO: render milestone cards

  return (
    <main>
      <h1>Job #{id}</h1>
      {/* TODO: EscrowStatusBadge */}
      {/* TODO: MilestoneList with release buttons */}
      {/* TODO: DisputeButton */}
      {error && <p role="alert" style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
