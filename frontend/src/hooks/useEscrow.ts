/**
 * useEscrow.ts
 *
 * React hook that wraps all escrow contract interactions.
 * Uses Freighter browser wallet for transaction signing.
 *
 * Contributor Notes:
 * - Each function follows: build tx → simulate → sign (Freighter) → submit → poll.
 * - TODO: replace manual XDR building with auto-generated contract bindings
 *   once `stellar contract bindings typescript` is run post-deployment.
 */

import { useState } from "react";
import { CONTRACT_ADDRESSES, networkPassphrase, server } from "../lib/stellar";
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
} from "@stellar/stellar-sdk";

// Freighter types (installed separately via @stellar/freighter-api)
declare global {
  interface Window {
    freighter?: {
      getPublicKey(): Promise<string>;
      signTransaction(xdr: string, opts: { networkPassphrase: string }): Promise<string>;
    };
  }
}

// ---------------------------------------------------------------------------
// Types mirroring the contract data structures
// ---------------------------------------------------------------------------

export interface Milestone {
  amount: bigint;
  released: boolean;
  deadline: bigint;
}

export interface EscrowData {
  client: string;
  freelancer: string;
  token: string;
  totalAmount: bigint;
  milestones: Milestone[];
  status: string;
  createdAt: bigint;
  expiry: bigint;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEscrow() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contract = new Contract(CONTRACT_ADDRESSES.escrow);

  async function getPublicKey(): Promise<string> {
    if (!window.freighter) throw new Error("Freighter wallet not installed");
    return window.freighter.getPublicKey();
  }

  async function signAndSubmit(xdr: string): Promise<string> {
    if (!window.freighter) throw new Error("Freighter wallet not installed");
    const signed = await window.freighter.signTransaction(xdr, { networkPassphrase });
    const result = await server.sendTransaction(
      // @ts-expect-error – TransactionEnvelope from string
      signed,
    );
    return result.hash;
  }

  /**
   * Create a new escrow job on-chain.
   * Returns the new escrow ID.
   */
  async function createEscrow(
    freelancer: string,
    milestones: Pick<Milestone, "amount" | "deadline">[],
    expiryTimestamp: bigint,
  ): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const publicKey = await getPublicKey();
      const account = await server.getAccount(publicKey);

      // TODO: replace with generated bindings
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(
          contract.call(
            "create",
            Address.fromString(publicKey).toScVal(),
            Address.fromString(freelancer).toScVal(),
            Address.fromString(CONTRACT_ADDRESSES.usdc).toScVal(),
            nativeToScVal(milestones),
            nativeToScVal(expiryTimestamp),
          ),
        )
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);
      if ("error" in simResult) throw new Error(simResult.error);

      await signAndSubmit(tx.toXDR());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Release a specific milestone to the freelancer.
   */
  async function releaseMilestone(escrowId: bigint, milestoneIndex: number): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const publicKey = await getPublicKey();
      const account = await server.getAccount(publicKey);

      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(
          contract.call(
            "release_milestone",
            nativeToScVal(escrowId),
            nativeToScVal(milestoneIndex),
          ),
        )
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);
      if ("error" in simResult) throw new Error(simResult.error);

      await signAndSubmit(tx.toXDR());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return { createEscrow, releaseMilestone, loading, error };
}
