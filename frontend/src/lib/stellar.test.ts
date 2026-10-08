import { describe, expect, it } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import { milestonesToScVal, type MilestoneInput } from "./stellar";

describe("milestonesToScVal", () => {
  it("round-trips milestones with the contract's field names", () => {
    const input: MilestoneInput[] = [
      { amount: 300n, deadline: 0n },
      { amount: 700n, deadline: 1_700_000_000n },
    ];

    const decoded = scValToNative(milestonesToScVal(input)) as Array<
      Record<string, unknown>
    >;

    expect(decoded).toHaveLength(2);
    expect(Object.keys(decoded[0]).sort()).toEqual([
      "amount",
      "deadline",
      "released",
    ]);
    expect(decoded[0]).toEqual({ amount: 300n, released: false, deadline: 0n });
    expect(decoded[1]).toEqual({
      amount: 700n,
      released: false,
      deadline: 1_700_000_000n,
    });
  });

  it("encodes an empty list as an empty vector", () => {
    expect(scValToNative(milestonesToScVal([]))).toEqual([]);
  });
});
