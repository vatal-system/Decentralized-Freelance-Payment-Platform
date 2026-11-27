import type { xdr } from "@stellar/stellar-sdk";
import { scAddress, scI128, scString, scU32, scU64, milestonesToScVal } from "./scval";
import type { CreateArgsInput, UpdateMilestonesArgsInput } from "./types";

/** `escrow.fund(escrow_id: u64)` */
export function buildFundArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/** `escrow.release_milestone(escrow_id: u64, milestone_index: u32)` */
export function buildReleaseMilestoneArgs(
  escrowId: number | bigint,
  milestoneIndex: number,
): xdr.ScVal[] {
  return [scU64(escrowId), scU32(milestoneIndex)];
}

/** `escrow.release_partial(escrow_id: u64, milestone_index: u32, amount: i128)` */
export function buildReleasePartialArgs(
  escrowId: number | bigint,
  milestoneIndex: number,
  amount: number | bigint,
): xdr.ScVal[] {
  return [scU64(escrowId), scU32(milestoneIndex), scI128(amount)];
}

/** `escrow.reclaim_expired(escrow_id: u64)` */
export function buildReclaimArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/** `escrow.reclaim_after_dispute_timeout(escrow_id: u64)` */
export function buildReclaimDisputeArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/**
 * `escrow.reclaim_milestone(escrow_id: u64, milestone_index: u32)`
 *
 * Per-milestone reclaim of an overdue milestone, distinct from the two
 * escrow-level refunds above; the index must be `u32` explicitly.
 */
export function buildReclaimMilestoneArgs(
  escrowId: number | bigint,
  milestoneIndex: number,
): xdr.ScVal[] {
  return [scU64(escrowId), scU32(milestoneIndex)];
}

/** `escrow.cancel(escrow_id: u64)` */
export function buildCancelArgs(escrowId: number | bigint): xdr.ScVal[] {
  return [scU64(escrowId)];
}

/** `escrow.open_dispute(escrow_id: u64, initiator: Address)` */
export function buildOpenDisputeArgs(
  escrowId: number | bigint,
  initiator: string,
): xdr.ScVal[] {
  return [scU64(escrowId), scAddress(initiator)];
}

/** `reputation.submit(rater: Address, ratee: Address, escrow_id: u64, score: u32)` */
export function buildReputationSubmitArgs(
  rater: string,
  ratee: string,
  escrowId: number | bigint,
  score: number,
): xdr.ScVal[] {
  return [scAddress(rater), scAddress(ratee), scU64(escrowId), scU32(score)];
}

/** `dispute.raise(escrow_id: u64, escrow_contract: Address, raised_by: Address, reason: String)` */
export function buildRaiseArgs(
  escrowId: number | bigint,
  escrowContract: string,
  raisedBy: string,
  reason: string,
): xdr.ScVal[] {
  return [
    scU64(escrowId),
    scAddress(escrowContract),
    scAddress(raisedBy),
    scString(reason),
  ];
}

/** `dispute.approve(dispute_id: u64, arbitrator: Address, client_share: i128, freelancer_share: i128)` */
export function buildApproveArgs(
  disputeId: number | bigint,
  arbitrator: string,
  clientShareBaseUnits: bigint,
  freelancerShareBaseUnits: bigint,
): xdr.ScVal[] {
  return [
    scU64(disputeId),
    scAddress(arbitrator),
    scI128(clientShareBaseUnits),
    scI128(freelancerShareBaseUnits),
  ];
}

/** `dispute.arbitrate(dispute_id: u64, client_share: i128, freelancer_share: i128)` */
export function buildArbitrateArgs(
  disputeId: number | bigint,
  clientShareBaseUnits: bigint,
  freelancerShareBaseUnits: bigint,
): xdr.ScVal[] {
  return [
    scU64(disputeId),
    scI128(clientShareBaseUnits),
    scI128(freelancerShareBaseUnits),
  ];
}

/** `escrow.create(client: Address, freelancer: Address, token: Address, milestones: Vec<Milestone>, expiry: u64)` */
export function buildCreateArgs(input: CreateArgsInput): xdr.ScVal[] {
  return [
    scAddress(input.client),
    scAddress(input.freelancer),
    scAddress(input.token),
    milestonesToScVal(input.milestones),
    scU64(input.expiry),
  ];
}

/** `escrow.update_milestones(escrow_id: u64, milestones: Vec<Milestone>)` */
export function buildUpdateMilestonesArgs(input: UpdateMilestonesArgsInput): xdr.ScVal[] {
  return [
    scU64(input.escrowId),
    milestonesToScVal(input.milestones),
  ];
}
