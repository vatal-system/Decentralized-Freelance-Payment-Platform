/**
 * stellar.ts
 *
 * Thin wrapper around @stellar/stellar-sdk for use throughout the app.
 * All contract addresses and network config live here so contributors
 * only need to change one file when deploying to a new network.
 *
 * Contributor Notes:
 * - VITE_ env vars are injected at build time via Vite.
 * - For testnet development copy .env.example → .env and fill in deployed addresses.
 * - Never commit real secret keys; use Freighter wallet for signing in the browser.
 */

import { Contract, Networks, SorobanRpc, TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";

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
    rpcUrl: "https://soroban-mainnet.stellar.org", // TODO: replace with preferred RPC provider
    horizonUrl: "https://horizon.stellar.org",
  },
} as const;

export const ACTIVE_NETWORK: NetworkName =
  (import.meta.env.VITE_NETWORK as NetworkName) ?? "testnet";

export const { networkPassphrase, rpcUrl, horizonUrl } =
  NETWORK_CONFIG[ACTIVE_NETWORK];

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

// ---------------------------------------------------------------------------
// RPC server singleton
// ---------------------------------------------------------------------------

export const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

// ---------------------------------------------------------------------------
// Helper: build + simulate a read-only call (no signing needed)
// ---------------------------------------------------------------------------

export async function simulateContractCall(
  sourcePublicKey: string,
  contractId: string,
  method: string,
  args: unknown[],
) {
  const account = await server.getAccount(sourcePublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...(args as import("@stellar/stellar-sdk").xdr.ScVal[])))
    .setTimeout(30)
    .build();

  return server.simulateTransaction(tx);
}
