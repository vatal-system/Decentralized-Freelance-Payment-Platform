/**
 * useEscrow.ts
 *
 * React hook that wraps all escrow / reputation contract interactions.
 *
 * Every write follows the same pipeline (see lib/stellar.ts):
 *   build → simulate → assemble → sign (Freighter) → submit → poll
 * Reads are signed-free: build → simulate → decode the return value.
 *
 * Contributor Notes:
 * - Amounts are i128 stroops (7 decimals). Use `toStroops`/`fromStroops`.
 * - `createAndFund` runs two transactions (create then fund) because the
 *   contracts keep them separate on purpose.
 */

import { useCallback, useState } from "react";
import { TransactionBuilder, SorobanRpc, xdr } from "@stellar/stellar-sdk";
import {
  CONTRACT_ADDRESSES,
  buildContractCall,
  milestonesToScVal,
  networkPassphrase,
  pollTransaction,
  readContract,
  scAddress,
  scU32,
  scU64,
  server,
  type MilestoneInput,
} from "../lib/stellar";
import { friendlyError } from "../lib/errors";
import { useWallet } from "./wallet-context";

export interface MilestoneView {
  amount: bigint;
  released: boolean;
  deadline: bigint;
}

export interface EscrowView {
  client: string;
  freelancer: string;
  token: string;
  total_amount: bigint;
  milestones: MilestoneView[];
  status: string;
  created_at: bigint;
  expiry: bigint;
}

export interface ReputationView {
  total_score: bigint;
  count: bigint;
}

/** A submitted transaction's hash plus its decoded return value. */
export interface SubmitResult {
  hash: string;
  result: unknown;
}

/** Result of `createAndFund`; `hash` is the (last) `fund` transaction. */
export interface CreateAndFundResult {
  id: bigint;
  hash: string;
}

export function useEscrow() {
  const { publicKey, connect, sign } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withKey = useCallback(
    async <T,>(fn: (pk: string) => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);
      try {
        const pk = publicKey ?? (await connect());
        if (!pk) throw new Error("Wallet not connected");
        return await fn(pk);
      } catch (e) {
        setError(friendlyError(e));
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, connect],
  );

  /**
   * Submit a state-changing contract call. Returns the transaction hash and the
   * decoded return value so callers can link to the explorer.
   */
  const submit = useCallback(
    async (
      pk: string,
      contractId: string,
      method: string,
      args: xdr.ScVal[],
    ): Promise<SubmitResult> => {
      const built = await buildContractCall(pk, contractId, method, args);
      const signed = await sign(built.xdr);
      const tx = TransactionBuilder.fromXDR(signed, networkPassphrase);
      const sent = await server.sendTransaction(tx);
      if (sent.status === "ERROR") {
        throw new Error(`Transaction rejected: ${JSON.stringify(sent.errorResult)}`);
      }
      const receipt = await pollTransaction(sent.hash);
      if (receipt.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`Transaction ${sent.hash} failed (${receipt.status})`);
      }
      // The return value does not survive submission, so use the simulated one.
      return { hash: sent.hash, result: built.result };
    },
    [sign],
  );

  /** Create an escrow and immediately fund it. Returns the id and the fund hash. */
  const createAndFund = useCallback(
    (freelancer: string, milestones: MilestoneInput[], expiry: bigint) =>
      withKey(async (pk): Promise<CreateAndFundResult> => {
        const escrow = CONTRACT_ADDRESSES.escrow;
        const created = await submit(pk, escrow, "create", [
          scAddress(pk),
          scAddress(freelancer),
          scAddress(CONTRACT_ADDRESSES.usdc),
          milestonesToScVal(milestones),
          scU64(expiry),
        ]);
        const id = BigInt(created.result as bigint | number | string);
        const funded = await submit(pk, escrow, "fund", [scU64(id)]);
        return { id, hash: funded.hash };
      }),
    [submit, withKey],
  );

  /** Client releases a milestone to the freelancer. */
  const releaseMilestone = useCallback(
    (escrowId: bigint, milestoneIndex: number) =>
      withKey((pk) =>
        submit(pk, CONTRACT_ADDRESSES.escrow, "release_milestone", [
          scU64(escrowId),
          scU32(milestoneIndex),
        ]),
      ),
    [submit, withKey],
  );

  /** Either party freezes the escrow by opening a dispute. */
  const openDispute = useCallback(
    (escrowId: bigint) =>
      withKey((pk) =>
        submit(pk, CONTRACT_ADDRESSES.escrow, "open_dispute", [
          scU64(escrowId),
          scAddress(pk),
        ]),
      ),
    [submit, withKey],
  );

  /** Read a single escrow (view). */
  const getEscrow = useCallback(
    (escrowId: bigint) =>
      withKey((pk) =>
        readContract<EscrowView>(pk, CONTRACT_ADDRESSES.escrow, "get", [scU64(escrowId)]),
      ),
    [withKey],
  );

  /** Read a user's reputation aggregate (view). */
  const getReputation = useCallback(
    (address: string) =>
      withKey((pk) =>
        readContract<ReputationView>(pk, CONTRACT_ADDRESSES.reputation, "get_aggregate", [
          scAddress(address),
        ]),
      ),
    [withKey],
  );

  return {
    createAndFund,
    releaseMilestone,
    openDispute,
    getEscrow,
    getReputation,
    loading,
    error,
  };
}
