/**
 * JobDetail.tsx
 *
 * Shows milestone progress for a single escrow job.
 * The client can release milestones or open a dispute; either participant can
 * rate the counterparty once the job is Completed. State is refreshed by polling
 * every 5s (Stellar finality).
 *
 * Contributor Notes:
 * - The route param is the *on-chain escrow id*, while `POST /api/reputation`
 *   keys its row on the off-chain job id. `findJobIdByEscrow` bridges the two,
 *   and only when the optional comment needs to be stored — the contract itself
 *   keeps no comment.
 * - The rating is written straight to `reputation.submit` (see
 *   `useEscrow.submitRating`) so the argument types are correct and the tx hash
 *   is available for the explorer link. The indexer mirrors the resulting
 *   `rated` event into the database, converging with any row the API created.
 * - While `Disputed`, the page shows the on-chain `dispute_deadline` and, for the
 *   client only, enables `reclaim_after_dispute_timeout` once that deadline has
 *   passed — the escape hatch for a panel that never rules (docs/DISPUTES.md).
 * - Opening a dispute takes a reason and runs two contract calls (see
 *   `useEscrow.openDispute`): the escrow is frozen, then `dispute.raise` mints
 *   the dispute the panel rules on. The id it returns is recorded against the
 *   off-chain row, which is where the reason is kept for the panel to read.
 * - Each unreleased milestone shows its deadline and whether it has passed, so
 *   the reminder is visible where the work is released, not only on the
 *   Dashboard panel (issue #74). Once it has passed, the client can reclaim just
 *   that milestone's unreleased remainder (`reclaim_milestone`, issue #402) —
 *   behind a confirmation, because the refund is irreversible.
 * - An unfunded `Created` escrow can be cancelled on-chain by its client
 *   (`escrow.cancel`, issue #402). That is a different action from the off-chain
 *   `POST /api/jobs/:id/cancel` the Dashboard uses for a draft job.
 * - Reading is public (issue #108): the escrow view is simulated from the
 *   read-only source, so a shared /jobs/:id link renders with no wallet
 *   connected — only release/dispute/reclaim/rate need one. A read failure is
 *   reported as "not found" or "unavailable" rather than blaming the id.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import StatusBadge from "../components/StatusBadge";
import AddressField from "../components/AddressField";
import FiatEstimate from "../components/FiatEstimate";
import JobDetailSkeleton from "../components/JobDetailSkeleton";
import Conversation from "../components/Conversation";
import DisputeEvidence from "../components/DisputeEvidence";
import ConfirmModal from "../components/ConfirmModal";
import { TransactionLink } from "../components/TransactionLink";
import { useEscrow, type EscrowView, type DisputeContractData } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";
import { explorerContractUrl } from "../lib/stellar";
import { shortAddress } from "../lib/address";
import { assetForContractId, formatAmount, fromBaseUnits, toBaseUnits } from "../lib/assets";
import {
  asReadError,
  describeReadFailure,
  type ContractReadError,
} from "../lib/errors";
import {
  authenticate,
  createDispute,
  fetchJobByEscrow,
  fetchJob,
  linkDisputeId,
  submitRating as recordRating,
  uploadJobMilestoneDeliverable,
  type DeliverableApi,
  type JobApi,
} from "../lib/api";
import { formatDeadline, formatRemaining, secondsUntil } from "../lib/time";
import { parseEscrowId } from "../lib/escrowId";

const POLL_MS = 5_000;

/** `ReputationError::AlreadyRated` (contracts/reputation/src/lib.rs). */
const ALREADY_RATED = 5;

/**
 * Same floor the API enforces (`raiseSchema`): a reason the panel cannot read is
 * not a reason, and the two limits must not drift.
 */
const MIN_REASON = 10;

const SCORES = [1, 2, 3, 4, 5];

/**
 * JobDetail is keyed by the on-chain escrow id; the reputation API keys a rating
 * on the off-chain job id, so resolve one to the other directly via by-escrow API (issue #173, #252).
 */
async function findJobIdByEscrow(escrowId: bigint): Promise<string | null> {
  try {
    const job = await fetchJobByEscrow(escrowId);
    return job?.id ?? null;
  } catch {
    return null;
  }
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const {
    getEscrow,
    releaseMilestone,
    releasePartial,
    openDispute,
    approveDisputeSplit,
    reclaimDisputed,
    reclaimExpired,
    reclaimMilestone,
    cancelEscrow,
    submitRating,
    getDisputeDeadline,
    getArbitrators,
    getDisputeThreshold,
    getDisputeRecord,
    isPending,
    hasPendingWrite,
    error,
    lastFailure,
  } = useEscrow();
  const { publicKey, connect, signMessage } = useWallet();
  const [escrow, setEscrow] = useState<EscrowView | null>(null);
  // A failed read, kept typed so the page can tell a dead link from a dead
  // network instead of showing "is the id correct?" for both.
  const [readFailure, setReadFailure] = useState<ContractReadError | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);
  // The conversation is scoped to the off-chain job id while this page is keyed
  // by the on-chain escrow id, so the two are bridged once (below) for the
  // participating wallet rather than on every 5s escrow poll.
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLookupDone, setJobLookupDone] = useState(false);
  // Dispute timelock: the deadline read from the contract (unix seconds) plus a
  // 1s clock so the remaining time ticks without re-reading the chain each tick.
  const [disputeDeadline, setDisputeDeadline] = useState<bigint | null>(null);
  const [panelArbitrators, setPanelArbitrators] = useState<string[]>([]);
  const [disputeThreshold, setDisputeThreshold] = useState<number>(1);
  const [disputeRecord, setDisputeRecord] = useState<DisputeContractData | null>(null);
  const [splitClientPercent, setSplitClientPercent] = useState<number>(50);
  const [splitSuccessNote, setSplitSuccessNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [rated, setRated] = useState(false);
  // Latched: the contract rejected the rating because this wallet already rated.
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [commentNote, setCommentNote] = useState<string | null>(null);
  // The dispute reason is what the panel rules on and is not recoverable if it
  // is dropped, so it is validated before any transaction is built.
  const [reason, setReason] = useState("");
  const [disputeNote, setDisputeNote] = useState<string | null>(null);

  // Deliverable attachments state (issue #65)
  const [offChainJobId, setOffChainJobId] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<Record<number, DeliverableApi[]>>({});
  const [attachingMilestoneIndex, setAttachingMilestoneIndex] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deliverableDesc, setDeliverableDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  // Cache for the off-chain job ID resolved from escrow ID to avoid redundant scans
  const [cachedJobId, setCachedJobId] = useState<string | null>(null);
  const [offChainJob, setOffChainJob] = useState<JobApi | null>(null);
  // Reclaim confirmation modal state (issue #259)
  const [confirmReclaimType, setConfirmReclaimType] = useState<"disputed" | "expired" | null>(null);
  // Per-milestone reclaim (issue #402): the index awaiting confirmation.
  const [confirmMilestoneReclaim, setConfirmMilestoneReclaim] = useState<number | null>(null);
  // Unfunded-escrow cancellation (issue #402).
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Partial milestone release state (issue #256)
  const [partialMilestoneIndex, setPartialMilestoneIndex] = useState<number | null>(null);
  const [partialAmount, setPartialAmount] = useState<string>("");
  const [partialError, setPartialError] = useState<string | null>(null);

  const escrowId = id ? parseEscrowId(id) : null;

  const loadJobDeliverables = useCallback(async (jobIdToLoad: string) => {
    try {
      const job = await fetchJob(jobIdToLoad);
      if (job) {
        setOffChainJob(job);
      }
      if (job?.milestones) {
        const map: Record<number, DeliverableApi[]> = {};
        for (const m of job.milestones) {
          if (m.deliverables && m.index !== undefined) {
            map[m.index] = m.deliverables;
          }
        }
        setDeliverables(map);
      }
    } catch {
      // Job might not have off-chain record
    }
  }, []);

  const refresh = useCallback(async () => {
    if (escrowId === null) return;
    // Don't let a background poll clobber state with a read that raced a write.
    if (hasPendingWrite()) return;
    try {
      const data = await getEscrow(escrowId);
      setEscrow(data);
      setReadFailure(null);
      // The deadline is immutable once set, but re-reading it on the poll keeps
      // the action available even if the first read raced the dispute opening.
      if (data.status === "Disputed") {
        try {
          setDisputeDeadline(await getDisputeDeadline(escrowId));
        } catch {
          // Leave the last known deadline: a failed deadline read must not
          // replace the escrow the visitor is looking at.
        }
        try {
          const [panel, thresh] = await Promise.all([
            getArbitrators(),
            getDisputeThreshold(),
          ]);
          setPanelArbitrators(panel || []);
          setDisputeThreshold(thresh || 1);
        } catch {
          // fallback
        }
      } else {
        setDisputeDeadline(null);
      }

      // Load off-chain job data and deliverables if available (but only on the
      // first load, not on every 5s poll; the job ID mapping is immutable).
      if (!cachedJobId) {
        try {
          const job = await fetchJobByEscrow(escrowId);
          if (job?.id) {
            setCachedJobId(job.id);
            setOffChainJobId(job.id);
            setOffChainJob(job);
            void loadJobDeliverables(job.id);
          }
        } catch {
          // ignore
        }
      }
    } catch (e) {
      // Keep the last good view: one failed poll must not blank the page.
      setReadFailure(asReadError(e));
    }
  }, [
    escrowId,
    getEscrow,
    getDisputeDeadline,
    getArbitrators,
    getDisputeThreshold,
    hasPendingWrite,
    loadJobDeliverables,
    cachedJobId,
  ]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Resolve the escrow id to the off-chain job id the messages API scopes to.
  // Nothing is fetched until a wallet is connected: both endpoints require it.
  useEffect(() => {
    if (escrowId === null || !publicKey) {
      setJobId(null);
      setJobLookupDone(false);
      return;
    }
    // Use cached job ID if available to avoid redundant job list scans
    if (cachedJobId) {
      setJobId(cachedJobId);
      setJobLookupDone(true);
      return;
    }
    let cancelled = false;
    setJobLookupDone(false);
    void findJobIdByEscrow(escrowId)
      .then((id) => {
        if (cancelled) return;
        setCachedJobId(id);
        setJobId(id);
        setJobLookupDone(true);
      })
      .catch(() => {
        if (cancelled) return;
        setJobId(null);
        setJobLookupDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [escrowId, publicKey, cachedJobId]);

  // Tick the countdown while a dispute is live, so "refundable in 2d 3h" is
  // accurate to the second between the 5s escrow polls.
  useEffect(() => {
    if (escrow?.status !== "Disputed") return;
    setNow(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, [escrow?.status]);

  useEffect(() => {
    if (escrow?.status !== "Disputed") return;
    const onChainDisputeId = offChainJob?.disputes?.[0]?.onChainId;
    const disputeIdToQuery = onChainDisputeId ? BigInt(onChainDisputeId) : (escrowId !== null ? escrowId : null);
    if (disputeIdToQuery !== null) {
      void getDisputeRecord(disputeIdToQuery)
        .then((rec) => {
          if (rec) setDisputeRecord(rec);
        })
        .catch(() => {});
    }
  }, [offChainJob, escrowId, escrow?.status, getDisputeRecord]);

  // The 5s poll resets `lastFailure` on every read, so latch the rejection
  // instead of reading the hook's state directly.
  useEffect(() => {
    if (lastFailure?.kind === "rate" && lastFailure.code === ALREADY_RATED) {
      setAlreadyRated(true);
    }
  }, [lastFailure]);

  // What a failed read tells the visitor: a dead link and an unreachable
  // network are different problems with different next steps.
  const loadError = readFailure
    ? `${describeReadFailure(readFailure.kind, `job #${id}`)}${
        readFailure.kind === "unknown" ? ` (${readFailure.message})` : ""
      }`
    : null;

  if (escrowId === null) {
    return (
      <Layout>
        <p role="alert">
          Invalid job id{id ? ` "${id}"` : ""}.{" "}
          Escrow ids must be non-negative integers.
        </p>
        <p>
          <Link to="/">← Back to Dashboard</Link>
        </p>
      </Layout>
    );
  }

  // Read at render time rather than from the ticking `now` state above: that
  // clock only runs while a dispute is live, and a milestone deadline matters in
  // every state. The 5s escrow poll re-renders often enough to keep it honest.
  const milestoneNow = Math.floor(Date.now() / 1000);

  // Show amounts in the escrow's asset (fall back to raw token units if the
  // SAC is not in the registry).
  const asset = escrow ? assetForContractId(escrow.token) : null;
  const decimals = asset?.decimals ?? 7;
  const symbol = asset?.symbol ?? "tokens";
  const unreleasedAmount =
    escrow?.milestones.reduce((acc, m) => acc + (m.amount - m.released_amount), 0n) ?? 0n;

  const isClient = publicKey !== null && escrow?.client === publicKey;
  const isFreelancer = publicKey !== null && escrow?.freelancer === publicKey;
  const isParticipant = isClient || isFreelancer;
  const isCreated = escrow?.status === "Created";
  const isActive = escrow?.status === "Active";
  const isCompleted = escrow?.status === "Completed";
  /** The address the connected participant would rate. */
  const counterparty = escrow ? (isClient ? escrow.freelancer : escrow.client) : null;
  const canRate = isParticipant && isCompleted && counterparty !== null;
  const showRatingForm = canRate && !rated && !alreadyRated;
  const ratingDone = canRate && (rated || alreadyRated);
  const isDisputed = escrow?.status === "Disputed";
  // The contract requires `ledger.timestamp() > deadline`, so equality is not enough.
  const deadlinePassed = disputeDeadline !== null && BigInt(now) > disputeDeadline;

  /** Store the optional comment off-chain; the rating itself is already on-chain. */
  async function saveComment(text: string, ratee: string) {
    if (escrowId === null || !publicKey) return;
    try {
      // Use cached job ID if available; otherwise resolve it
      let jobIdToUse = cachedJobId;
      if (!jobIdToUse) {
        jobIdToUse = await findJobIdByEscrow(escrowId);
        if (jobIdToUse) setCachedJobId(jobIdToUse);
      }
      if (!jobIdToUse) {
        setCommentNote(
          "Rating submitted. The comment was not saved — this job has no off-chain record.",
        );
        return;
      }
      const token = await authenticate(publicKey, signMessage);
      await recordRating({ jobId: jobIdToUse, rateeAddress: ratee, score, comment: text }, token);
    } catch (err) {
      setCommentNote(
        `Rating submitted, but the comment was not saved: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async function handleRate(e: React.FormEvent) {
    e.preventDefault();
    if (escrowId === null || !counterparty || score < 1) return;
    setCommentNote(null);
    const res = await submitRating(escrowId, counterparty, score);
    if (!res) return; // the hook surfaced a friendly error
    setLastHash(res.hash);
    setRated(true);
    const text = comment.trim();
    if (text) void saveComment(text, counterparty);
  }

  /**
   * Freeze the escrow, raise the dispute, then record it off-chain.
   *
   * The contract calls are `open_dispute` then `raise` (see
   * `useEscrow.openDispute`). Only once `raise` has confirmed is there an id to
   * store, and storing it is what makes `resolve` reachable without waiting for
   * the indexer to catch up.
   */
  async function handleOpenDispute(e: React.FormEvent) {
    e.preventDefault();
    if (escrowId === null) return;
    const text = reason.trim();
    if (text.length < MIN_REASON) return;
    setDisputeNote(null);
    const res = await openDispute(escrowId, text);
    if (!res) return; // the hook surfaced a friendly error
    setLastHash(res.hash);
    await saveDispute(escrowId, text, res.disputeId);
    void refresh();
  }

  async function handleApproveSplit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) return;
    const onChainDisputeId = offChainJob?.disputes?.[0]?.onChainId
      ? BigInt(offChainJob.disputes[0].onChainId)
      : null;
    const disputeIdToUse = onChainDisputeId ?? escrowId;
    if (disputeIdToUse === null) return;

    const clientShareStroops = (unreleasedAmount * BigInt(splitClientPercent)) / 100n;
    const freelancerShareStroops = unreleasedAmount - clientShareStroops;

    const res = await approveDisputeSplit(disputeIdToUse, clientShareStroops, freelancerShareStroops);
    if (res) {
      setLastHash(res.hash);
      setSplitSuccessNote(`Split approved: ${splitClientPercent}% client / ${100 - splitClientPercent}% freelancer.`);
      try {
        const rec = await getDisputeRecord(disputeIdToUse);
        setDisputeRecord(rec);
      } catch {
        // ignore
      }
    }
  }

  async function handleUploadDeliverable(e: React.FormEvent, milestoneIndex: number) {
    e.preventDefault();
    if (!selectedFile || !publicKey) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const fileUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(selectedFile);
      });

      let targetJobId = offChainJobId || cachedJobId;
      if (!targetJobId && escrowId !== null) {
        targetJobId = await findJobIdByEscrow(escrowId);
        if (targetJobId) setCachedJobId(targetJobId);
      }
      if (!targetJobId) {
        throw new Error("Could not find matching job record to attach deliverable");
      }

      const token = await authenticate(publicKey, signMessage);
      const newDeliv = await uploadJobMilestoneDeliverable(
        targetJobId,
        milestoneIndex,
        {
          fileName: selectedFile.name,
          fileUrl,
          fileSize: selectedFile.size,
          fileType: selectedFile.type,
          description: deliverableDesc.trim() || undefined,
        },
        token,
      );

      setDeliverables((prev) => ({
        ...prev,
        [milestoneIndex]: [newDeliv, ...(prev[milestoneIndex] || [])],
      }));
      setUploadSuccess("Deliverable attached successfully!");
      setSelectedFile(null);
      setDeliverableDesc("");
      setTimeout(() => {
        setAttachingMilestoneIndex(null);
        setUploadSuccess(null);
      }, 1500);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload deliverable");
    } finally {
      setUploading(false);
    }
  }

  /**
   * Store the off-chain dispute row: the reason, plus the id `raise` returned.
   *
   * The dispute is already on-chain by this point, so a failure here must not
   * read as one — it is reported as its own note, because the panel reads the
   * row and the row is the only copy of the reason.
   */
  async function saveDispute(escrow: bigint, text: string, disputeId: bigint) {
    if (!publicKey) return;
    try {
      // Use cached job ID if available; otherwise resolve it
      let jobIdToUse = cachedJobId;
      if (!jobIdToUse) {
        jobIdToUse = await findJobIdByEscrow(escrow);
        if (jobIdToUse) setCachedJobId(jobIdToUse);
      }
      if (!jobIdToUse) {
        setDisputeNote(
          "The dispute is on-chain. This job has no off-chain record, so the reason was not stored.",
        );
        return;
      }
      const token = await authenticate(publicKey, signMessage);
      const { dispute } = await createDispute({ jobId: jobIdToUse, reason: text }, token);
      await linkDisputeId(dispute.id, disputeId, token);
    } catch (err) {
      setDisputeNote(
        `The dispute is on-chain, but its record was not saved: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return (
    <Layout>
      <h1>Job #{id}</h1>

      {!publicKey && (
        <p>
          <button onClick={() => void connect()}>Connect a wallet</button> to act on this
          job. Reading it needs no wallet.
        </p>
      )}

      {(error || loadError) && (
        <div className="error-state">
          <p role="alert" aria-live="assertive" className="alert alert-error">
            {error ?? loadError}
          </p>
          <button
            type="button"
            className="btn-retry"
            onClick={() => {
              setReadFailure(null);
              void refresh();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {hasPendingWrite() && (
        <div
          role="status"
          aria-live="polite"
          className="transaction-status pending"
        >
          <span aria-hidden="true">⏳</span>
          <span>Signing transaction… awaiting ledger confirmation</span>
        </div>
      )}

      {!escrow && !error && !loadError && <JobDetailSkeleton />}

      {escrow && (
        <>
          <p className="job-actions">
            <Link to={`/jobs/${escrowId}/receipt`}>View receipt</Link>
          </p>
          <p>
            Status: <StatusBadge status={escrow.status} />
            {offChainJob?.isVerified && (
              <> <StatusBadge status={offChainJob.verificationSource ?? "Verified Grant"} /></>
            )}
          </p>
          <p>
            Client: <AddressField address={escrow.client} label="Client address" qr />
            {isClient && " (you)"}
            <br />
            Freelancer:{" "}
            <AddressField address={escrow.freelancer} label="Freelancer address" qr />
            {isFreelancer && " (you)"}
            <br />
            Total: <strong>{formatAmount(escrow.total_amount, decimals)}</strong> {symbol}{" "}
            <FiatEstimate
              amount={formatAmount(escrow.total_amount, decimals)}
              asset={symbol}
            />
          </p>

          <h2>Milestones</h2>
          <ol>
            {escrow.milestones.map((m, i) => {
              const remaining = m.amount - m.released_amount;
              const pct =
                m.amount > 0n
                  ? Math.min(100, Math.round((Number(m.released_amount) / Number(m.amount)) * 100))
                  : 0;
              const isPartialOpen = partialMilestoneIndex === i;

              return (
                <li key={i} style={{ marginBottom: "1.25rem" }}>
                  <div>
                    {fromBaseUnits(m.amount, decimals)} {symbol}{" "}
                    <FiatEstimate amount={fromBaseUnits(m.amount, decimals)} asset={symbol} /> —{" "}
                    {m.released
                      ? "released"
                      : `${fromBaseUnits(m.released_amount, decimals)} released, ${fromBaseUnits(
                          remaining,
                          decimals,
                        )} remaining`}{" "}
                    {!m.released && m.deadline > 0n && (
                      <span className="muted">
                        · due{" "}
                        <time
                          dateTime={new Date(Number(m.deadline) * 1000).toISOString()}
                        >
                          {formatDeadline(m.deadline)}
                        </time>
                        {secondsUntil(m.deadline, milestoneNow) === 0
                          ? " (overdue)"
                          : ` (${formatRemaining(
                              secondsUntil(m.deadline, milestoneNow),
                            )} left)`}
                      </span>
                    )}{" "}
                    {isClient && isActive && !m.released && (
                      <>
                        <button
                          disabled={isPending("release", `${escrowId}:${i}`)}
                          aria-busy={isPending("release", `${escrowId}:${i}`)}
                          onClick={() =>
                            void releaseMilestone(escrowId, i).then((res) => {
                              if (res) setLastHash(res.hash);
                              void refresh();
                            })
                          }
                        >
                          Release
                        </button>{" "}
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={isPending("release", `${escrowId}:${i}`)}
                          onClick={() => {
                            if (isPartialOpen) {
                              setPartialMilestoneIndex(null);
                              setPartialAmount("");
                              setPartialError(null);
                            } else {
                              setPartialMilestoneIndex(i);
                              setPartialAmount("");
                              setPartialError(null);
                            }
                          }}
                        >
                          {isPartialOpen ? "Cancel Partial" : "Release Partial"}
                        </button>{" "}
                        {/* Per-milestone reclaim (issue #402): available once
                            this milestone's own deadline passes, and only for
                            the part that has not already been released. */}
                        {m.deadline > 0n &&
                          secondsUntil(m.deadline, milestoneNow) === 0 &&
                          remaining > 0n && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={isPending("reclaim", `${escrowId}:${i}`)}
                              aria-busy={isPending("reclaim", `${escrowId}:${i}`)}
                              title={`Refund this milestone's unreleased ${fromBaseUnits(
                                remaining,
                                decimals,
                              )} ${symbol} to your wallet`}
                              onClick={() => setConfirmMilestoneReclaim(i)}
                            >
                              {isPending("reclaim", `${escrowId}:${i}`)
                                ? "Reclaiming…"
                                : "Reclaim milestone"}
                            </button>
                          )}
                      </>
                    )}
                  </div>

                  <div style={{ marginTop: "0.35rem", marginBottom: "0.5rem" }}>
                    <progress
                      aria-label={`Milestone ${i + 1} release progress`}
                      value={Number(m.released_amount)}
                      max={Number(m.amount)}
                      style={{ width: "100%", height: "8px" }}
                    >
                      {pct}%
                    </progress>
                    <div style={{ fontSize: "0.8rem", color: "var(--muted, #64748b)" }}>
                      {pct}% released ({fromBaseUnits(m.released_amount, decimals)} / {fromBaseUnits(m.amount, decimals)} {symbol})
                    </div>
                  </div>

                  {isClient && isActive && !m.released && isPartialOpen && (
                    <form
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        const numVal = Number(partialAmount);
                        if (!partialAmount || isNaN(numVal) || numVal <= 0) {
                          setPartialError("Please enter a valid amount greater than 0");
                          return;
                        }
                        const partialBase = toBaseUnits(partialAmount, decimals);
                        if (partialBase > remaining) {
                          setPartialError(
                            `Amount cannot exceed remaining balance of ${fromBaseUnits(remaining, decimals)} ${symbol}`,
                          );
                          return;
                        }
                        setPartialError(null);
                        void releasePartial(escrowId, i, partialBase).then((res) => {
                          if (res) setLastHash(res.hash);
                          setPartialMilestoneIndex(null);
                          setPartialAmount("");
                          void refresh();
                        });
                      }}
                      style={{
                        margin: "0.5rem 0",
                        padding: "0.75rem",
                        background: "var(--card-bg, #f8fafc)",
                        border: "1px solid var(--border, #e2e8f0)",
                        borderRadius: "var(--radius, 6px)",
                        maxWidth: "420px",
                      }}
                    >
                      <label
                        htmlFor={`partial-amount-${i}`}
                        style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem" }}
                      >
                        Release Partial Amount ({symbol}):
                        <input
                          id={`partial-amount-${i}`}
                          type="number"
                          step={`0.${"0".repeat(decimals - 1)}1`}
                          min="0"
                          max={fromBaseUnits(remaining, decimals)}
                          value={partialAmount}
                          placeholder={`Max ${fromBaseUnits(remaining, decimals)}`}
                          onChange={(e) => {
                            setPartialAmount(e.target.value);
                            setPartialError(null);
                          }}
                          style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
                          required
                        />
                      </label>
                      {partialError && (
                        <p
                          role="alert"
                          style={{
                            color: "var(--danger, #ef4444)",
                            fontSize: "0.85rem",
                            margin: "0.25rem 0",
                          }}
                        >
                          {partialError}
                        </p>
                      )}
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                        <button
                          type="submit"
                          className="btn-primary"
                          disabled={isPending("release", `${escrowId}:${i}`)}
                          aria-busy={isPending("release", `${escrowId}:${i}`)}
                        >
                          Confirm Partial Release
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setPartialMilestoneIndex(null);
                            setPartialAmount("");
                            setPartialError(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                {/* Deliverables for this milestone (issue #65). */}
                <div
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem",
                    background: "var(--bg)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <strong>Deliverables:</strong>
                  {!deliverables[i] || deliverables[i].length === 0 ? (
                    <p className="muted" style={{ margin: "0.25rem 0", fontSize: "0.9rem" }}>
                      No deliverable files attached yet.
                    </p>
                  ) : (
                    <ul
                      style={{
                        margin: "0.25rem 0",
                        paddingLeft: "1.25rem",
                        fontSize: "0.9rem",
                      }}
                    >
                      {deliverables[i].map((d) => (
                        <li key={d.id}>
                          <a
                            href={d.fileUrl}
                            download={d.fileName}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {d.fileName}
                          </a>
                          {d.fileSize ? ` (${(d.fileSize / 1024).toFixed(1)} KB)` : ""}
                          {d.description ? ` — ${d.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}

                  {isFreelancer && isActive && !m.released && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachingMilestoneIndex(attachingMilestoneIndex === i ? null : i);
                          setUploadError(null);
                          setUploadSuccess(null);
                        }}
                      >
                        {attachingMilestoneIndex === i
                          ? "Cancel Attachment"
                          : "Attach Deliverable"}
                      </button>

                      {attachingMilestoneIndex === i && (
                        <form
                          onSubmit={(e) => void handleUploadDeliverable(e, i)}
                          style={{
                            marginTop: "0.5rem",
                            padding: "0.5rem",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius)",
                            background: "var(--surface)",
                          }}
                        >
                          <label>
                            Select File
                            <br />
                            <input
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg,.zip"
                              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                              required
                            />
                          </label>
                          <br />
                          <label style={{ display: "block", marginTop: "0.5rem" }}>
                            Description (optional)
                            <br />
                            <input
                              type="text"
                              value={deliverableDesc}
                              onChange={(e) => setDeliverableDesc(e.target.value)}
                              placeholder="Notes about this deliverable…"
                              size={40}
                            />
                          </label>
                          {uploadError && (
                            <p
                              role="alert"
                              className="alert alert-error"
                              style={{ marginTop: "0.5rem" }}
                            >
                              {uploadError}
                            </p>
                          )}
                          {uploadSuccess && (
                            <p className="alert" style={{ marginTop: "0.5rem" }}>
                              {uploadSuccess}
                            </p>
                          )}
                          <button
                            type="submit"
                            disabled={uploading || !selectedFile}
                            className="btn-primary"
                            style={{ marginTop: "0.5rem" }}
                          >
                            {uploading ? "Uploading…" : "Upload Deliverable"}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          </ol>

          {isParticipant && isActive && (
            <form onSubmit={handleOpenDispute}>
              <p>
                <label htmlFor="dispute-reason">
                  Reason for the dispute
                  <textarea
                    id="dispute-reason"
                    className="form-control"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    minLength={MIN_REASON}
                    maxLength={1000}
                    rows={3}
                    placeholder="What went wrong? The arbitrator panel reads this."
                    required
                  />
                </label>
              </p>
              <button
                type="submit"
                disabled={reason.trim().length < MIN_REASON || isPending("dispute", `${escrowId}`)}
                aria-busy={isPending("dispute", `${escrowId}`)}
                title={
                  reason.trim().length < MIN_REASON
                    ? `A reason of at least ${MIN_REASON} characters is required`
                    : "Freeze the escrow and raise a dispute"
                }
              >
                {isPending("dispute", `${escrowId}`) ? "Opening…" : "Open dispute"}
              </button>
            </form>
          )}
          {disputeNote && (
            <p role="status" aria-live="polite" className="muted">
              {disputeNote}
            </p>
          )}
          {isDisputed && (
            <section>
              <p className="muted">This escrow is frozen pending arbitration.</p>
              {disputeDeadline !== null &&
                (deadlinePassed ? (
                  <p className="muted">
                    The dispute timelock has passed. Unreleased funds ({formatAmount(unreleasedAmount, decimals)} {symbol}) can be reclaimed.
                  </p>
                ) : (
                  <p className="muted">
                    Reclaimable only after {""}
                    <time dateTime={new Date(Number(disputeDeadline) * 1000).toISOString()}>
                      {formatDeadline(disputeDeadline)}
                    </time>{" "}
                    ({formatRemaining(secondsUntil(disputeDeadline, now))} left).
                  </p>
                ))}
              {isClient && (
                <button
                  disabled={!deadlinePassed || isPending("reclaim", `${escrowId}`)}
                  aria-busy={isPending("reclaim", `${escrowId}`)}
                  title={
                    deadlinePassed
                      ? `Refund the unreleased funds (${formatAmount(unreleasedAmount, decimals)} ${symbol}) to your wallet`
                      : "The dispute timelock has not passed yet"
                  }
                  onClick={() => setConfirmReclaimType("disputed")}
                >
                  {isPending("reclaim", `${escrowId}`)
                    ? "Reclaiming…"
                    : "Reclaim after timeout"}
                </button>
              )}

              {/* Multi-arbitrator voting progress and approval status (issue #257) */}
              <div className="dispute-panel" data-testid="dispute-panel">
                <h4>Multi-Arbitrator Panel & Voting Progress</h4>
                <div className="dispute-voting-progress">
                  <p>
                    <strong>Approval Progress:</strong>{" "}
                    <span className="badge badge-active">
                      {disputeRecord?.status === "Resolved" || (disputeRecord?.status === "UnderReview" && disputeThreshold === 1)
                        ? `${disputeThreshold} of ${disputeThreshold} approvals`
                        : `${disputeRecord?.status === "UnderReview" ? 1 : 0} of ${disputeThreshold} approvals required`}
                    </span>{" "}
                    ({disputeThreshold} of {panelArbitrators.length > 0 ? panelArbitrators.length : 1} panel members required)
                  </p>
                  <progress
                    value={
                      disputeRecord?.status === "Resolved" || (disputeRecord?.status === "UnderReview" && disputeThreshold === 1)
                        ? disputeThreshold
                        : disputeRecord?.status === "UnderReview"
                        ? 1
                        : 0
                    }
                    max={disputeThreshold}
                    style={{ width: "100%", height: "8px" }}
                  />
                </div>

                {disputeRecord?.status === "Resolved" && (
                  <p className="alert alert-success" role="status">
                    Resolution threshold reached ({disputeThreshold} of {disputeThreshold} approvals). Dispute resolution confirmed.
                  </p>
                )}

                {panelArbitrators.length > 0 && (
                  <div className="arbitrator-list">
                    <h5>Panel Arbitrators ({panelArbitrators.length})</h5>
                    <ul>
                      {panelArbitrators.map((arb) => {
                        const isMe = arb === publicKey;
                        return (
                          <li key={arb}>
                            <code>{shortAddress(arb)}</code>
                            {isMe && <span className="badge badge-active">You (Arbitrator)</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="dispute-split-status">
                  <h5>Active Proposed Split</h5>
                  <p>
                    Client Share:{" "}
                    <strong>
                      {formatAmount((unreleasedAmount * BigInt(splitClientPercent)) / 100n, decimals)} {symbol} ({splitClientPercent}%)
                    </strong>
                    {" · "}
                    Freelancer Share:{" "}
                    <strong>
                      {formatAmount(unreleasedAmount - (unreleasedAmount * BigInt(splitClientPercent)) / 100n, decimals)} {symbol} ({100 - splitClientPercent}%)
                    </strong>
                  </p>
                </div>

                {splitSuccessNote && (
                  <p className="alert alert-success" role="status">
                    {splitSuccessNote}
                  </p>
                )}

                {publicKey && panelArbitrators.includes(publicKey) && disputeRecord?.status !== "Resolved" && (
                  <form onSubmit={handleApproveSplit} className="dispute-vote-form">
                    <h5>Cast Arbitrator Vote</h5>
                    <label>
                      Client Share (%):
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={splitClientPercent}
                        onChange={(e) => setSplitClientPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                      />
                    </label>
                    <p className="muted">Freelancer receives remainder: {100 - splitClientPercent}%</p>
                    <button
                      type="submit"
                      disabled={isPending("dispute", `${offChainJob?.disputes?.[0]?.onChainId ?? escrowId}`)}
                      aria-busy={isPending("dispute", `${offChainJob?.disputes?.[0]?.onChainId ?? escrowId}`)}
                    >
                      {isPending("dispute", `${offChainJob?.disputes?.[0]?.onChainId ?? escrowId}`)
                        ? "Approving Split…"
                        : "Approve Split"}
                    </button>
                  </form>
                )}
              </div>

              {/* Notes and attachments the parties submitted (#78). The
                  off-chain dispute row is the id the evidence API scopes to;
                  it is loaded for participants once the job resolves. */}
              {isParticipant && offChainJob?.disputes?.[0] && (
                <DisputeEvidence
                  disputeId={offChainJob.disputes[0].id}
                  status={offChainJob.disputes[0].status}
                />
              )}
            </section>
          )}

          {isCreated && isClient && (
            <section>
              <p className="muted">
                This escrow has not been funded. Cancelling closes it on-chain as{" "}
                Cancelled; no funds move because none were ever deposited, and it can no
                longer be funded afterwards.
              </p>
              <button
                disabled={isPending("cancel", `${escrowId}`)}
                aria-busy={isPending("cancel", `${escrowId}`)}
                title="Close this unfunded escrow on-chain"
                onClick={() => setConfirmCancel(true)}
              >
                {isPending("cancel", `${escrowId}`) ? "Cancelling…" : "Cancel escrow"}
              </button>
            </section>
          )}

          {isActive && isClient && escrow.expiry > 0n && BigInt(now) > escrow.expiry && (
            <section>
              <p className="muted">
                This escrow has passed its safety expiry. Unreleased funds ({formatAmount(unreleasedAmount, decimals)} {symbol}) can be reclaimed.
              </p>
              <button
                disabled={isPending("reclaim", `${escrowId}`)}
                aria-busy={isPending("reclaim", `${escrowId}`)}
                title={`Refund the unreleased funds (${formatAmount(unreleasedAmount, decimals)} ${symbol}) to your wallet`}
                onClick={() => setConfirmReclaimType("expired")}
              >
                {isPending("reclaim", `${escrowId}`)
                  ? "Reclaiming…"
                  : "Reclaim expired escrow"}
              </button>
            </section>
          )}

          {showRatingForm && (
            <section>
              <h2>Rate your counterparty</h2>
              <p className="muted">
                Ratings are recorded on-chain and cannot be changed or removed.
              </p>
              <form onSubmit={handleRate}>
                <fieldset disabled={isPending("rate")}>
                  <legend>Score</legend>
                  {SCORES.map((n) => (
                    <label key={n} htmlFor={`rating-score-${n}`}>
                      <input
                        type="radio"
                        id={`rating-score-${n}`}
                        name="score"
                        value={n}
                        checked={score === n}
                        onChange={() => setScore(n)}
                      />{" "}
                      {n}★
                    </label>
                  ))}
                </fieldset>
                <p>
                  <label htmlFor="rating-comment">
                    Comment (optional)
                    <textarea
                      id="rating-comment"
                      className="form-control"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={500}
                      rows={2}
                    />
                  </label>
                </p>
                <button
                  type="submit"
                  disabled={score < 1 || isPending("rate")}
                  aria-busy={isPending("rate")}
                >
                  {isPending("rate") ? "Submitting…" : "Submit rating"}
                </button>
                {isPending("rate") && (
                  <p role="status" aria-live="polite" className="muted" style={{ marginTop: "0.5rem" }}>
                    Submitting rating to Stellar ledger…
                  </p>
                )}
              </form>
            </section>
          )}

          {ratingDone && (
            <p role="status" aria-live="polite">
              {alreadyRated ? "You've already rated this job." : "Thanks — your rating was submitted."}{" "}
              <Link to={`/profile/${counterparty}`}>View reputation →</Link>
            </p>
          )}
          {commentNote && (
            <p role="status" aria-live="polite" className="muted">
              {commentNote}
            </p>
          )}

          {/* Only a participant has a conversation to read, and only once the
              off-chain job that scopes it has been found. */}
          {isParticipant &&
            (jobId !== null ? (
              <Conversation jobId={jobId} />
            ) : jobLookupDone ? (
              <section className="conversation">
                <h2>Messages</h2>
                <p className="muted">
                  Messaging is unavailable for this job: it has no off-chain record to
                  scope the conversation to.
                </p>
              </section>
            ) : null)}

          {lastHash && (
            <div role="status" aria-live="polite" className="transaction-status confirmed">
              <span aria-hidden="true">✓</span>
              <span>
                Last transaction:{" "}
                <TransactionLink hash={lastHash} />
                {escrow && (
                  <>
                    {" "}·{" "}
                    <a
                      href={explorerContractUrl(escrow.token)}
                      target="_blank"
                      rel="noreferrer"
                      title={`Token contract: ${escrow.token}`}
                    >
                      View {symbol} contract
                    </a>
                  </>
                )}
              </span>
            </div>
          )}

          {confirmReclaimType && (
            <ConfirmModal
              isOpen={true}
              title={
                confirmReclaimType === "disputed"
                  ? "Confirm Dispute Timelock Reclaim"
                  : "Confirm Expired Escrow Reclaim"
              }
              description={
                confirmReclaimType === "disputed"
                  ? "The dispute timelock has elapsed without arbitrator resolution. Confirming will close the escrow, permanently refund all unreleased funds back to your wallet, and mark the job as refunded."
                  : "This escrow has passed its on-chain safety expiration date. Confirming will close the job permanently and return all unreleased escrowed funds to your wallet."
              }
              amount={formatAmount(unreleasedAmount, decimals)}
              assetSymbol={symbol}
              confirmLabel={confirmReclaimType === "disputed" ? "Confirm Reclaim" : "Confirm Expired Reclaim"}
              cancelLabel="Cancel"
              isDangerous={true}
              isPending={isPending("reclaim", `${escrowId}`)}
              onCancel={() => setConfirmReclaimType(null)}
              onConfirm={() => {
                const type = confirmReclaimType;
                setConfirmReclaimType(null);
                if (type === "disputed") {
                  void reclaimDisputed(escrowId).then((res) => {
                    if (res) setLastHash(res.hash);
                    void refresh();
                  });
                } else if (type === "expired") {
                  void reclaimExpired(escrowId).then((res) => {
                    if (res) setLastHash(res.hash);
                    void refresh();
                  });
                }
              }}
            />
          )}

          {confirmMilestoneReclaim !== null && escrow && (
            <ConfirmModal
              isOpen={true}
              title="Confirm Milestone Reclaim"
              description={`Milestone ${confirmMilestoneReclaim + 1}'s deadline has passed. Confirming refunds its unreleased balance to your wallet and closes that milestone; anything already released stays with the freelancer.`}
              amount={formatAmount(
                escrow.milestones[confirmMilestoneReclaim].amount -
                  escrow.milestones[confirmMilestoneReclaim].released_amount,
                decimals,
              )}
              assetSymbol={symbol}
              confirmLabel="Confirm Milestone Reclaim"
              cancelLabel="Cancel"
              isDangerous={true}
              isPending={isPending("reclaim", `${escrowId}:${confirmMilestoneReclaim}`)}
              onCancel={() => setConfirmMilestoneReclaim(null)}
              onConfirm={() => {
                const index = confirmMilestoneReclaim;
                setConfirmMilestoneReclaim(null);
                void reclaimMilestone(escrowId, index).then((res) => {
                  if (res) setLastHash(res.hash);
                  void refresh();
                });
              }}
            />
          )}

          {confirmCancel && (
            <ConfirmModal
              isOpen={true}
              title="Confirm Escrow Cancellation"
              description="This escrow has not been funded. Confirming closes it on-chain as Cancelled; no funds move, and the escrow can no longer be funded."
              amount={formatAmount(escrow.total_amount, decimals)}
              assetSymbol={symbol}
              confirmLabel="Confirm Cancellation"
              cancelLabel="Keep escrow"
              isDangerous={true}
              isPending={isPending("cancel", `${escrowId}`)}
              onCancel={() => setConfirmCancel(false)}
              onConfirm={() => {
                setConfirmCancel(false);
                void cancelEscrow(escrowId).then((res) => {
                  if (res) setLastHash(res.hash);
                  void refresh();
                });
              }}
            />
          )}
        </>
      )}
    </Layout>
  );
}
