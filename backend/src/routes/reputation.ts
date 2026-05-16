/**
 * reputation.ts
 *
 * POST /api/reputation          — submit a rating (builds reputation.submit tx)
 * GET  /api/reputation/:address — get aggregate score for an address
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
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const reputationRouter = Router();

const server = new SorobanRpc.Server(config.SOROBAN_RPC_URL);
const networkPassphrase =
  config.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

// POST /api/reputation
const submitSchema = z.object({
  jobId: z.string(),
  rateeAddress: z.string().startsWith("G"),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

reputationRouter.post("/", requireAuth, validate(submitSchema), async (req, res, next) => {
  try {
    const { jobId, rateeAddress, score, comment } = req.body as z.infer<typeof submitSchema>;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { client: true, freelancer: true },
    });
    if (!job) throw new AppError(404, "Job not found");
    if (job.status !== "COMPLETED") throw new AppError(400, "Job is not completed");
    if (!job.escrowId) throw new AppError(400, "No on-chain escrow for this job");

    const raterAddress = res.locals.stellarAddress;
    const ratee = await prisma.user.findUnique({ where: { stellarAddress: rateeAddress } });
    const rater = await prisma.user.findUnique({ where: { stellarAddress: raterAddress } });
    if (!ratee || !rater) throw new AppError(404, "User not found");

    // Build reputation.submit tx
    const contract = new Contract(config.REPUTATION_CONTRACT_ID);
    const account = await server.getAccount(raterAddress);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(
        contract.call(
          "submit",
          Address.fromString(raterAddress).toScVal(),
          Address.fromString(rateeAddress).toScVal(),
          nativeToScVal(job.escrowId),
          nativeToScVal(score),
        ),
      )
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if ("error" in sim) throw new AppError(400, `Simulation failed: ${sim.error}`);
    const xdr = SorobanRpc.assembleTransaction(tx, sim).build().toXDR();

    // Persist off-chain (on-chain record is source of truth; this is for fast reads)
    const rating = await prisma.rating.create({
      data: { jobId, raterId: rater.id, rateeId: ratee.id, score, comment },
    });

    res.status(201).json({ rating, xdr });
  } catch (err) {
    next(err);
  }
});

// GET /api/reputation/:address
reputationRouter.get("/:address", async (req, res, next) => {
  try {
    const result = await prisma.rating.aggregate({
      where: { ratee: { stellarAddress: req.params.address } },
      _avg: { score: true },
      _count: { score: true },
    });
    res.json({
      address: req.params.address,
      averageScore: result._avg.score ?? 0,
      totalRatings: result._count.score,
    });
  } catch (err) {
    next(err);
  }
});
