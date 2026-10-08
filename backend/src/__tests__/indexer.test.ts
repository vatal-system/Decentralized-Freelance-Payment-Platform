import { describe, it, expect, vi } from "vitest";
import { Address, Keypair, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import {
  decodeEventData,
  decodeEventName,
  type ContractEventLike,
} from "../lib/events";
import { processContractEvents } from "../indexer";

/** Build an ScMap the way `#[contractevent]` data is encoded. */
function mapVal(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(entries).map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

function makeEvent(
  name: string,
  data: Record<string, xdr.ScVal>,
  ledger = 10,
): ContractEventLike {
  return {
    id: `evt-${ledger}`,
    ledger,
    topic: [xdr.ScVal.scvSymbol(name)],
    value: mapVal(data),
  };
}

const CONTRACT = "CBC4AW7IGPPIVYWASG2QKWZZXBKUSZXQXFS5ZZMAH7YN55DCHKCH65NJ";

describe("event decoding", () => {
  it("decodes a captured milestone_released event", () => {
    const event = makeEvent("milestone_released", {
      escrow_id: nativeToScVal(7n, { type: "u64" }),
      index: nativeToScVal(0, { type: "u32" }),
      amount: nativeToScVal(300n, { type: "i128" }),
    });

    expect(decodeEventName(event)).toBe("milestone_released");
    expect(decodeEventData(event)).toMatchObject({
      escrow_id: 7n,
      index: 0,
      amount: 300n,
    });
  });

  it("decodes a captured rated event", () => {
    const ratee = Keypair.random().publicKey();
    const event = makeEvent("rated", {
      escrow_id: nativeToScVal(7n, { type: "u64" }),
      rater: Address.fromString(Keypair.random().publicKey()).toScVal(),
      ratee: Address.fromString(ratee).toScVal(),
      score: nativeToScVal(5, { type: "u32" }),
      count: nativeToScVal(1n, { type: "u64" }),
      total_score: nativeToScVal(5n, { type: "u64" }),
    });

    expect(decodeEventName(event)).toBe("rated");
    const data = decodeEventData(event);
    expect(data.ratee).toBe(ratee);
    expect(data.score).toBe(5);
    expect(data.count).toBe(1n);
    expect(data.total_score).toBe(5n);
  });

  it("returns null/empty for a malformed event instead of throwing", () => {
    const event = makeEvent("rated", {});
    expect(decodeEventName({ topic: [] })).toBeNull();
    expect(decodeEventData(event)).toEqual({});
  });
});

describe("processContractEvents", () => {
  it("advances the cursor only after every event has been processed", async () => {
    const order: string[] = [];
    const events = [
      makeEvent("funded", { escrow_id: nativeToScVal(7n, { type: "u64" }) }, 10),
      makeEvent(
        "milestone_released",
        { escrow_id: nativeToScVal(7n, { type: "u64" }), index: nativeToScVal(0, { type: "u32" }) },
        11,
      ),
    ];
    const source = {
      getEvents: vi.fn(async () => {
        order.push("getEvents");
        return { events, latestLedger: 12 };
      }),
    };

    let cursorValue = 5;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        order.push(`set:${ledger}`);
        cursorValue = ledger;
      },
    };
    const dispatch = vi.fn(async () => {
      order.push("dispatch");
    });

    const next = await processContractEvents(source, cursor, [CONTRACT], dispatch);

    expect(source.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 6 }),
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(next).toBe(12);
    expect(cursorValue).toBe(12);
    // Fetch first, dispatch in between, persist the cursor last.
    expect(order[0]).toBe("getEvents");
    expect(order[order.length - 1]).toBe("set:12");
  });

  it("does not call getEvents when no contracts are configured", async () => {
    const source = { getEvents: vi.fn() };
    let cursorValue = 5;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        cursorValue = ledger;
      },
    };

    const next = await processContractEvents(source, cursor, [], vi.fn());

    expect(next).toBe(5);
    expect(source.getEvents).not.toHaveBeenCalled();
  });

  it("keeps going when one event fails", async () => {
    const events = [
      makeEvent("funded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 10),
      makeEvent("refunded", { escrow_id: nativeToScVal(1n, { type: "u64" }) }, 11),
    ];
    const source = { getEvents: vi.fn(async () => ({ events, latestLedger: 11 })) };
    let cursorValue = 9;
    const cursor = {
      get: async () => cursorValue,
      set: async (ledger: number) => {
        cursorValue = ledger;
      },
    };
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const next = await processContractEvents(source, cursor, [CONTRACT], dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(next).toBe(11);
  });
});
