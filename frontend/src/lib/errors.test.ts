import { describe, expect, it } from "vitest";
import { friendlyError, parseContractErrorCode } from "./errors";

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
