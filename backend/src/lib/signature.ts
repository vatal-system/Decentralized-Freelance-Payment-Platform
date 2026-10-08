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
import { Keypair } from "@stellar/stellar-sdk";

const PREFIX = "Stellar Signed Message:\n";

/** SHA-256 of the SEP-53 canonical payload for `message`. */
export function signedMessageHash(message: string): Buffer {
  return createHash("sha256")
    .update(Buffer.from(PREFIX + message, "utf8"))
    .digest();
}

/** Verify a base64 SEP-53 signature over `message` from `address`. */
export function verifySignedMessage(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(address);
    const signature = Buffer.from(signatureBase64, "base64");
    return keypair.verify(signedMessageHash(message), signature);
  } catch {
    return false;
  }
}
