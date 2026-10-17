import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";

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
  scString: vi.fn(() => ({})),
  scU32: vi.fn(() => ({})),
  scU64: vi.fn(() => ({})),
  server: { sendTransaction: h.sendTransaction },
  explorerTxUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
}));

vi.mock("@stellar/stellar-sdk", () => ({
  TransactionBuilder: { fromXDR: vi.fn(() => ({})) },
  SorobanRpc: { Api: { GetTransactionStatus: { SUCCESS: "SUCCESS", NOT_FOUND: "NOT_FOUND" } } },
  xdr: {},
}));

import { ContractReadError } from "../lib/errors";
import { useEscrow } from "./useEscrow";
// The mocked helpers, so we can assert how the arguments are encoded.
import { scString, scU32, scU64 } from "../lib/stellar";
import { ToastProvider } from "./ToastProvider";
import Toaster from "../components/Toaster";

/**
 * Every hook under test runs inside the provider the app mounts, with the
 * toaster attached, so the lifecycle assertions below read the same DOM a user
 * would (issue #60).
 */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <Toaster />
    </ToastProvider>
  );
}

function renderEscrow() {
  return renderHook(() => useEscrow(), { wrapper: Wrapper });
}

beforeEach(() => {
  h.wallet.publicKey = "GCLIENT";
  h.buildContractCall.mockReset();
  h.readContract.mockReset();
  h.sendTransaction.mockReset();
  h.pollTransaction.mockReset();

  h.buildContractCall.mockResolvedValue({ xdr: "tx-xdr", result: 0n });
  h.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH" });
  h.pollTransaction.mockResolvedValue({ status: "SUCCESS" });
  h.wallet.sign.mockReset();
  h.wallet.sign.mockResolvedValue("signed-xdr");
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
    const { result } = renderEscrow();

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
    const { result } = renderEscrow();

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

  it("submits the dispute-timelock reclaim as escrow.reclaim_after_dispute_timeout", async () => {
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.reclaimDisputed(7n);
    });

    const [pk, contractId, method, args] = h.buildContractCall.mock.calls[0] as unknown as [
      string,
      string,
      string,
      unknown[],
    ];
    expect(pk).toBe("GCLIENT");
    expect(contractId).toBe("CESCROW");
    expect(method).toBe("reclaim_after_dispute_timeout");
    expect(args).toHaveLength(1);
    expect(scU64).toHaveBeenCalledWith(7n);
  });

  it("opens a dispute as escrow.open_dispute then dispute.raise, in that order", async () => {
    // `raise` is the call that mints the dispute the panel rules on; without it
    // the escrow is frozen with no dispute to arbitrate (#86). Its simulated
    // return value is the on-chain dispute id.
    h.buildContractCall
      .mockResolvedValueOnce({ xdr: "open-xdr", result: 0n })
      .mockResolvedValueOnce({ xdr: "raise-xdr", result: 3n });
    const { result } = renderEscrow();

    let opened: { hash: string; disputeId: bigint } | undefined;
    await act(async () => {
      opened = await result.current.openDispute(7n, "Milestone never delivered");
    });

    const calls = h.buildContractCall.mock.calls.map((call) => ({
      contractId: call[1],
      method: call[2],
      args: call[3],
    }));
    expect(calls.map((c) => `${c.contractId}.${c.method}`)).toEqual([
      "CESCROW.open_dispute",
      "CDISPUTE.raise",
    ]);
    expect(calls[0].args).toHaveLength(2);
    // escrow_id, the escrow *contract* (cross-called by raise), the raiser, the
    // reason — which must be a String, not a Symbol or Bytes.
    expect(calls[1].args).toHaveLength(4);
    expect(scU64).toHaveBeenCalledWith(7n);
    expect(scString).toHaveBeenCalledWith("Milestone never delivered");

    // The id comes from the simulation, since the return value does not survive
    // submission — this is what the caller records off-chain.
    expect(opened).toEqual({ hash: "HASH", disputeId: 3n });
    expect(result.current.error).toBeNull();
  });

  it("does not reach dispute.raise when open_dispute fails", async () => {
    h.buildContractCall.mockRejectedValueOnce(
      new Error("HostError: Error(Contract, #8)"),
    );
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.openDispute(7n, "Milestone never delivered");
    });

    // A second transaction on a contract the first one never prepared would
    // fail anyway; failing fast keeps the escrow's state and the API's in step.
    expect(h.buildContractCall).toHaveBeenCalledTimes(1);
    // DisputeError #8 is `NotAParty`; the shared frontend map words it for the
    // escrow contract too, which is why it reads generically.
    expect(result.current.error).toBe(
      "The milestone list is invalid, or you're not a party to this job.",
    );
  });

  it("counts a dispute reclaim as a pending write so background polling pauses", async () => {
    const settle = deferredBuild();
    const { result } = renderEscrow();

    act(() => {
      void result.current.reclaimDisputed(1n);
    });

    await waitFor(() => expect(result.current.isPending("reclaim", "1")).toBe(true));
    expect(result.current.hasPendingWrite()).toBe(true);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current.hasPendingWrite()).toBe(false));
  });

  it("reads the dispute deadline through the escrow view", async () => {
    h.readContract.mockResolvedValueOnce(1_700_000_000n);
    const { result } = renderEscrow();

    let deadline: bigint | undefined;
    await act(async () => {
      deadline = await result.current.getDisputeDeadline(7n);
    });

    expect(deadline).toBe(1_700_000_000n);
    // Reads take no source key: the read-only source lives in lib/stellar.ts.
    const [contractId, method, args] = h.readContract.mock.calls[0] as unknown as [
      string,
      string,
      unknown[],
    ];
    expect(contractId).toBe("CESCROW");
    expect(method).toBe("dispute_deadline");
    expect(args).toHaveLength(1);
    expect(scU64).toHaveBeenCalledWith(7n);
    expect(h.wallet.connect).not.toHaveBeenCalled();
  });

  it("counts a rating as a pending write so background polling pauses", async () => {
    const settle = deferredBuild();
    const { result } = renderEscrow();

    act(() => {
      void result.current.submitRating(7n, "GRATEE", 5);
    });

    await waitFor(() => expect(result.current.isPending("rate", "7:GRATEE")).toBe(true));
    expect(result.current.hasPendingWrite()).toBe(true);

    await act(async () => {
      settle();
    });
    await waitFor(() => expect(result.current.hasPendingWrite()).toBe(false));
  });

  it("submits a rating as reputation.submit with a u32 score", async () => {
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.submitRating(7n, "GRATEE", 5);
    });

    const [pk, contractId, method, args] = h.buildContractCall.mock.calls[0] as unknown as [
      string,
      string,
      string,
      unknown[],
    ];
    expect(pk).toBe("GCLIENT");
    expect(contractId).toBe("CREP");
    expect(method).toBe("submit");
    expect(args).toHaveLength(4);
    expect(scU64).toHaveBeenCalledWith(7n);
    // The score must be u32; the i32 default from a bare number traps on-chain.
    expect(scU32).toHaveBeenCalledWith(5);
  });

  it("surfaces AlreadyRated through lastFailure and a friendly message", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("HostError: Error(Contract, #5)"));
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.submitRating(7n, "GRATEE", 5);
    });

    expect(result.current.lastFailure).toEqual({ kind: "rate", code: 5 });
    expect(result.current.error).toBe(
      "That milestone index is out of range, or you've already rated this job.",
    );
  });

  it("reports a non-contract failure without a code", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("wallet not connected"));
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.submitRating(7n, "GRATEE", 5);
    });

    expect(result.current.lastFailure).toEqual({ kind: "rate", code: null });
    expect(result.current.error).toBe("wallet not connected");
  });

  it("reads escrow and reputation with no wallet connected (shared links)", async () => {
    // The regression in #108: a read called connect() (or fell back to the
    // visitor's possibly unfunded account) before it could simulate.
    h.wallet.publicKey = null;
    h.readContract.mockResolvedValueOnce({ status: "Active" });
    const { result } = renderEscrow();

    let view: unknown;
    await act(async () => {
      view = await result.current.getEscrow(7n);
    });

    expect(view).toEqual({ status: "Active" });
    expect(h.readContract).toHaveBeenCalledWith("CESCROW", "get", expect.anything());

    h.readContract.mockResolvedValueOnce({ total_score: 0n, weight: 0n, count: 0n });
    await act(async () => {
      await result.current.getReputation("GFREELANCER");
    });
    expect(h.readContract).toHaveBeenLastCalledWith(
      "CREP",
      "get_aggregate",
      expect.anything(),
    );
    expect(h.wallet.connect).not.toHaveBeenCalled();
  });

  it("unwraps the decoded enum status so live escrow gating matches", async () => {
    // The contract's `status` decodes as ["Active"]; without unwrapping it, the
    // badge crashes and `status === "Active"` is silently false on live data.
    h.readContract.mockResolvedValueOnce({ status: ["Active"], milestones: [] });
    const { result } = renderEscrow();

    let view: { status: unknown } | undefined;
    await act(async () => {
      view = await result.current.getEscrow(7n);
    });
    expect(view?.status).toBe("Active");
  });

  it("rejects with a typed failure so pages can tell not-found from offline", async () => {
    h.wallet.publicKey = null;
    h.readContract.mockRejectedValueOnce(new Error("HostError: Error(Contract, #1)"));
    const { result } = renderEscrow();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.getEscrow(99n);
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(ContractReadError);
    expect((caught as ContractReadError).kind).toBe("not-found");
    // A failed read is not a write failure: it must not surface as `error`.
    expect(result.current.error).toBeNull();
  });

  it("clears a previous error after a subsequent successful read", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderEscrow();

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

describe("useEscrow transaction toasts", () => {
  it("walks a write through building → signing → confirmed with an explorer link", async () => {
    // Hold each stage open in turn so the intermediate states are observable.
    let settleBuild: (value: { xdr: string; result: unknown }) => void = () => {};
    h.buildContractCall.mockImplementation(
      () => new Promise((resolve) => (settleBuild = resolve)),
    );
    let settleSign: (value: string) => void = () => {};
    h.wallet.sign.mockImplementation(() => new Promise((resolve) => (settleSign = resolve)));

    const { result } = renderEscrow();

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.releaseMilestone(1n, 0);
    });
    expect(screen.getByText("Building release milestone transaction…")).toBeTruthy();

    // Build + simulate resolves: the toast moves to the wallet prompt.
    await act(async () => {
      settleBuild({ xdr: "tx-xdr", result: undefined });
    });
    await waitFor(() =>
      expect(screen.getByText("Awaiting signature for release milestone…")).toBeTruthy(),
    );

    await act(async () => {
      settleSign("signed-xdr");
      await pending;
    });

    // One toast, now confirmed and linked to the transaction.
    expect(screen.getByText("release milestone confirmed")).toBeTruthy();
    const link = screen.getByRole("link", { name: /stellar\.expert/i }) as HTMLAnchorElement;
    expect(link.href).toBe("https://stellar.expert/explorer/testnet/tx/HASH");
  });

  it("surfaces a contract failure with the mapped message", async () => {
    h.buildContractCall.mockRejectedValueOnce(new Error("HostError: Error(Contract, #3)"));
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.releaseMilestone(1n, 0);
    });

    // Escrow #3 is `Unauthorized`: the toast carries the same mapped text the
    // inline error does, rather than the raw host string.
    expect(screen.getByRole("alert").textContent).toContain(
      "You're not authorized to perform this action.",
    );
    expect(result.current.error).toBe("You're not authorized to perform this action.");
  });

  it("does not toast a read", async () => {
    h.readContract.mockResolvedValueOnce({ status: "Active" });
    const { result } = renderEscrow();

    await act(async () => {
      await result.current.getEscrow(1n);
    });

    expect(screen.queryByLabelText("Transaction notifications")).toBeNull();
  });
});
