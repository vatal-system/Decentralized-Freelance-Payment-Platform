import { describe, it, expect } from "vitest";
import {
  consumeNonce,
  issueNonce,
  NONCE_TTL_MS,
  type AuthNonceRow,
  type AuthNonceStore,
} from "../lib/authNonce";

/** In-memory stand-in for `prisma.authNonce`. */
class FakeNonceStore implements AuthNonceStore {
  rows = new Map<string, AuthNonceRow>();

  async upsert(args: {
    where: { address: string };
    create: AuthNonceRow;
    update: { nonce: string; expiresAt: Date };
  }): Promise<unknown> {
    this.rows.set(args.create.address, { ...args.create });
    return undefined;
  }

  async findUnique(args: { where: { address: string } }): Promise<AuthNonceRow | null> {
    return this.rows.get(args.where.address) ?? null;
  }

  async delete(args: { where: { address: string } }): Promise<unknown> {
    this.rows.delete(args.where.address);
    return undefined;
  }

  async deleteMany(args: { where: { expiresAt: { lt: Date } } }): Promise<unknown> {
    for (const [address, row] of this.rows) {
      if (row.expiresAt.getTime() < args.where.expiresAt.lt.getTime()) {
        this.rows.delete(address);
      }
    }
    return undefined;
  }
}

const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const OTHER = "GBVCHN3CR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

describe("auth nonces", () => {
  it("accepts a freshly issued nonce (valid flow)", async () => {
    const db = new FakeNonceStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const nonce = await issueNonce(db, ADDRESS, now);

    expect(await consumeNonce(db, ADDRESS, nonce, now)).toBe(true);
  });

  it("rejects replay of an already-used nonce", async () => {
    const db = new FakeNonceStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const nonce = await issueNonce(db, ADDRESS, now);

    expect(await consumeNonce(db, ADDRESS, nonce, now)).toBe(true);
    // Single use: the row was deleted, so the same nonce cannot be replayed.
    expect(await consumeNonce(db, ADDRESS, nonce, now)).toBe(false);
  });

  it("rejects an expired nonce", async () => {
    const db = new FakeNonceStore();
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const nonce = await issueNonce(db, ADDRESS, issuedAt);

    const later = new Date(issuedAt.getTime() + NONCE_TTL_MS + 1);
    expect(await consumeNonce(db, ADDRESS, nonce, later)).toBe(false);
  });

  it("rejects a nonce issued for a different address", async () => {
    const db = new FakeNonceStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const nonce = await issueNonce(db, ADDRESS, now);

    expect(await consumeNonce(db, OTHER, nonce, now)).toBe(false);
  });

  it("prunes expired nonces opportunistically", async () => {
    const db = new FakeNonceStore();
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    await issueNonce(db, ADDRESS, issuedAt);

    const later = new Date(issuedAt.getTime() + NONCE_TTL_MS + 1);
    await issueNonce(db, OTHER, later);

    expect(db.rows.has(ADDRESS)).toBe(false);
    expect(db.rows.has(OTHER)).toBe(true);
  });
});
