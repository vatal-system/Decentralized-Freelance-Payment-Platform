/**
 * events.ts
 *
 * Pure decoders for Soroban contract events (see docs/EVENTS.md).
 *
 * An event's `topic[0]` is a `Symbol` carrying the event name (e.g.
 * `milestone_released`) and its `value` is a map of the remaining fields keyed
 * by field name. These helpers never throw — malformed events decode to
 * `null`/`{}` and are ignored by the indexer rather than crashing it.
 */

import { scValToNative, xdr } from "@stellar/stellar-sdk";

/** The event names the indexer knows about (others are ignored). */
export const KNOWN_EVENTS = new Set([
  "created",
  "funded",
  "milestones_updated",
  "milestone_released",
  "dispute_opened",
  "resolved",
  "refunded",
  "raised",
  "approved",
  "dispute_resolved",
  "rated",
]);

export interface ContractEventLike {
  id?: string;
  ledger: number;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}

/** The event name from `topic[0]`, or `null` if it is missing/malformed. */
export function decodeEventName(event: Pick<ContractEventLike, "topic">): string | null {
  const topic0 = event.topic?.[0];
  if (!topic0) return null;
  try {
    const name = scValToNative(topic0);
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** The event's data fields, or `{}` if the value is missing/malformed. */
export function decodeEventData(
  event: Pick<ContractEventLike, "value">,
): Record<string, unknown> {
  try {
    const data = scValToNative(event.value);
    return data !== null && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
