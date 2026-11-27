import { describe, expect, it } from "vitest";
import { Keypair, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  EscrowClient,
  DisputeClient,
  ReputationClient,
  scAddress,
  scU32,
  scU64,
  scI128,
  scString,
  milestoneToScVal,
  milestonesToScVal,
  buildFundArgs,
  buildReleaseMilestoneArgs,
  buildReleasePartialArgs,
  buildReclaimArgs,
  buildReclaimDisputeArgs,
  buildReclaimMilestoneArgs,
  buildCancelArgs,
  buildOpenDisputeArgs,
  buildReputationSubmitArgs,
  buildRaiseArgs,
  buildApproveArgs,
  buildArbitrateArgs,
  buildCreateArgs,
  buildUpdateMilestonesArgs,
  parseContractErrorCode,
  friendlyContractError,
  ESCROW_ERROR_MESSAGES,
  DISPUTE_ERROR_MESSAGES,
  REPUTATION_ERROR_MESSAGES,
} from "../index";

const TEST_ADDR_1 = Keypair.random().publicKey();
const TEST_ADDR_2 = Keypair.random().publicKey();
const CONTRACT_ID = "CALNRFGMUI7MLNLWO445U2BSDENF6DENURHXXFFRT6PV5GSOQX7GZGP7";

describe("ScVal encoders", () => {
  it("encodes scAddress to Address ScVal", () => {
    const val = scAddress(TEST_ADDR_1);
    expect(val.switch()).toBe(xdr.ScValType.scvAddress());
  });

  it("encodes scU32 explicitly as u32", () => {
    const val = scU32(42);
    expect(val.switch()).toBe(xdr.ScValType.scvU32());
    expect(val.u32()).toBe(42);
  });

  it("encodes scU64 explicitly as u64", () => {
    const val = scU64(1000n);
    expect(val.switch()).toBe(xdr.ScValType.scvU64());
  });

  it("encodes scI128 explicitly as i128", () => {
    const val = scI128(5000000n);
    expect(val.switch()).toBe(xdr.ScValType.scvI128());
  });

  it("encodes scString as string ScVal", () => {
    const val = scString("test-string");
    expect(val.switch()).toBe(xdr.ScValType.scvString());
    expect(scValToNative(val)).toBe("test-string");
  });

  it("encodes milestoneToScVal with canonical sorted keys", () => {
    const mVal = milestoneToScVal({
      amount: 100n,
      deadline: 123456n,
      released: false,
      releasedAmount: 0n,
    });
    expect(mVal.switch()).toBe(xdr.ScValType.scvMap());
    const map = mVal.map()!;
    expect(map).toHaveLength(4);
    // Keys must be sorted: amount, deadline, released, released_amount
    expect(map[0].key().sym().toString()).toBe("amount");
    expect(map[1].key().sym().toString()).toBe("deadline");
    expect(map[2].key().sym().toString()).toBe("released");
    expect(map[3].key().sym().toString()).toBe("released_amount");
  });

  it("encodes milestonesToScVal as vector of maps", () => {
    const vecVal = milestonesToScVal([
      { amount: 50n, deadline: 100n },
      { amount: 150n, deadline: 200n },
    ]);
    expect(vecVal.switch()).toBe(xdr.ScValType.scvVec());
    expect(vecVal.vec()!).toHaveLength(2);
  });
});

describe("Contract argument builders", () => {
  it("buildFundArgs builds [scU64(escrowId)]", () => {
    const args = buildFundArgs(10n);
    expect(args).toHaveLength(1);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
  });

  it("buildReleaseMilestoneArgs builds [scU64, scU32]", () => {
    const args = buildReleaseMilestoneArgs(10n, 2);
    expect(args).toHaveLength(2);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvU32());
    expect(args[1].u32()).toBe(2);
  });

  it("buildReleasePartialArgs builds [scU64, scU32, scI128]", () => {
    const args = buildReleasePartialArgs(10n, 1, 500n);
    expect(args).toHaveLength(3);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvU32());
    expect(args[2].switch()).toBe(xdr.ScValType.scvI128());
  });

  it("buildReclaimArgs builds [scU64]", () => {
    const args = buildReclaimArgs(10n);
    expect(args).toHaveLength(1);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
  });

  it("buildReclaimDisputeArgs builds [scU64]", () => {
    const args = buildReclaimDisputeArgs(10n);
    expect(args).toHaveLength(1);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
  });

  it("buildReclaimMilestoneArgs builds [scU64, scU32]", () => {
    // Distinct from the escrow-level refunds above: the milestone index must be
    // encoded as u32 or Soroban rejects the call before the body runs.
    const args = buildReclaimMilestoneArgs(10n, 3);
    expect(args).toHaveLength(2);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvU32());
    expect(args[1].u32()).toBe(3);
  });

  it("buildCancelArgs builds [scU64]", () => {
    const args = buildCancelArgs(10n);
    expect(args).toHaveLength(1);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
  });

  it("buildOpenDisputeArgs builds [scU64, scAddress]", () => {
    const args = buildOpenDisputeArgs(10n, TEST_ADDR_1);
    expect(args).toHaveLength(2);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvAddress());
  });

  it("buildReputationSubmitArgs builds [scAddress, scAddress, scU64, scU32]", () => {
    const args = buildReputationSubmitArgs(TEST_ADDR_1, TEST_ADDR_2, 5n, 5);
    expect(args).toHaveLength(4);
    expect(args[0].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[1].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[2].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[3].switch()).toBe(xdr.ScValType.scvU32());
  });

  it("buildRaiseArgs builds [scU64, scAddress, scAddress, scString]", () => {
    const args = buildRaiseArgs(5n, CONTRACT_ID, TEST_ADDR_1, "Unresponsive");
    expect(args).toHaveLength(4);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[2].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[3].switch()).toBe(xdr.ScValType.scvString());
  });

  it("buildApproveArgs builds [scU64, scAddress, scI128, scI128]", () => {
    const args = buildApproveArgs(1n, TEST_ADDR_1, 50n, 50n);
    expect(args).toHaveLength(4);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[2].switch()).toBe(xdr.ScValType.scvI128());
    expect(args[3].switch()).toBe(xdr.ScValType.scvI128());
  });

  it("buildArbitrateArgs builds [scU64, scI128, scI128]", () => {
    const args = buildArbitrateArgs(1n, 60n, 40n);
    expect(args).toHaveLength(3);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvI128());
    expect(args[2].switch()).toBe(xdr.ScValType.scvI128());
  });

  it("buildCreateArgs builds [scAddress, scAddress, scAddress, Vec, scU64]", () => {
    const args = buildCreateArgs({
      client: TEST_ADDR_1,
      freelancer: TEST_ADDR_2,
      token: CONTRACT_ID,
      milestones: [{ amount: 100n, deadline: 500n }],
      expiry: 1000n,
    });
    expect(args).toHaveLength(5);
    expect(args[0].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[1].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[2].switch()).toBe(xdr.ScValType.scvAddress());
    expect(args[3].switch()).toBe(xdr.ScValType.scvVec());
    expect(args[4].switch()).toBe(xdr.ScValType.scvU64());
  });

  it("buildUpdateMilestonesArgs builds [scU64, Vec]", () => {
    const args = buildUpdateMilestonesArgs({
      escrowId: 7n,
      milestones: [{ amount: 200n, deadline: 800n }],
    });
    expect(args).toHaveLength(2);
    expect(args[0].switch()).toBe(xdr.ScValType.scvU64());
    expect(args[1].switch()).toBe(xdr.ScValType.scvVec());
  });
});

describe("Error parsing and translation", () => {
  it("parses contract error codes from HostError string", () => {
    expect(parseContractErrorCode("HostError: Error(Contract, #2)")).toBe(2);
    expect(parseContractErrorCode("Error(Contract, #16)")).toBe(16);
    expect(parseContractErrorCode("Error(Contract,  #5)")).toBe(5);
    expect(parseContractErrorCode("Unknown error")).toBeNull();
  });

  it("translates known escrow error codes into friendly messages", () => {
    const translated = friendlyContractError("HostError: Error(Contract, #1)", ESCROW_ERROR_MESSAGES);
    expect(translated).toBe("This escrow could not be found.");
  });

  it("translates known dispute error codes", () => {
    const translated = friendlyContractError("HostError: Error(Contract, #5)", DISPUTE_ERROR_MESSAGES);
    expect(translated).toBe("A dispute has already been raised for this escrow.");
  });

  it("translates known reputation error codes", () => {
    const translated = friendlyContractError("HostError: Error(Contract, #5)", REPUTATION_ERROR_MESSAGES);
    expect(translated).toBe("You have already rated this job.");
  });

  it("passes unrecognized error strings through unmodified", () => {
    const msg = "HostError: Error(Contract, #999)";
    expect(friendlyContractError(msg, ESCROW_ERROR_MESSAGES)).toBe(msg);
  });
});

describe("Typed Contract Clients", () => {
  it("EscrowClient generates properly structured invocations", () => {
    const client = new EscrowClient(CONTRACT_ID);
    const inv = client.fund(42n);
    expect(inv.contractId).toBe(CONTRACT_ID);
    expect(inv.method).toBe("fund");
    expect(inv.args).toHaveLength(1);

    const relInv = client.releaseMilestone(42n, 0);
    expect(relInv.method).toBe("release_milestone");
    expect(relInv.args).toHaveLength(2);

    const reclaimInv = client.reclaimMilestone(42n, 1);
    expect(reclaimInv.method).toBe("reclaim_milestone");
    expect(reclaimInv.args).toHaveLength(2);

    const cancelInv = client.cancel(42n);
    expect(cancelInv.method).toBe("cancel");
    expect(cancelInv.args).toHaveLength(1);
  });

  it("DisputeClient generates properly structured invocations", () => {
    const client = new DisputeClient(CONTRACT_ID);
    const inv = client.arbitrate(1n, 50n, 50n);
    expect(inv.contractId).toBe(CONTRACT_ID);
    expect(inv.method).toBe("arbitrate");
    expect(inv.args).toHaveLength(3);
  });

  it("ReputationClient generates properly structured invocations", () => {
    const client = new ReputationClient(CONTRACT_ID);
    const inv = client.submit(TEST_ADDR_1, TEST_ADDR_2, 10n, 5);
    expect(inv.contractId).toBe(CONTRACT_ID);
    expect(inv.method).toBe("submit");
    expect(inv.args).toHaveLength(4);
  });
});
