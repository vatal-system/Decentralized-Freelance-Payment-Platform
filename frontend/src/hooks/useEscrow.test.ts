import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => ({
  wallet: {
    publicKey: "GCLIENT" as string | null,
    connecting: false,
    error: null as string | null,
    connect: vi.fn(async () => "GCLIENT"),
    disconnect: vi.fn(),
    sign: vi.fn(async () => "signed-xdr"),
    signMessage: vi.fn(async () => "sig"),
  },
  buildContractCall: vi.fn(),
  readContract: vi.fn(),
  sendTransaction: vi.fn(),
  pollTransaction: vi.fn(),
}));

vi.mock("./wallet-context", () => ({ useWallet: () => h.wallet }));

vi.mock("../lib/stellar", () => ({
  CONTRACT_ADDRESSES: {
    escrow: "CESCROW",
    dispute: "CDISPUTE",
    reputation: "CREP",
    usdc: "CUSDC",
  },
  buildContractCall: h.buildContractCall,
  readContract: h.readContract,
  milestonesToScVal: vi.fn(() => ({})),
  networkPassphrase: "Test SDF Network ; September 2015",
  pollTransaction: h.pollTransaction,
  scAddress: vi.fn(() => ({})),
  scU32: vi.fn(() => ({})),
  scU64: vi.fn(() => ({})),
  server: { sendTransaction: h.sendTransaction },
}));

vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR: vi.fn(() => ({})) },
  SorobanRpc: { Api: { GetTransactionStatus: { SUCCESS: "SUCCESS", NOT_FOUND: "NOT_FOUND" } } },
  xdr: {},
}));

import { useEscrow } from "./useEscrow";

beforeEach(() => {
  h.wallet.publicKey = "GCLIENT";
  h.buildContractCall.mockReset();
  h.readContract.mockReset();
  h.sendTransaction.mockReset();
  h.pollTransaction.mockReset();

  h.buildContractCall.mockResolvedValue({ xdr: "tx-xdr", result: 0n });
  h.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH" });
  h.pollTransaction.mockResolvedValue({ status: "SUCCESS" });
});

afterEach(() => cleanup());

/** A buildContractCall whose promise is resolved manually. */
function deferredBuild() {
  let resolve: (value: { xdr: string; result: unknown }) => void = () => {};
  h.buildContractCall.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  return (value: { xdr: string; result: unknown } = { xdr: "x", result: undefined }) =>
    resolve(value);
}

describe("useEscrow transaction state", () => {
  it("does not start the same target twice (double-submit guard)", async () => {
    const settle = deferredBuild();
    const { result } = renderHook(() => useEscrow());

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = result.current.releaseMilestone(1n, 0);
      second = result.current.releaseMilestone(1n, 0);
    });

    // The duplicate was ignored: only one transaction was built.
    expect(h.buildContractCall).toHaveBeenCalledTimes(1);

    let secondResult: unknown = "not-resolved";
    await act(async () => {
      settle();
      secondResult = await second;
      await first;
    });
    // The guarded call resolves to `undefined` without doing any work.
    expect(secondResult).toBeUndefined();
    expect(result.current.isPending("release", "1:0")).toBe(false);
  });

  it("scopes pending state to the affected target, not unrelated ones", async () => {
    const settle = deferredBuild();
    const { result } = renderHook(() => useEscrow());

    act(() => {
      void result.current.releaseMilestone(1n, 0);
    });

    await waitFor(() => expect(result.current.isPending("release", "1:0")).toBe(true));
    expect(result.current.isPending("release", "1:1")).toBe(false);
    expect(result.current.isPending("dispute", "1")).toBe(false);
    expect(result.current.hasPendingWrite()).toBe(true);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current.hasPendingWrite()).toBe(false));
  });

  it("clears a previous error after a subsequent successful read", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useEscrow());

    await act(async () => {
      await result.current.releaseMilestone(1n, 0);
    });
    expect(result.current.error).toBe("boom");

    h.readContract.mockResolvedValueOnce({ status: "Active" });
    await act(async () => {
      await result.current.getEscrow(1n);
    });
    expect(result.current.error).toBeNull();
  });
});
