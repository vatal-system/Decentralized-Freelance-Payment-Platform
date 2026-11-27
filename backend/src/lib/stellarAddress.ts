/**
 * stellarAddress.ts
 *
 * The one predicate the API uses to decide whether a string is a Stellar
 * account address: an ed25519 strkey — version byte 'G' followed by 55 base32
 * characters (56 in total) — whose CRC16 checksum verifies. Anything shorter,
 * longer, outside the base32 alphabet, or with a bad checksum is rejected
 * before it reaches a database lookup or a ScVal encoder.
 *
 * Kept free of any `config`/db import so the logic is unit testable without
 * environment variables, and shared by every route that accepts an address.
 */

import { Keypair, StrKey } from "@stellar/stellar-sdk";

/** Shape of an account strkey: version byte 'G' + 55 base32 chars. */
const ACCOUNT_STRTKEY = /^G[A-Z2-7]{55}$/;

/** True when `address` is a checksum-valid Stellar account id. */
export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string" || !ACCOUNT_STRTKEY.test(address)) return false;
  try {
    if (!StrKey.isValidEd25519PublicKey(address)) return false;
    // Decodes the strkey and verifies its CRC16 checksum; throws otherwise.
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}
