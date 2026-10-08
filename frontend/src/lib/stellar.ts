/**
 * stellar.ts
 *
 * Thin wrapper around @stellar/stellar-sdk for use throughout the app.
 * All contract addresses and network config live here so contributors
 * only need to change one file when deploying to a new network.
 *
 * The Soroban transaction pipeline is:
 *   build → simulateTransaction → assembleTransaction → sign (Freighter)
 *   → sendTransaction → poll getTransaction
 *
 * Contributor Notes:
 * - VITE_ env vars are injected at build time via Vite.
 * - For testnet development copy .env.example → .env and fill in deployed
 *   addresses (scripts/deploy_testnet.sh writes this file for you).
 * - Never commit real secret keys; Freighter handles signing in the browser.
 */

import {
  Address,
  BASE_FEE,
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Network config
// ---------------------------------------------------------------------------

export type NetworkName = "testnet" | "mainnet";

const NETWORK_CONFIG = {
  testnet: {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
  },
  mainnet: {
    networkPassphrase: Networks.PUBLIC,
    rpcUrl: "https://soroban-mainnet.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
  },
} as const;

export const ACTIVE_NETWORK: NetworkName =
  (import.meta.env.VITE_NETWORK as NetworkName) ?? "testnet";

export const { networkPassphrase, rpcUrl, horizonUrl } =
  NETWORK_CONFIG[ACTIVE_NETWORK];

/** stellar.expert uses `public` (not `mainnet`) in its explorer paths. */
const EXPLORER_HOST: Record<NetworkName, string> = {
  testnet: "https://stellar.expert/explorer/testnet",
  mainnet: "https://stellar.expert/explorer/public",
};

/** Link to a transaction on stellar.expert for the active network. */
export const explorerTxUrl = (hash: string): string =>
  `${EXPLORER_HOST[ACTIVE_NETWORK]}/tx/${hash}`;

// ---------------------------------------------------------------------------
// Deployed contract addresses (set via .env)
// ---------------------------------------------------------------------------

export const CONTRACT_ADDRESSES = {
  escrow: import.meta.env.VITE_ESCROW_CONTRACT_ID ?? "",
  dispute: import.meta.env.VITE_DISPUTE_CONTRACT_ID ?? "",
  reputation: import.meta.env.VITE_REPUTATION_CONTRACT_ID ?? "",
  /** USDC issued by Circle on Stellar */
  usdc: import.meta.env.VITE_USDC_CONTRACT_ID ?? "",
} as const;

export const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

// ---------------------------------------------------------------------------
// ScVal helpers
// ---------------------------------------------------------------------------

export const scAddress = (address: string) => Address.fromString(address).toScVal();
export const scU64 = (n: bigint) => nativeToScVal(n, { type: "u64" });
export const scU32 = (n: number) => nativeToScVal(n, { type: "u32" });
export const scI128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

/** 1 unit == 1e7 stroops (USDC uses 7 decimal places on Stellar). */
export const toStroops = (units: number) => BigInt(Math.round(units * 1e7));
export const fromStroops = (stroops: bigint) => Number(stroops) / 1e7;

export interface MilestoneInput {
  amount: bigint;
  deadline: bigint;
}

/**
 * Encode a list of milestones as the `Vec<Milestone>` the contract expects.
 * Soroban structs are maps keyed by field-name symbols.
 */
export function milestonesToScVal(milestones: MilestoneInput[]): xdr.ScVal {
  const encoded = milestones.map((m) =>
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"), val: scI128(m.amount) }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("released"),
        val: xdr.ScVal.scvBool(false),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("deadline"),
        val: scU64(m.deadline),
      }),
    ]),
  );
  return xdr.ScVal.scvVec(encoded);
}

// ---------------------------------------------------------------------------
// Transaction pipeline
// ---------------------------------------------------------------------------

export interface BuiltTransaction {
  /** Assembled (footprint + resource fees applied) transaction XDR, ready to sign. */
  xdr: string;
  /** Return value of the call as a native JS value (from simulation). */
  result: unknown;
}

function simulationError(
  sim: SorobanRpc.Api.SimulateTransactionResponse,
): string | null {
  if (SorobanRpc.Api.isSimulationError(sim)) return sim.error;
  return null;
}

/**
 * Build a contract call, simulate it to get the footprint + fees, and return
 * the assembled XDR plus the simulated return value.
 */
export async function buildContractCall(
  sourcePublicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<BuiltTransaction> {
  if (!contractId) throw new Error("Contract address is not configured (.env)");

  const account = await server.getAccount(sourcePublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  const err = simulationError(sim);
  if (err) throw new Error(err);

  const success = sim as SorobanRpc.Api.SimulateTransactionSuccessResponse;
  const result = success.result?.retval ? scValToNative(success.result.retval) : undefined;
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();

  return { xdr: assembled.toXDR(), result };
}

/** Read-only call: simulate and return the decoded result, no signing. */
export async function readContract<T>(
  sourcePublicKey: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<T> {
  const { result } = await buildContractCall(sourcePublicKey, contractId, method, args);
  return result as T;
}

/** Poll until the transaction is included in a ledger. */
export async function pollTransaction(
  hash: string,
  attempts = 15,
  delayMs = 1500,
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  for (let i = 0; i < attempts; i++) {
    const res = await server.getTransaction(hash);
    if (res.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      return res;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Transaction ${hash} not confirmed after ${attempts} attempts`);
}
