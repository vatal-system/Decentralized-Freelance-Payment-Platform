/**
 * errors.ts
 *
 * Turns raw contract/SDK errors into friendly, user-facing messages.
 *
 * Soroban surfaces a contract error as `HostError: Error(Contract, #N)`, where
 * `N` is the `#[contracterror]` discriminant from
 * `contracts/{interface,dispute,reputation}/src/lib.rs`. Callers should show the
 * mapped message when one exists and otherwise fall back to the original text —
 * this helper never throws and never hides an error.
 *
 * Note on codes: the wave-issue text lists `#7 NotExpired`, but the interface
 * enum defines `NotExpired = 6` and `ZeroAmount = 7`. These messages follow the
 * code (`contracts/interface/src/lib.rs`), which is the source of truth.
 *
 * Contributor Notes:
 * - Codes overlap between contracts (e.g. escrow `#4` is
 *   `MilestoneAlreadyReleased` but reputation `#4` is `InvalidScore`), so a few
 *   messages describe both meanings rather than guessing the contract.
 */

const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  // EscrowError / DisputeError / ReputationError
  1: "That record was not found.",
  2: "This action isn't allowed right now — it may already be initialized.",
  3: "You're not authorized to perform this action.",
  4: "This milestone has already been released, or the rating is out of range (1–5).",
  5: "That milestone index is out of range, or you've already rated this job.",
  6: "This escrow hasn't reached its expiry yet, or the escrow was not found.",
  7: "Amounts must be greater than zero, or the job isn't completed yet.",
  8: "The milestone list is invalid, or you're not a party to this job.",
  9: "The expiry time is invalid, or the rated address is incorrect.",
  10: "The client and freelancer must be different addresses.",
  11: "This contract is already initialized.",
  12: "This contract isn't initialized yet.",
  13: "The payout shares don't match the funds still held in escrow.",
  14: "A numeric overflow occurred.",
};

/** Extract the `#N` discriminant from a Soroban contract error, if present. */
export function parseContractErrorCode(message: string): number | null {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isInteger(code) ? code : null;
}

/**
 * Map an error to a friendly message. Recognized contract codes are translated;
 * everything else (network errors, rejected signatures, unknown codes) keeps its
 * original message. Never throws.
 */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = parseContractErrorCode(raw);
  if (code !== null) {
    const message = CONTRACT_ERROR_MESSAGES[code];
    if (message) return message;
  }
  return raw;
}
