import { describe, it, expect } from "vitest";
import { Keypair, scValToNative } from "@stellar/stellar-sdk";
import { buildCreateArgs, milestonesToScVal } from "../lib/escrowArgs";

describe("milestonesToScVal", () => {
  it("round-trips milestones with the contract's field names and types", () => {
    const decoded = scValToNative(
      milestonesToScVal([
        { amount: 300n, deadline: 0n },
        { amount: 700n, deadline: 1_700_000_000n },
      ]),
    );

    expect(decoded).toEqual([
      { amount: 300n, released: false, released_amount: 0n, deadline: 0n },
      {
        amount: 700n,
        released: false,
        released_amount: 0n,
        deadline: 1_700_000_000n,
      },
    ]);
  });

  it("encodes an empty list as an empty vector", () => {
    expect(scValToNative(milestonesToScVal([]))).toEqual([]);
  });
});

describe("buildCreateArgs", () => {
  it("builds [client, freelancer, token, milestones, expiry] with correct types", () => {
    const client = Keypair.random().publicKey();
    const freelancer = Keypair.random().publicKey();
    const token = Keypair.random().publicKey();

    const args = buildCreateArgs({
      client,
      freelancer,
      token,
      milestones: [{ amount: 1_000n, deadline: 0n }],
      expiry: 1_700_000_000n,
    });

    expect(args).toHaveLength(5);
    expect(scValToNative(args[0])).toBe(client);
    expect(scValToNative(args[1])).toBe(freelancer);
    expect(scValToNative(args[2])).toBe(token);
    expect(scValToNative(args[3])).toEqual([
      { amount: 1_000n, released: false, released_amount: 0n, deadline: 0n },
    ]);
    expect(scValToNative(args[4])).toBe(1_700_000_000n);
  });
});
