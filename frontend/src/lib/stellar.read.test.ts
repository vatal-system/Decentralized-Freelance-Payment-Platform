import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, nativeToScVal } from "@stellar/stellar-sdk";
import type { SorobanRpc, Transaction } from "@stellar/stellar-sdk";

// The built-in path is the one that must work with no configuration, so make
// sure a developer's local .env (Vitest loads it into import.meta.env) cannot
// change which branch this file exercises.
vi.stubEnv("VITE_READONLY_SOURCE", "");

/** The escrow contract deployed in deployments/testnet.json. */
const ESCROW = "CALNRFGMUI7MLNLWO445U2BSDENF6DENURHXXFFRT6PV5GSOQX7GZGP7";

const { READONLY_SOURCE, readContract, server } = await import("./stellar");

/** A simulation response carrying a decoded return value. */
function simulated(retval: unknown): SorobanRpc.Api.SimulateTransactionResponse {
  return { result: { retval } } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readContract", () => {
  it("simulates from a source account that never signs and need not exist", async () => {
    // Before #108 the SDK called `getAccount(pk)` first, which throws for a
    // visitor with no wallet — or with a wallet whose account has never been
    // funded — which is exactly why shared links failed.
    const getAccount = vi.spyOn(server, "getAccount");
    const simulate = vi
      .spyOn(server, "simulateTransaction")
      .mockResolvedValue(simulated(nativeToScVal(7n, { type: "u64" })));

    await expect(readContract<bigint>(ESCROW, "get", [])).resolves.toBe(7n);

    expect(getAccount).not.toHaveBeenCalled();
    expect(simulate).toHaveBeenCalledTimes(1);
    const tx = simulate.mock.calls[0][0] as Transaction;
    expect(tx.source).toBe(READONLY_SOURCE);
    // Built from a synthetic "0" sequence (TransactionBuilder consumes the next
    // one); simulation ignores it, so nothing has to exist on-chain.
    expect(tx.sequence).toBe("1");
  });

  it("classifies a missing record as not-found", async () => {
    vi.spyOn(server, "simulateTransaction").mockResolvedValue({
      error: "HostError: Error(Contract, #1)\n\nEvent log (newest first):",
    } as SorobanRpc.Api.SimulateTransactionResponse);

    await expect(readContract(ESCROW, "get", [])).rejects.toMatchObject({
      name: "ContractReadError",
      kind: "not-found",
    });
  });

  it("classifies an unreachable RPC as unavailable", async () => {
    vi.spyOn(server, "simulateTransaction").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await expect(readContract(ESCROW, "get", [])).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("refuses to simulate when the contract id is not configured", async () => {
    await expect(readContract("", "get", [])).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});

describe("readContract with VITE_READONLY_SOURCE set", () => {
  const FUNDED = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

  it("loads the configured account and simulates from its real sequence", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_READONLY_SOURCE", FUNDED);
    const mod = await import("./stellar");

    const getAccount = vi
      .spyOn(mod.server, "getAccount")
      .mockResolvedValue(new Account(FUNDED, "42"));
    const simulate = vi
      .spyOn(mod.server, "simulateTransaction")
      .mockResolvedValue(simulated(nativeToScVal(1n, { type: "u64" })));

    expect(mod.READONLY_SOURCE).toBe(FUNDED);
    await expect(mod.readContract<bigint>(ESCROW, "get", [])).resolves.toBe(1n);
    expect(getAccount).toHaveBeenCalledWith(FUNDED);
    // The configured account's real sequence is used (42 → next is 43).
    expect((simulate.mock.calls[0][0] as Transaction).sequence).toBe("43");
  });

  it("reports an unreadable configured source as unavailable, not not-found", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_READONLY_SOURCE", FUNDED);
    const mod = await import("./stellar");

    vi.spyOn(mod.server, "getAccount").mockRejectedValue(
      new Error("Account not found: " + FUNDED),
    );

    await expect(mod.readContract(ESCROW, "get", [])).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
