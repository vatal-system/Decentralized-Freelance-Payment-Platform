/**
 * indexer.ts
 *
 * Polls Horizon for Soroban contract events emitted by the escrow, dispute,
 * and reputation contracts, then syncs state into the PostgreSQL database.
 *
 * This keeps the DB in sync without requiring the frontend to call /sync
 * endpoints manually after every transaction.
 *
 * Events handled:
 *   escrow    — funded, milestone_released, dispute_opened, resolved, refunded
 *   dispute   — raised, resolved
 *   reputation — rating_submitted
 *
 * Contributor Notes:
 * - The cursor (last processed ledger) is persisted in IndexerCursor so the
 *   indexer resumes correctly after a restart.
 * - TODO: replace polling with Horizon SSE stream for lower latency.
 * - TODO: add dead-letter queue for failed event processing.
 */

import { Horizon } from "@stellar/stellar-sdk";
import { config } from "./config";
import { prisma } from "./db";

const horizon = new Horizon.Server(config.HORIZON_URL);

const CONTRACT_IDS = [
  config.ESCROW_CONTRACT_ID,
  config.DISPUTE_CONTRACT_ID,
  config.REPUTATION_CONTRACT_ID,
].filter(Boolean);

const CURSOR_ID = "main";

export function startIndexer() {
  if (CONTRACT_IDS.length === 0) {
    console.warn("[indexer] No contract IDs configured — skipping.");
    return;
  }
  console.log("[indexer] Starting, polling every", config.INDEXER_POLL_INTERVAL_MS, "ms");
  poll();
  setInterval(poll, config.INDEXER_POLL_INTERVAL_MS);
}

async function poll() {
  try {
    const cursor = await prisma.indexerCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID, lastLedger: 0 },
      update: {},
    });

    // Fetch contract events from Horizon starting after last processed ledger
    // Horizon /effects or /transactions filtered by contract — use getContractEvents via RPC
    // TODO: switch to SorobanRpc.Server.getEvents() for proper event filtering
    // For now we iterate recent transactions on each contract address as a placeholder.

    for (const contractId of CONTRACT_IDS) {
      await processContractEvents(contractId, cursor.lastLedger);
    }
  } catch (err) {
    console.error("[indexer] Poll error:", err);
  }
}

async function processContractEvents(contractId: string, afterLedger: number) {
  // TODO: use SorobanRpc.Server.getEvents({ startLedger, filters: [{ contractIds: [contractId] }] })
  // and process each event by its topic[0] (event name).
  //
  // Example event processing skeleton:
  //
  // const events = await rpcServer.getEvents({ startLedger: afterLedger + 1, filters: [...] });
  // for (const event of events.events) {
  //   const name = scValToNative(event.topic[0]) as string;
  //   switch (name) {
  //     case "funded":          await handleFunded(event); break;
  //     case "milestone_released": await handleMilestoneReleased(event); break;
  //     case "dispute_opened":  await handleDisputeOpened(event); break;
  //     case "resolved":        await handleResolved(event); break;
  //     case "refunded":        await handleRefunded(event); break;
  //     case "rating_submitted": await handleRatingSubmitted(event); break;
  //   }
  //   await prisma.indexerCursor.update({ where: { id: CURSOR_ID }, data: { lastLedger: event.ledger } });
  // }
}

// ---------------------------------------------------------------------------
// Event handlers — update DB to mirror on-chain state
// ---------------------------------------------------------------------------

async function handleFunded(escrowId: bigint) {
  await prisma.job.updateMany({
    where: { escrowId },
    data: { status: "ACTIVE" },
  });
}

async function handleMilestoneReleased(escrowId: bigint, milestoneIndex: number) {
  const job = await prisma.job.findUnique({ where: { escrowId }, include: { milestones: true } });
  if (!job) return;

  const milestone = job.milestones.find((m) => m.index === milestoneIndex);
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

async function handleDisputeOpened(escrowId: bigint) {
  await prisma.job.updateMany({
    where: { escrowId },
    data: { status: "DISPUTED" },
  });
}

async function handleResolved(escrowId: bigint) {
  await prisma.job.updateMany({
    where: { escrowId },
    data: { status: "COMPLETED" },
  });
  await prisma.dispute.updateMany({
    where: { job: { escrowId } },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

async function handleRefunded(escrowId: bigint) {
  await prisma.job.updateMany({
    where: { escrowId },
    data: { status: "REFUNDED" },
  });
}
