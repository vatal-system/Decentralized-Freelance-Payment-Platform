/**
 * signature.ts
 *
 * SEP-53 ("Sign and Verify Messages") verification.
 *
 * Wallets such as Freighter sign a message as:
 *   messageHash = SHA256("Stellar Signed Message:\n" + message)
 *   signature   = ed25519_sign(privateKey, messageHash)
 *
 * The canonical payload prefix prevents a signed message from being replayed as
 * a transaction. Verification is non-throwing.
 */

import { createHash } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

const PREFIX = "Stellar Signed Message:\n";

export class InvalidStellarAddressError extends Error {
  readonly code = "INVALID_STELLAR_ADDRESS";
  readonly statusCode = 400;

  constructor(message = "Invalid Stellar address") {
    super(message);
    this.name = "InvalidStellarAddressError";
  }
}

/**
 * Validate that an address strictly conforms to Stellar Ed25519 public key standards:
 * - Version byte 'G'
 * - Exactly 56 characters
 * - Valid CRC16 checksum
 * Rejects multiplexed (M-addresses), secret keys (S-keys), contracts (C-keys), and malformed checksums.
 * Throws InvalidStellarAddressError if invalid.
 */
export function validateStellarPublicKey(address: string): void {
  if (!address || typeof address !== "string" || !StrKey.isValidEd25519PublicKey(address)) {
    throw new InvalidStellarAddressError(
      `Invalid Stellar public key: "${address}". Expected a 56-character Ed25519 G-address with valid checksum.`,
    );
  }
}

/** Alias for validateStellarPublicKey */
export const validateStellarAddress = validateStellarPublicKey;

/** SHA-256 of the SEP-53 canonical payload for `message`. */
export function signedMessageHash(message: string): Buffer {
  return createHash("sha256")
    .update(Buffer.from(PREFIX + message, "utf8"))
    .digest();
}

/**
 * Verify a base64 SEP-53 signature over `message` from `address`.
 * Validates the public key checksum and network prefix using StrKey before invoking
 * cryptography routines. Returns false if address is malformed or signature is invalid.
 */
export function verifySignedMessage(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  if (!address || typeof address !== "string" || !StrKey.isValidEd25519PublicKey(address)) {
    return false;
  }
  try {
    const keypair = Keypair.fromPublicKey(address);
    const signature = Buffer.from(signatureBase64, "base64");
    return keypair.verify(signedMessageHash(message), signature);
  } catch {
    return false;
  }
}

/**
 * Strictly verify a base64 SEP-53 signature over `message` from `address`.
 * Throws InvalidStellarAddressError (code: INVALID_STELLAR_ADDRESS) if address is malformed.
 */
export function verifySignedMessageStrict(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  validateStellarPublicKey(address);
  return verifySignedMessage(address, message, signatureBase64);
}
