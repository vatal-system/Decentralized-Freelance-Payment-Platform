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
 * - In-flight operations are tracked per target (kind + key), so unrelated
 *   buttons stay enabled and a target cannot be submitted twice.
 */

import { useCallback, useRef, useState } from "react";
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
  released_amount: bigint;
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
  /** Weight-summed score; average = total_score / weight. */
  total_score: bigint;
  /** Sum of the weights (escrow amounts) behind the counted ratings. */
  weight: bigint;
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

/** The kinds of operation the hook can have in flight. */
export type OpKind = "create" | "release" | "dispute" | "read" | "reputation";

const WRITE_KINDS: OpKind[] = ["create", "release", "dispute"];

export function useEscrow() {
  const { publicKey, connect, sign } = useWallet();
  const [pendingOps, setPendingOps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Source of truth for in-flight ops; the state mirrors it for rendering, and
  // the ref stays current inside async callbacks (e.g. the poll in JobDetail).
  const pendingRef = useRef<Set<string>>(new Set());

  const syncPending = useCallback(() => {
    setPendingOps([...pendingRef.current]);
  }, []);

  /** Run an operation, guarding against a duplicate start for the same target. */
  const run = useCallback(
    async <T>(
      kind: OpKind,
      key: string,
      fn: (pk: string) => Promise<T>,
    ): Promise<T | undefined> => {
      const id = `${kind}:${key}`;
      if (pendingRef.current.has(id)) return undefined; // double-submit guard

      pendingRef.current.add(id);
      syncPending();
      setError(null);
      try {
        const pk = publicKey ?? (await connect());
        if (!pk) throw new Error("Wallet not connected");
        return await fn(pk);
      } catch (e) {
        setError(friendlyError(e));
        return undefined;
      } finally {
        pendingRef.current.delete(id);
        syncPending();
      }
    },
    [publicKey, connect, syncPending],
  );

  /** Is an operation in flight? Narrow by `kind` and/or exact `key`. */
  const isPending = useCallback(
    (kind?: OpKind, key?: string) => {
      if (!kind) return pendingOps.length > 0;
      if (key === undefined) return pendingOps.some((id) => id.startsWith(`${kind}:`));
      return pendingOps.includes(`${kind}:${key}`);
    },
    [pendingOps],
  );

  /** Is any state-changing write pending? Used to pause background polling. */
  const hasPendingWrite = useCallback(
    () => [...pendingRef.current].some((id) => WRITE_KINDS.some((k) => id.startsWith(`${k}:`))),
    [],
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

  /**
   * Create an escrow and immediately fund it, paying in `token` (a SAC address).
   * Returns the id and the fund hash.
   */
  const createAndFund = useCallback(
    (freelancer: string, token: string, milestones: MilestoneInput[], expiry: bigint) =>
      run("create", freelancer, async (pk): Promise<CreateAndFundResult> => {
        const escrow = CONTRACT_ADDRESSES.escrow;
        const created = await submit(pk, escrow, "create", [
          scAddress(pk),
          scAddress(freelancer),
          scAddress(token),
          milestonesToScVal(milestones),
          scU64(expiry),
        ]);
        const id = BigInt(created.result as bigint | number | string);
        const funded = await submit(pk, escrow, "fund", [scU64(id)]);
        return { id, hash: funded.hash };
      }),
    [run, submit],
  );

  /** Client releases a milestone to the freelancer. */
  const releaseMilestone = useCallback(
    (escrowId: bigint, milestoneIndex: number) =>
      run("release", `${escrowId}:${milestoneIndex}`, (pk) =>
        submit(pk, CONTRACT_ADDRESSES.escrow, "release_milestone", [
          scU64(escrowId),
          scU32(milestoneIndex),
        ]),
      ),
    [run, submit],
  );

  /** Either party freezes the escrow by opening a dispute. */
  const openDispute = useCallback(
    (escrowId: bigint) =>
      run("dispute", `${escrowId}`, (pk) =>
        submit(pk, CONTRACT_ADDRESSES.escrow, "open_dispute", [
          scU64(escrowId),
          scAddress(pk),
        ]),
      ),
    [run, submit],
  );

  /** Read a single escrow (view). */
  const getEscrow = useCallback(
    (escrowId: bigint) =>
      run("read", `${escrowId}`, (pk) =>
        readContract<EscrowView>(pk, CONTRACT_ADDRESSES.escrow, "get", [scU64(escrowId)]),
      ),
    [run],
  );

  /** Read a user's reputation aggregate (view). */
  const getReputation = useCallback(
    (address: string) =>
      run("reputation", address, (pk) =>
        readContract<ReputationView>(pk, CONTRACT_ADDRESSES.reputation, "get_aggregate", [
          scAddress(address),
        ]),
      ),
    [run],
  );

  return {
    createAndFund,
    releaseMilestone,
    openDispute,
    getEscrow,
    getReputation,
    pendingOps,
    isPending,
    hasPendingWrite,
    error,
  };
}
