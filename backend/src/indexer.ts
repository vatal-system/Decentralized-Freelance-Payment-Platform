/**
 * indexer.ts
 *
 * Polls Soroban RPC for contract events emitted by the escrow, dispute, and
 * reputation contracts, then syncs state into PostgreSQL.
 *
 * This keeps the DB in sync without requiring the frontend to call /sync
 * endpoints manually after every transaction.
 *
 * Events handled (see docs/EVENTS.md):
 *   escrow     — created, funded, milestones_updated, milestone_released,
 *                dispute_opened, resolved, refunded
 *   dispute    — raised, approved, dispute_resolved
 *   reputation — rated
 *
 * Contributor Notes:
 * - The cursor (last scanned ledger) is persisted in IndexerCursor, so the
 *   indexer resumes after a restart and does not reprocess applied ledgers.
 * - Unknown events are ignored; a failed event is logged and recorded in
 *   IndexerDeadLetter so it cannot block the rest of the batch *or* vanish.
 *   Because the cursor still advances, a dead letter is a permanent record of
 *   state that is missing from the DB — query it after the fact:
 *     SELECT * FROM "IndexerDeadLetter" ORDER BY "lastSeenAt" DESC;
 *   Re-run the affected event by hand once the bug is fixed, then delete the row.
 */

import { SorobanRpc } from "@stellar/stellar-sdk";
import { config } from "./config";
import { prisma } from "./db";
import {
  KNOWN_EVENTS,
  decodeEventData,
  decodeEventName,
  type ContractEventLike,
} from "./lib/events";

const CURSOR_ID = "main";
const EVENT_PAGE_LIMIT = 100;

/** Longest error message persisted to IndexerDeadLetter.error. */
const MAX_ERROR_LENGTH = 500;

const CONTRACT_IDS = [
  config.ESCROW_CONTRACT_ID,
  config.DISPUTE_CONTRACT_ID,
  config.REPUTATION_CONTRACT_ID,
].filter(Boolean);

const rpcServer = new SorobanRpc.Server(config.SOROBAN_RPC_URL, { allowHttp: false });

/** Minimal surface of `SorobanRpc.Server` the indexer needs (for testing). */
export interface SorobanEventSource {
  getEvents(request: {
    startLedger: number;
    filters: SorobanRpc.Api.EventFilter[];
    limit?: number;
  }): Promise<{ events: ContractEventLike[]; latestLedger: number }>;
}

/** Persisted indexer cursor. */
export interface CursorStore {
  get(): Promise<number>;
  set(ledger: number): Promise<void>;
}

export function startIndexer() {
  if (CONTRACT_IDS.length === 0) {
    console.warn("[indexer] No contract IDs configured — skipping.");
    return;
  }
  console.log("[indexer] Starting, polling every", config.INDEXER_POLL_INTERVAL_MS, "ms");
  void poll();
  setInterval(() => void poll(), config.INDEXER_POLL_INTERVAL_MS);
}

async function poll() {
  try {
    const row = await prisma.indexerCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID, lastLedger: 0 },
      update: {},
    });

    const cursor: CursorStore = {
      get: async () => row.lastLedger,
      set: async (ledger) => {
        await prisma.indexerCursor.update({
          where: { id: CURSOR_ID },
          data: { lastLedger: ledger },
        });
      },
    };

    await processContractEvents(rpcServer, cursor, CONTRACT_IDS);
  } catch (err) {
    console.error("[indexer] Poll error:", err);
  }
}

/**
 * Fetch and process events for the given contracts, then advance the cursor.
 *
 * `dispatch` and `onError` are injectable so the cursor/decoding/dead-letter
 * logic is testable without a chain or database.
 */
export async function processContractEvents(
  source: SorobanEventSource,
  cursor: CursorStore,
  contractIds: string[],
  dispatch: (event: ContractEventLike) => Promise<void> = dispatchEvent,
  onError: (event: ContractEventLike, error: unknown) => Promise<void> = recordDeadLetter,
): Promise<number> {
  const lastLedger = await cursor.get();
  if (contractIds.length === 0) return lastLedger;

  const filters = contractIds.map((contractId) => ({
    type: "contract" as const,
    contractIds: [contractId],
  }));

  const res = await source.getEvents({
    startLedger: lastLedger + 1,
    filters,
    limit: EVENT_PAGE_LIMIT,
  });

  for (const event of res.events) {
    try {
      await dispatch(event);
    } catch (err) {
      // One bad event must not block the rest of the batch.
      console.error(`[indexer] failed to process event ${event.id ?? "?"}`, err);
      // Recording the failure must never take the poller down with it.
      try {
        await onError(event, err);
      } catch (storeErr) {
        console.error("[indexer] could not record the failed event", storeErr);
      }
    }
  }

  // Advance only after every event in the batch has been attempted.
  const next = Math.max(lastLedger, res.latestLedger);
  await cursor.set(next);
  return next;
}

// ---------------------------------------------------------------------------
// Dead letters
// ---------------------------------------------------------------------------

/** Stable key for an event: RPC ids are stable, so a rewind re-uses the row. */
function deadLetterKey(event: ContractEventLike): string {
  return event.id ?? `ledger-${event.ledger}-${decodeEventName(event) ?? "unknown"}`;
}

/**
 * Persist an event the indexer could not apply. The cursor still advances, so
 * this row is the only trace that a state change was skipped.
 */
export async function recordDeadLetter(
  event: ContractEventLike,
  error: unknown,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_LENGTH,
  );
  const id = deadLetterKey(event);

  await prisma.indexerDeadLetter.upsert({
    where: { id },
    create: {
      id,
      ledger: event.ledger,
      eventName: decodeEventName(event),
      contractId: (event as { contractId?: string }).contractId ?? null,
      error: message,
    },
    update: {
      attempts: { increment: 1 },
      error: message,
    },
  });
}

// ---------------------------------------------------------------------------
// Dispatch + handlers
// ---------------------------------------------------------------------------

async function dispatchEvent(event: ContractEventLike): Promise<void> {
  const name = decodeEventName(event);
  if (!name || !KNOWN_EVENTS.has(name)) return; // unknown events are ignored

  const data = decodeEventData(event);
  switch (name) {
    case "created":
      await handleCreated(data);
      break;
    case "funded":
      await handleFunded(data);
      break;
    case "milestone_released":
      await handleMilestoneReleased(data);
      break;
    case "dispute_opened":
      await handleDisputeOpened(data);
      break;
    case "resolved":
    case "dispute_resolved":
      await handleResolved(data);
      break;
    case "refunded":
      await handleRefunded(data);
      break;
    case "raised":
      await handleRaised(data);
      break;
    case "rated":
      await handleRated(data);
      break;
    default:
      // milestones_updated / approved do not change indexed job state.
      break;
  }
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function asNumber(value: unknown): number | null {
  const big = asBigInt(value);
  return big === null ? null : Number(big);
}

async function handleCreated(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  if (escrowId === null) return;
  await prisma.job.updateMany({ where: { escrowId }, data: { status: "CREATED" } });
}

async function handleFunded(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  if (escrowId === null) return;
  await prisma.job.updateMany({ where: { escrowId }, data: { status: "ACTIVE" } });
}

async function handleMilestoneReleased(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  const index = asNumber(data.index);
  if (escrowId === null || index === null) return;

  const job = await prisma.job.findUnique({
    where: { escrowId },
    include: { milestones: true },
  });
  if (!job) return;

  const milestone = job.milestones.find((m) => m.index === index);
  if (!milestone) return;

  await prisma.milestone.update({
    where: { id: milestone.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });

  const allReleased = job.milestones.every(
    (m) => m.id === milestone.id || m.status === "RELEASED",
  );
  if (allReleased) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
  }
}

async function handleDisputeOpened(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  if (escrowId === null) return;
  await prisma.job.updateMany({ where: { escrowId }, data: { status: "DISPUTED" } });
}

async function handleResolved(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  if (escrowId === null) return;
  await prisma.job.updateMany({ where: { escrowId }, data: { status: "COMPLETED" } });
  await prisma.dispute.updateMany({
    where: { job: { escrowId } },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

async function handleRefunded(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  if (escrowId === null) return;
  await prisma.job.updateMany({ where: { escrowId }, data: { status: "REFUNDED" } });
}

async function handleRaised(data: Record<string, unknown>): Promise<void> {
  const escrowId = asBigInt(data.escrow_id);
  const disputeId = asBigInt(data.dispute_id);
  if (escrowId === null || disputeId === null) return;

  const job = await prisma.job.findUnique({ where: { escrowId } });
  if (!job) return;

  await prisma.dispute.upsert({
    where: { onChainId: disputeId },
    create: {
      onChainId: disputeId,
      jobId: job.id,
      raisedByAddress: String(data.raised_by ?? ""),
      reason: "",
    },
    update: {},
  });
}

async function handleRated(data: Record<string, unknown>): Promise<void> {
  // On-chain aggregates are authoritative and surfaced via the reputation
  // contract; the off-chain Rating rows are written by the API. Nothing to
  // persist from the event itself yet.
  console.log("[indexer] rated", data.escrow_id, data.ratee);
}
