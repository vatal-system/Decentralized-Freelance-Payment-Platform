/**
 * users.ts
 *
 * POST /api/users/auth   — issue JWT after verifying a signed Stellar challenge
 * GET  /api/users/:addr  — get public profile
 * PUT  /api/users/me     — update display name / bio (auth required)
 *
 * Auth flow (challenge-response):
 *   1. Client calls GET /api/users/challenge?address=G...
 *   2. Server returns a random nonce.
 *   3. Client signs nonce with Freighter (Stellar keypair).
 *   4. Client posts { address, signature, nonce } to /api/users/auth.
 *   5. Server verifies signature with stellar-sdk, issues JWT.
 *
 * TODO: implement nonce storage (Redis or DB) with TTL to prevent replay attacks.
 */

import { Router } from "express";
import { z } from "zod";
import { SignedXdr, Keypair } from "@stellar/stellar-sdk";
import { SigningError } from "@stellar/stellar-sdk/lib/errors";
import { SignJWT } from "jose";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";

export const usersRouter = Router();

const secret = new TextEncoder().encode(config.JWT_SECRET);

// In-memory nonce store (replace with Redis in production)
const nonces = new Map<string, { nonce: string; expiresAt: number }>();

// GET /api/users/challenge?address=G...
usersRouter.get("/challenge", (req, res) => {
  const address = String(req.query.address ?? "");
  if (!address.startsWith("G")) throw new AppError(400, "Invalid Stellar address");

  const nonce = crypto.randomUUID();
  nonces.set(address, { nonce, expiresAt: Date.now() + 60_000 });
  res.json({ nonce });
});

// POST /api/users/auth
const authSchema = z.object({
  address: z.string().startsWith("G"),
  /** Base64-encoded signature of the nonce */
  signature: z.string(),
  nonce: z.string(),
});

usersRouter.post("/auth", validate(authSchema), async (req, res, next) => {
  try {
    const { address, signature, nonce } = req.body as z.infer<typeof authSchema>;

    const stored = nonces.get(address);
    if (!stored || stored.nonce !== nonce || Date.now() > stored.expiresAt) {
      throw new AppError(401, "Invalid or expired nonce");
    }
    nonces.delete(address);

    // Verify the signature
    const keypair = Keypair.fromPublicKey(address);
    const valid = keypair.verify(Buffer.from(nonce), Buffer.from(signature, "base64"));
    if (!valid) throw new AppError(401, "Signature verification failed");

    // Upsert user
    const user = await prisma.user.upsert({
      where: { stellarAddress: address },
      create: { stellarAddress: address },
      update: {},
    });

    const token = await new SignJWT({ sub: address })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .sign(secret);

    res.json({ token, user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:address
usersRouter.get("/:address", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { stellarAddress: req.params.address },
      include: { _count: { select: { jobsAsFreelancer: true, jobsAsClient: true } } },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/me
const updateSchema = z.object({
  displayName: z.string().max(80).optional(),
  bio: z.string().max(500).optional(),
});

usersRouter.put("/me", requireAuth, validate(updateSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { stellarAddress: res.locals.stellarAddress },
      data: req.body,
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
});
