/**
 * disputes.ts
 *
 * POST /api/disputes              — raise a dispute (builds open_dispute tx)
 * GET  /api/disputes/:id          — get dispute details
 * POST /api/disputes/:id/resolve  — arbitrator resolves (builds arbitrate tx)
 *
 * Authorization: `/:id/resolve` may only be called by an address listed in
 * `ARBITRATOR_ADDRESSES`. The on-chain dispute contract is still the final
 * authority (it checks panel membership inside `arbitrate`), but the route also
 * writes DB state before the transaction is confirmed, so it must not be
 * reachable by a non-arbitrator.
 */

import { Router } from "express";
import { z } from "zod";
import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";
import { config } from "../config";
import { prisma } from "../db";
import { isListed, parseList } from "../lib/access";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const disputesRouter = Router();

const server = new SorobanRpc.Server(config.SOROBAN_RPC_URL);
const networkPassphrase =
  config.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

async function buildTx(sourceAddress: string, operation: any): Promise<string> {
  const account = await server.getAccount(sourceAddress);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(operation)
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new AppError(400, `Simulation failed: ${sim.error}`);
  return SorobanRpc.assembleTransaction(tx, sim).build().toXDR();
}

// POST /api/disputes
const raiseSchema = z.object({
  jobId: z.string(),
  reason: z.string().min(10).max(1000),
});

disputesRouter.post("/", requireAuth, validate(raiseSchema), async (req, res, next) => {
  try {
    const { jobId, reason } = req.body as z.infer<typeof raiseSchema>;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });
    if (!job) throw new AppError(404, "Job not found");
    if (!job.escrowId) throw new AppError(400, "Job has no on-chain escrow yet");

    const addr = res.locals.stellarAddress;
    const isParticipant =
      job.client.stellarAddress === addr || job.freelancer?.stellarAddress === addr;
    if (!isParticipant) throw new AppError(403, "Not a participant of this job");

    // Build escrow.open_dispute tx for frontend to sign
    const escrowContract = new Contract(config.ESCROW_CONTRACT_ID);
    const xdr = await buildTx(
      addr,
      escrowContract.call(
        "open_dispute",
        nativeToScVal(job.escrowId),
        Address.fromString(addr).toScVal(),
      ),
    );

    // Persist dispute record
    const dispute = await prisma.dispute.create({
      data: { jobId, raisedByAddress: addr, reason },
    });

    res.status(201).json({ dispute, xdr });
  } catch (err) {
    next(err);
  }
});

// GET /api/disputes/:id
disputesRouter.get("/:id", async (req, res, next) => {
  try {
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: { job: true },
    });
    if (!dispute) throw new AppError(404, "Dispute not found");
    res.json(dispute);
  } catch (err) {
    next(err);
  }
});

// POST /api/disputes/:id/resolve  (arbitrator only)
const resolveSchema = z.object({
  clientShare: z.number().min(0),
  freelancerShare: z.number().min(0),
});

disputesRouter.post("/:id/resolve", requireAuth, validate(resolveSchema), async (req, res, next) => {
  try {
    const { clientShare, freelancerShare } = req.body as z.infer<typeof resolveSchema>;

    // Fail closed: an unconfigured allowlist grants nobody access.
    const arbitrators = parseList(config.ARBITRATOR_ADDRESSES);
    if (arbitrators.length === 0) {
      throw new AppError(
        503,
        "Dispute resolution is unavailable: no ARBITRATOR_ADDRESSES configured",
      );
    }
    if (!isListed(res.locals.stellarAddress, arbitrators)) {
      throw new AppError(403, "Only a configured arbitrator can resolve a dispute");
    }

    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: { job: true },
    });
    if (!dispute) throw new AppError(404, "Dispute not found");
    if (!dispute.onChainId) throw new AppError(400, "Dispute not yet on-chain");

    // Build dispute.arbitrate tx
    const disputeContract = new Contract(config.DISPUTE_CONTRACT_ID);
    const xdr = await buildTx(
      res.locals.stellarAddress,
      disputeContract.call(
        "arbitrate",
        nativeToScVal(dispute.onChainId),
        nativeToScVal(BigInt(Math.round(clientShare * 1e7))),
        nativeToScVal(BigInt(Math.round(freelancerShare * 1e7))),
      ),
    );

    // Update DB (final status set by indexer after tx confirmed)
    await prisma.dispute.update({
      where: { id: req.params.id },
      data: { status: "UNDER_REVIEW", clientShare, freelancerShare },
    });

    res.json({ xdr });
  } catch (err) {
    next(err);
  }
});
