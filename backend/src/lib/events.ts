/**
 * events.ts
 *
 * Pure decoders for Soroban contract events (see docs/EVENTS.md).
 *
 * An event's `topic[0]` is a `Symbol` carrying the event name (e.g.
 * `milestone_released`), `topic[1]` is the struct field annotated `#[topic]`,
 * and `value` is a map of the remaining fields keyed by field name. These
 * helpers never throw — malformed events decode to `null`/`{}` and are ignored
 * by the indexer rather than crashing it.
 *
 * The two-places-the-id-lives split matters: `created` and `funded` have
 * `client` as their `#[topic]` field, so their `escrow_id` is in the data map,
 * while `milestone_released`, `dispute_opened`, `resolved`, `refunded`,
 * `raised`, `dispute_resolved` and `rated` carry `escrow_id` as the topic field
 * and *not* in the data map. Use `eventEscrowId` rather than reading
 * `escrow_id` off the data map.
 * `milestone_released`), and its `value` is a map of the remaining fields keyed
 * by field name. These helpers never throw — malformed events decode to
 * `null`/`{}` and are ignored by the indexer rather than crashing it.
 *
 * `#[topic]` fields are the trap (see docs/EVENTS.md): a struct field marked
 * `#[topic]` is serialized into `topic[1]`, not into `value`, and every event in
 * this project except escrow's `created`/`funded` carries `escrow_id` there. A
 * handler that reads only `value` therefore sees no escrow id at all and
 * silently skips the event, which is why `decodeEventFields` exists.
 */

import { scValToNative, xdr } from "@stellar/stellar-sdk";

/** The event names the indexer knows about (others are ignored). */
export const KNOWN_EVENTS = new Set([
  "created",
  "funded",
  "milestones_updated",
  "milestone_released",
  "milestone_reclaimed",
  "cancelled",
  "dispute_opened",
  "resolved",
  "refunded",
  "dispute_contract_updated",
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
  /**
   * Hash of the transaction that emitted the event, as RPC reports it. Present
   * on live events and used for the explorer link in a history view (issue #72);
   * optional so hand-built test fixtures can omit it.
   */
  txHash?: string;
  /** Ledger close time (ISO 8601) as RPC reports it. */
  ledgerClosedAt?: string;
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

/**
 * The `#[topic]` field of an event (`topic[1]`) as a native value, or `null` when
 * it is missing/malformed.
 */
export function decodeEventTopic(
  event: Pick<ContractEventLike, "topic">,
): unknown {
  const topic1 = event.topic?.[1];
  if (!topic1) return null;
  try {
    return scValToNative(topic1);
  } catch {
    return null;
  }
}

/** Coerce an event field that should be a u64 into a bigint. */
function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * The escrow an event refers to.
 *
 * Read the data map first (`created`/`funded` carry `escrow_id` there) and fall
 * back to the `#[topic]` field, which is where every other event's `escrow_id`
 * lives. Reading only the data map made those handlers return immediately, so
 * the events they were written for never reached the database.
 */
export function eventEscrowId(event: ContractEventLike): bigint | null {
  return toBigInt(decodeEventData(event).escrow_id) ?? toBigInt(decodeEventTopic(event));
}

/**
 * The decoded values of `topic[1..]` — the event's `#[topic]` fields, in the
 * order the struct declares them (there is at most one today). A field that
 * cannot be decoded becomes `undefined` rather than throwing.
 */
export function decodeEventTopics(
  event: Pick<ContractEventLike, "topic">,
): unknown[] {
  return (event.topic ?? []).slice(1).map((val) => {
    try {
      return scValToNative(val);
    } catch {
      return undefined;
    }
  });
}

/**
 * An event's fields as one map: the `value` map plus its `#[topic]` fields,
 * named by the caller (`topicNames[i]` is `topic[i + 1]`).
 *
 * The escrow contract emits `created`/`funded` with `escrow_id` in the data, so
 * for those this is identical to `decodeEventData`; every other event puts it in
 * `topic[1]`. Handlers should not have to know which, and a topic value that
 * decodes cleanly wins over a same-named data field.
 */
export function decodeEventFields(
  event: ContractEventLike,
  topicNames: string[],
): Record<string, unknown> {
  const fields = decodeEventData(event);
  decodeEventTopics(event).forEach((value, index) => {
    const name = topicNames[index];
    if (name !== undefined && value !== undefined) fields[name] = value;
  });
  return fields;
}
