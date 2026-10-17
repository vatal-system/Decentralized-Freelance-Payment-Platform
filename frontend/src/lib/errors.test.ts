import { describe, expect, it } from "vitest";
import {
  ContractReadError,
  asReadError,
  classifyReadFailure,
  describeReadFailure,
  friendlyError,
  parseContractErrorCode,
} from "./errors";

describe("parseContractErrorCode", () => {
  it("extracts the code from a contract error", () => {
    expect(parseContractErrorCode("HostError: Error(Contract, #6)")).toBe(6);
    expect(parseContractErrorCode("Error(Contract, #13)")).toBe(13);
  });

  it("returns null when there is no contract error code", () => {
    expect(parseContractErrorCode("Transaction rejected")).toBeNull();
  });
});

describe("friendlyError", () => {
  it("translates a known escrow code", () => {
    // NotExpired = 6 (see contracts/interface/src/lib.rs).
    expect(friendlyError(new Error("HostError: Error(Contract, #6)"))).toMatch(
      /expiry/,
    );
    expect(friendlyError(new Error("HostError: Error(Contract, #13)"))).toMatch(
      /shares/,
    );
  });

  it("falls back to the original message for an unknown code", () => {
    const raw = "HostError: Error(Contract, #999)";
    expect(friendlyError(new Error(raw))).toBe(raw);
  });

  it("falls back for a non-contract error", () => {
    expect(friendlyError(new Error("Transaction rejected"))).toBe(
      "Transaction rejected",
    );
  });

  it("never throws on non-Error values", () => {
    expect(friendlyError("boom")).toBe("boom");
    expect(friendlyError(undefined)).toBe("undefined");
  });
});

describe("classifyReadFailure", () => {
  it("reads a contract NotFound (what a missing escrow returns) as not-found", () => {
    expect(classifyReadFailure(new Error("HostError: Error(Contract, #1)"))).toBe(
      "not-found",
    );
  });

  it("treats an id or address that cannot exist as not-found", () => {
    expect(classifyReadFailure(new Error("Unsupported address type: nope"))).toBe(
      "not-found",
    );
  });

  it("treats transport and configuration failures as unavailable", () => {
    expect(classifyReadFailure(new TypeError("Failed to fetch"))).toBe("unavailable");
    expect(classifyReadFailure(new Error("getaddrinfo ENOTFOUND soroban-testnet"))).toBe(
      "unavailable",
    );
    expect(classifyReadFailure(new Error("RPC request failed (HTTP 503)"))).toBe(
      "unavailable",
    );
    expect(
      classifyReadFailure(new Error("This contract address is not configured (.env)")),
    ).toBe("unavailable");
    // A malformed VITE_*_CONTRACT_ID is a deployment problem, not a bad link.
    expect(classifyReadFailure(new Error("Invalid contract ID: nope"))).toBe(
      "unavailable",
    );
    // NotInitialized: the deployment cannot answer reads yet.
    expect(classifyReadFailure(new Error("HostError: Error(Contract, #12)"))).toBe(
      "unavailable",
    );
  });

  it("leaves other contract errors as unknown so the message is shown", () => {
    expect(classifyReadFailure(new Error("HostError: Error(Contract, #3)"))).toBe(
      "unknown",
    );
    expect(classifyReadFailure(new Error("something else"))).toBe("unknown");
  });

  it("passes an existing ContractReadError's kind through", () => {
    expect(classifyReadFailure(new ContractReadError("unavailable", "nope"))).toBe(
      "unavailable",
    );
  });
});

describe("asReadError", () => {
  it("keeps an existing ContractReadError untouched", () => {
    const original = new ContractReadError("not-found", "nope");
    expect(asReadError(original)).toBe(original);
  });

  it("wraps a raw failure with its kind and a friendly message", () => {
    const error = asReadError(new Error("HostError: Error(Contract, #1)"));
    expect(error).toBeInstanceOf(ContractReadError);
    expect(error.kind).toBe("not-found");
    expect(error.message).toMatch(/was not found/);
  });
});

describe("describeReadFailure", () => {
  it("blames the link only for a missing record", () => {
    expect(describeReadFailure("not-found", "job #7")).toMatch(/check the link/);
  });

  it("calls an unreachable network a network problem, not a bad link", () => {
    const copy = describeReadFailure("unavailable", "job #7");
    expect(copy).toMatch(/Couldn't reach Stellar/);
    expect(copy).toMatch(/not a bad link/);
  });

  it("names the subject that could not be read", () => {
    expect(describeReadFailure("unknown", "this reputation")).toContain(
      "this reputation",
    );
  });
});
