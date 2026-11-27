import { describe, it, expect } from "vitest";
import {
  signedMessageHash,
  verifySignedMessage,
  verifySignedMessageStrict,
  validateStellarPublicKey,
  InvalidStellarAddressError,
} from "../lib/signature";

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

// Edge cases
const INVALID_CHECKSUM_ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7M"; // altered last char
const M_ADDRESS = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAJL6"; // M-multiplexed address
const SHORT_ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP"; // 55 chars
const LONG_ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7LAAA"; // 59 chars
const CONTRACT_ADDRESS = "CA3D5KRYMCMCZNUM7GIHIPDA3D5KRYMCMCZNUM7GIHIPDA3D5KRYMCMCZ"; // C-address
const SECRET_SEED = "SB2EBG55X7AYL6VEMR4Z6L6B7F6J533BHMGLU3V5GGB4X4K6X2XNDLVA"; // S-secret

describe("validateStellarPublicKey and verifySignedMessage (SEP-53)", () => {
  describe("verifySignedMessage", () => {
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

    it("rejects invalid checksum addresses without throwing", () => {
      expect(
        verifySignedMessage(INVALID_CHECKSUM_ADDRESS, ASCII.message, ASCII.signature),
      ).toBe(false);
    });

    it("rejects multiplexed M-addresses without throwing", () => {
      expect(
        verifySignedMessage(M_ADDRESS, ASCII.message, ASCII.signature),
      ).toBe(false);
    });

    it("rejects addresses with invalid lengths without throwing", () => {
      expect(
        verifySignedMessage(SHORT_ADDRESS, ASCII.message, ASCII.signature),
      ).toBe(false);
      expect(
        verifySignedMessage(LONG_ADDRESS, ASCII.message, ASCII.signature),
      ).toBe(false);
    });

    it("hashes the prefixed payload", () => {
      expect(signedMessageHash("abc")).toHaveLength(32);
      expect(signedMessageHash("abc").equals(signedMessageHash("abc"))).toBe(true);
      expect(signedMessageHash("abc").equals(signedMessageHash("abd"))).toBe(false);
    });
  });

  describe("validateStellarPublicKey", () => {
    it("validates a valid 56-character Ed25519 G-address", () => {
      expect(() => validateStellarPublicKey(ADDRESS)).not.toThrow();
    });

    it("throws structured INVALID_STELLAR_ADDRESS error for invalid checksum", () => {
      expect(() => validateStellarPublicKey(INVALID_CHECKSUM_ADDRESS)).toThrowError(
        InvalidStellarAddressError,
      );
      try {
        validateStellarPublicKey(INVALID_CHECKSUM_ADDRESS);
      } catch (err) {
        expect((err as InvalidStellarAddressError).code).toBe("INVALID_STELLAR_ADDRESS");
        expect((err as InvalidStellarAddressError).statusCode).toBe(400);
      }
    });

    it("throws structured INVALID_STELLAR_ADDRESS error for M-addresses", () => {
      expect(() => validateStellarPublicKey(M_ADDRESS)).toThrowError(
        InvalidStellarAddressError,
      );
      try {
        validateStellarPublicKey(M_ADDRESS);
      } catch (err) {
        expect((err as InvalidStellarAddressError).code).toBe("INVALID_STELLAR_ADDRESS");
      }
    });

    it("throws structured INVALID_STELLAR_ADDRESS error for invalid lengths", () => {
      expect(() => validateStellarPublicKey(SHORT_ADDRESS)).toThrowError(
        InvalidStellarAddressError,
      );
      expect(() => validateStellarPublicKey(LONG_ADDRESS)).toThrowError(
        InvalidStellarAddressError,
      );
      expect(() => validateStellarPublicKey("")).toThrowError(
        InvalidStellarAddressError,
      );
    });

    it("throws structured INVALID_STELLAR_ADDRESS error for non-G prefixes", () => {
      expect(() => validateStellarPublicKey(CONTRACT_ADDRESS)).toThrowError(
        InvalidStellarAddressError,
      );
      expect(() => validateStellarPublicKey(SECRET_SEED)).toThrowError(
        InvalidStellarAddressError,
      );
    });
  });

  describe("verifySignedMessageStrict", () => {
    it("verifies signature with valid address", () => {
      expect(verifySignedMessageStrict(ADDRESS, ASCII.message, ASCII.signature)).toBe(true);
    });

    it("throws structured error on invalid address", () => {
      expect(() =>
        verifySignedMessageStrict(INVALID_CHECKSUM_ADDRESS, ASCII.message, ASCII.signature),
      ).toThrowError(InvalidStellarAddressError);
    });
  });
});
