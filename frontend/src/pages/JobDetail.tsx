/**
 * JobDetail.tsx
 *
 * Shows milestone progress for a single escrow job.
 * The client can release milestones or open a dispute; the freelancer can see
 * payment status. State is refreshed by polling every 5s (Stellar finality).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useEscrow, type EscrowView } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";
import { fromStroops } from "../lib/stellar";

const POLL_MS = 5_000;

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { getEscrow, releaseMilestone, openDispute, loading, error } = useEscrow();
  const { publicKey, connect } = useWallet();
  const [escrow, setEscrow] = useState<EscrowView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const escrowId = id ? BigInt(id) : null;

  const refresh = useCallback(async () => {
    if (escrowId === null) return;
    const data = await getEscrow(escrowId);
    if (data) setEscrow(data);
    else setLoadError("Could not load escrow (is the id correct?)");
  }, [escrowId, getEscrow]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (escrowId === null) return <main style={{ padding: "1rem" }}><p>Invalid job id.</p></main>;

  const isClient = publicKey !== null && escrow?.client === publicKey;
  const isFreelancer = publicKey !== null && escrow?.freelancer === publicKey;
  const isParticipant = isClient || isFreelancer;
  const isActive = escrow?.status === "Active";

  return (
    <main style={{ padding: "1rem", maxWidth: 720 }}>
      <h1>Job #{id}</h1>

      {!publicKey && (
        <p>
          <button onClick={() => void connect()}>Connect Freighter</button> to act on this
          job.
        </p>
      )}

      {(error || loadError) && (
        <p role="alert" style={{ color: "crimson" }}>{error ?? loadError}</p>
      )}

      {escrow && (
        <>
          <p>
            Status:{" "}
            <strong style={{ color: isActive ? "green" : "#555" }}>{escrow.status}</strong>
          </p>
          <p>
            Client: <code>{escrow.client}</code>
            {isClient && " (you)"}
            <br />
            Freelancer: <code>{escrow.freelancer}</code>
            {isFreelancer && " (you)"}
            <br />
            Total: <strong>{fromStroops(escrow.total_amount)}</strong> token units
          </p>

          <h2>Milestones</h2>
          <ol>
            {escrow.milestones.map((m, i) => (
              <li key={i} style={{ marginBottom: "0.5rem" }}>
                {fromStroops(m.amount)} — {m.released ? "released" : "pending"}{" "}
                {isClient && isActive && !m.released && (
                  <button
                    disabled={loading}
                    onClick={() => void releaseMilestone(escrowId, i).then(refresh)}
                  >
                    Release
                  </button>
                )}
              </li>
            ))}
          </ol>

          {isParticipant && isActive && (
            <button
              disabled={loading}
              onClick={() => void openDispute(escrowId).then(refresh)}
            >
              Open dispute
            </button>
          )}
          {escrow.status === "Disputed" && (
            <p>This escrow is frozen pending arbitration.</p>
          )}
        </>
      )}
    </main>
  );
}
