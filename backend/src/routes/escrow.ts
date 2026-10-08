/**
 * escrow.ts
 *
 * These endpoints build unsigned Stellar transactions that the frontend
 * signs with Freighter and submits directly to the network.
 * The backend never holds private keys.
 *
 * POST /api/escrow/build/create          — build escrow.create() tx
 * POST /api/escrow/build/fund            — build escrow.fund() tx
 * POST /api/escrow/build/release         — build escrow.release_milestone() tx
 * POST /api/escrow/build/reclaim         — build escrow.reclaim_expired() tx
 * POST /api/escrow/sync/:jobId           — sync on-chain escrow ID to DB job record
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
} from "@stellar/stellar-sdk";
import { config } from "../config";
import { buildCreateArgs } from "../lib/escrowArgs";
import { getAsset, toBaseUnits, UnknownAssetError } from "../lib/assets";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const escrowRouter = Router();

const server = new SorobanRpc.Server(config.SOROBAN_RPC_URL);
const networkPassphrase =
  config.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

async function buildTx(sourceAddress: string, operation: any): Promise<string> {
  const account = await server.getAccount(sourceAddress);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(operation)
    .setTimeout(30)
    .build();
  const simResult = await server.simulateTransaction(tx);
  if ("error" in simResult) throw new AppError(400, `Simulation failed: ${simResult.error}`);
  return SorobanRpc.assembleTransaction(tx, simResult).build().toXDR();
}

// POST /api/escrow/build/create
const buildCreateSchema = z.object({
  jobId: z.string(),
  freelancerAddress: z.string().startsWith("G"),
  expiryTimestamp: z.number().int().positive(),
});

escrowRouter.post("/build/create", requireAuth, validate(buildCreateSchema), async (req, res, next) => {
  try {
    const { jobId, freelancerAddress, expiryTimestamp } = req.body as z.infer<typeof buildCreateSchema>;

    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { milestones: true, client: true } });
    if (!job) throw new AppError(404, "Job not found");
    if (job.client.stellarAddress !== res.locals.stellarAddress) throw new AppError(403, "Forbidden");

    // Pay in the asset the job is configured for, validated against the registry.
    let asset;
    try {
      asset = getAsset(job.asset);
    } catch (err) {
      if (err instanceof UnknownAssetError) throw new AppError(400, err.message);
      throw err;
    }
    const tokenContractId = config[asset.configKey];
    if (!tokenContractId) {
      throw new AppError(400, `No contract configured for asset ${asset.symbol}`);
    }

    const contract = new Contract(config.ESCROW_CONTRACT_ID);
    const args = buildCreateArgs({
      client: res.locals.stellarAddress,
      freelancer: freelancerAddress,
      token: tokenContractId,
      milestones: job.milestones.map((m) => ({
        amount: toBaseUnits(m.amountUsdc.toString(), asset.decimals),
        deadline: BigInt(
          m.deadline ? Math.floor(m.deadline.getTime() / 1000) : expiryTimestamp,
        ),
      })),
      expiry: BigInt(expiryTimestamp),
    });

    const xdr = await buildTx(
      res.locals.stellarAddress,
      contract.call("create", ...args),
    );

    res.json({ xdr });
  } catch (err) {
    next(err);
  }
});

// POST /api/escrow/build/fund
escrowRouter.post("/build/fund", requireAuth, validate(z.object({ escrowId: z.number() })), async (req, res, next) => {
  try {
    const contract = new Contract(config.ESCROW_CONTRACT_ID);
    const xdr = await buildTx(
      res.locals.stellarAddress,
      contract.call("fund", nativeToScVal(BigInt(req.body.escrowId))),
    );
    res.json({ xdr });
  } catch (err) {
    next(err);
  }
});

// POST /api/escrow/build/release
const releaseSchema = z.object({ escrowId: z.number(), milestoneIndex: z.number().int().min(0) });

escrowRouter.post("/build/release", requireAuth, validate(releaseSchema), async (req, res, next) => {
  try {
    const { escrowId, milestoneIndex } = req.body as z.infer<typeof releaseSchema>;
    const contract = new Contract(config.ESCROW_CONTRACT_ID);
    const xdr = await buildTx(
      res.locals.stellarAddress,
      contract.call("release_milestone", nativeToScVal(BigInt(escrowId)), nativeToScVal(milestoneIndex)),
    );
    res.json({ xdr });
  } catch (err) {
    next(err);
  }
});

// POST /api/escrow/build/reclaim
escrowRouter.post("/build/reclaim", requireAuth, validate(z.object({ escrowId: z.number() })), async (req, res, next) => {
  try {
    const contract = new Contract(config.ESCROW_CONTRACT_ID);
    const xdr = await buildTx(
      res.locals.stellarAddress,
      contract.call("reclaim_expired", nativeToScVal(BigInt(req.body.escrowId))),
    );
    res.json({ xdr });
  } catch (err) {
    next(err);
  }
});

// POST /api/escrow/sync/:jobId — called by frontend after tx confirmed
const syncSchema = z.object({ escrowId: z.number() });

escrowRouter.post("/sync/:jobId", requireAuth, validate(syncSchema), async (req, res, next) => {
  try {
    const job = await prisma.job.update({
      where: { id: req.params.jobId },
      data: { escrowId: BigInt(req.body.escrowId), status: "FUNDED" },
    });
    res.json(job);
  } catch (err) {
    next(err);
  }
});
