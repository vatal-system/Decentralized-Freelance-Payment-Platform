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
 * Nonces are stored in the database (single-use, 60s TTL) so they survive
 * restarts and work across instances.
 */

import { Router } from "express";
import { z } from "zod";
import { SignJWT } from "jose";
import { prisma } from "../db";
import { config } from "../config";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { AppError } from "../middleware/errorHandler";
import { consumeNonce, issueNonce, type AuthNonceStore } from "../lib/authNonce";
import { verifySignedMessage } from "../lib/signature";

export const usersRouter = Router();

const secret = new TextEncoder().encode(config.JWT_SECRET);

// `prisma.authNonce` structurally satisfies the store interface.
const nonceStore = prisma.authNonce as unknown as AuthNonceStore;

// GET /api/users/challenge?address=G...
usersRouter.get("/challenge", async (req, res, next) => {
  try {
    const address = String(req.query.address ?? "");
    if (!address.startsWith("G")) throw new AppError(400, "Invalid Stellar address");

    const nonce = await issueNonce(nonceStore, address);
    res.json({ nonce });
  } catch (err) {
    next(err);
  }
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

    // Single use: consuming deletes the stored nonce on a match.
    const consumed = await consumeNonce(nonceStore, address, nonce);
    if (!consumed) throw new AppError(401, "Invalid or expired nonce");

    // Verify the SEP-53 signature the wallet produced over the nonce.
    if (!verifySignedMessage(address, nonce, signature)) {
      throw new AppError(401, "Signature verification failed");
    }

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
