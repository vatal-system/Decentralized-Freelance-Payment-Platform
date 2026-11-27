import type { xdr } from "@stellar/stellar-sdk";
import {
  buildCancelArgs,
  buildCreateArgs,
  buildFundArgs,
  buildOpenDisputeArgs,
  buildReclaimArgs,
  buildReclaimDisputeArgs,
  buildReclaimMilestoneArgs,
  buildReleaseMilestoneArgs,
  buildReleasePartialArgs,
  buildUpdateMilestonesArgs,
  buildRaiseArgs,
  buildApproveArgs,
  buildArbitrateArgs,
  buildReputationSubmitArgs,
} from "./builders";
import type { CreateArgsInput, UpdateMilestonesArgsInput } from "./types";

export interface ContractInvocation {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}

export class EscrowClient {
  constructor(public readonly contractId: string) {}

  create(input: CreateArgsInput): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "create",
      args: buildCreateArgs(input),
    };
  }

  fund(escrowId: number | bigint): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "fund",
      args: buildFundArgs(escrowId),
    };
  }

  releaseMilestone(escrowId: number | bigint, milestoneIndex: number): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "release_milestone",
      args: buildReleaseMilestoneArgs(escrowId, milestoneIndex),
    };
  }

  releasePartial(
    escrowId: number | bigint,
    milestoneIndex: number,
    amount: number | bigint,
  ): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "release_partial",
      args: buildReleasePartialArgs(escrowId, milestoneIndex, amount),
    };
  }

  reclaimExpired(escrowId: number | bigint): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "reclaim_expired",
      args: buildReclaimArgs(escrowId),
    };
  }

  reclaimAfterDisputeTimeout(escrowId: number | bigint): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "reclaim_after_dispute_timeout",
      args: buildReclaimDisputeArgs(escrowId),
    };
  }

  reclaimMilestone(escrowId: number | bigint, milestoneIndex: number): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "reclaim_milestone",
      args: buildReclaimMilestoneArgs(escrowId, milestoneIndex),
    };
  }

  cancel(escrowId: number | bigint): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "cancel",
      args: buildCancelArgs(escrowId),
    };
  }

  openDispute(escrowId: number | bigint, initiator: string): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "open_dispute",
      args: buildOpenDisputeArgs(escrowId, initiator),
    };
  }

  updateMilestones(input: UpdateMilestonesArgsInput): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "update_milestones",
      args: buildUpdateMilestonesArgs(input),
    };
  }
}

export class DisputeClient {
  constructor(public readonly contractId: string) {}

  raise(
    escrowId: number | bigint,
    escrowContract: string,
    raisedBy: string,
    reason: string,
  ): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "raise",
      args: buildRaiseArgs(escrowId, escrowContract, raisedBy, reason),
    };
  }

  approve(
    disputeId: number | bigint,
    arbitrator: string,
    clientShareBaseUnits: bigint,
    freelancerShareBaseUnits: bigint,
  ): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "approve",
      args: buildApproveArgs(disputeId, arbitrator, clientShareBaseUnits, freelancerShareBaseUnits),
    };
  }

  arbitrate(
    disputeId: number | bigint,
    clientShareBaseUnits: bigint,
    freelancerShareBaseUnits: bigint,
  ): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "arbitrate",
      args: buildArbitrateArgs(disputeId, clientShareBaseUnits, freelancerShareBaseUnits),
    };
  }
}

export class ReputationClient {
  constructor(public readonly contractId: string) {}

  submit(
    rater: string,
    ratee: string,
    escrowId: number | bigint,
    score: number,
  ): ContractInvocation {
    return {
      contractId: this.contractId,
      method: "submit",
      args: buildReputationSubmitArgs(rater, ratee, escrowId, score),
    };
  }
}
