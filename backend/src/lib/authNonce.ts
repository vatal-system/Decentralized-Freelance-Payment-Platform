/**
 * authNonce.ts
 *
 * Single-use, DB-backed challenge nonces for wallet auth.
 *
 * A nonce is stored per address with a short expiry. `consumeNonce` validates it
 * against the stored row and deletes it, so a captured nonce cannot be replayed
 * and a restart/other instance does not lose outstanding challenges.
 *
 * Kept behind a narrow `AuthNonceStore` interface so the logic is unit-testable
 * without a database; `prisma.authNonce` structurally satisfies it.
 */

import { randomUUID } from "node:crypto";

/** Challenge/nonce lifetime. */
export const NONCE_TTL_MS = 60_000;

export interface AuthNonceRow {
  address: string;
  nonce: string;
  expiresAt: Date;
}

/** The subset of `prisma.authNonce` this module uses. */
export interface AuthNonceStore {
  upsert(args: {
    where: { address: string };
    create: AuthNonceRow;
    update: { nonce: string; expiresAt: Date };
  }): Promise<unknown>;
  findUnique(args: { where: { address: string } }): Promise<AuthNonceRow | null>;
  delete(args: { where: { address: string } }): Promise<unknown>;
  deleteMany(args: { where: { expiresAt: { lt: Date } } }): Promise<unknown>;
}

/**
 * Issue (or replace) a nonce for `address`, expiring after `NONCE_TTL_MS`.
 * Expired rows are pruned opportunistically on each call.
 */
export async function issueNonce(
  db: AuthNonceStore,
  address: string,
  now: Date = new Date(),
): Promise<string> {
  const nonce = randomUUID();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);

  await db.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.upsert({
    where: { address },
    create: { address, nonce, expiresAt },
    update: { nonce, expiresAt },
  });

  return nonce;
}

/**
 * Validate `nonce` for `address` against the stored row and delete it on success
 * (single use). Returns `false` for a missing, mismatched, or expired nonce.
 */
export async function consumeNonce(
  db: AuthNonceStore,
  address: string,
  nonce: string,
  now: Date = new Date(),
): Promise<boolean> {
  const stored = await db.findUnique({ where: { address } });
  if (!stored) return false;
  if (stored.nonce !== nonce) return false;
  if (stored.expiresAt.getTime() < now.getTime()) return false;

  await db.delete({ where: { address } });
  return true;
}
