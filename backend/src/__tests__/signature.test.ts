import { describe, it, expect } from "vitest";
import { signedMessageHash, verifySignedMessage } from "../lib/signature";

// Official SEP-53 test vectors (see stellar-protocol/ecosystem/sep-0053.md).
const ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
const ASCII = {
  message: "Hello, World!",
  signature:
    "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==",
};
const UNICODE = {
  message: "こんにちは、世界！",
  signature:
    "CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==",
};

describe("verifySignedMessage (SEP-53)", () => {
  it("accepts the official ASCII vector", () => {
    expect(
      verifySignedMessage(ADDRESS, ASCII.message, ASCII.signature),
    ).toBe(true);
  });

  it("accepts the official Unicode vector", () => {
    expect(
      verifySignedMessage(ADDRESS, UNICODE.message, UNICODE.signature),
    ).toBe(true);
  });

  it("rejects a tampered message", () => {
    expect(
      verifySignedMessage(ADDRESS, "Hello, W0rld!", ASCII.signature),
    ).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifySignedMessage(ADDRESS, ASCII.message, "not-base64!!")).toBe(
      false,
    );
    expect(verifySignedMessage("not-an-address", ASCII.message, ASCII.signature)).toBe(
      false,
    );
  });

  it("hashes the prefixed payload", () => {
    expect(signedMessageHash("abc")).toHaveLength(32);
    expect(signedMessageHash("abc").equals(signedMessageHash("abc"))).toBe(true);
    expect(signedMessageHash("abc").equals(signedMessageHash("abd"))).toBe(false);
  });
});
