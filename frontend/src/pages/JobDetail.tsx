/**
 * JobDetail.tsx
 *
 * Shows milestone progress for a single escrow job.
 * The client can release milestones or open a dispute; the freelancer can see
 * payment status. State is refreshed by polling every 5s (Stellar finality).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import { useEscrow, type EscrowView } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";
import { explorerTxUrl } from "../lib/stellar";
import { assetForContractId, fromBaseUnits } from "../lib/assets";

const POLL_MS = 5_000;

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { getEscrow, releaseMilestone, openDispute, isPending, hasPendingWrite, error } =
    useEscrow();
  const { publicKey, connect } = useWallet();
  const [escrow, setEscrow] = useState<EscrowView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const escrowId = id ? BigInt(id) : null;

  const refresh = useCallback(async () => {
    if (escrowId === null) return;
    // Don't let a background poll clobber state with a read that raced a write.
    if (hasPendingWrite()) return;
    const data = await getEscrow(escrowId);
    if (data) setEscrow(data);
    else setLoadError("Could not load escrow (is the id correct?)");
  }, [escrowId, getEscrow, hasPendingWrite]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (escrowId === null) {
    return (
      <Layout>
        <p>Invalid job id.</p>
      </Layout>
    );
  }

  // Show amounts in the escrow's asset (fall back to raw token units if the
  // SAC is not in the registry).
  const asset = escrow ? assetForContractId(escrow.token) : null;
  const decimals = asset?.decimals ?? 7;
  const symbol = asset?.symbol ?? "tokens";

  const isClient = publicKey !== null && escrow?.client === publicKey;
  const isFreelancer = publicKey !== null && escrow?.freelancer === publicKey;
  const isParticipant = isClient || isFreelancer;
  const isActive = escrow?.status === "Active";

  return (
    <Layout>
      <h1>Job #{id}</h1>

      {!publicKey && (
        <p>
          <button onClick={() => void connect()}>Connect Freighter</button> to act on this
          job.
        </p>
      )}

      {(error || loadError) && (
        <p role="alert" className="alert alert-error">
          {error ?? loadError}
        </p>
      )}

      {escrow && (
        <>
          <p>
            Status: <StatusBadge status={escrow.status} />
          </p>
          <p>
            Client: <code>{escrow.client}</code>
            {isClient && " (you)"}
            <br />
            Freelancer: <code>{escrow.freelancer}</code>
            {isFreelancer && " (you)"}
            <br />
            Total: <strong>{fromBaseUnits(escrow.total_amount, decimals)}</strong> {symbol}
          </p>

          <h2>Milestones</h2>
          <ol>
            {escrow.milestones.map((m, i) => (
              <li key={i}>
                {fromBaseUnits(m.amount, decimals)} {symbol} —{" "}
                {m.released
                  ? "released"
                  : `${fromBaseUnits(m.released_amount, decimals)} released, ${fromBaseUnits(
                      m.amount - m.released_amount,
                      decimals,
                    )} remaining`}{" "}
                {isClient && isActive && !m.released && (
                  <button
                    disabled={isPending("release", `${escrowId}:${i}`)}
                    onClick={() =>
                      void releaseMilestone(escrowId, i).then((res) => {
                        if (res) setLastHash(res.hash);
                        void refresh();
                      })
                    }
                  >
                    Release
                  </button>
                )}
              </li>
            ))}
          </ol>

          {isParticipant && isActive && (
            <button
              disabled={isPending("dispute", `${escrowId}`)}
              onClick={() =>
                void openDispute(escrowId).then((res) => {
                  if (res) setLastHash(res.hash);
                  void refresh();
                })
              }
            >
              Open dispute
            </button>
          )}
          {escrow.status === "Disputed" && (
            <p className="muted">This escrow is frozen pending arbitration.</p>
          )}

          {lastHash && (
            <p>
              Last transaction:{" "}
              <a
                href={explorerTxUrl(lastHash)}
                target="_blank"
                rel="noreferrer"
                title={lastHash}
              >
                <code>{lastHash.slice(0, 12)}…</code>
              </a>
            </p>
          )}
        </>
      )}
    </Layout>
  );
}
