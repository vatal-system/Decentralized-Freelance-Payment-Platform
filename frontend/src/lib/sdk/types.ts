/**
 * Types mirroring the on-chain Soroban contracts in contracts/
 * (interface, escrow, dispute, reputation).
 */

import type { xdr } from "@stellar/stellar-sdk";

export enum EscrowStatus {
  Created = "Created",
  Active = "Active",
  Completed = "Completed",
  Disputed = "Disputed",
  Refunded = "Refunded",
  Cancelled = "Cancelled",
}

export enum DisputeStatus {
  Raised = "Raised",
  UnderReview = "UnderReview",
  Resolved = "Resolved",
}

export interface Milestone {
  amount: bigint;
  released: boolean;
  releasedAmount: bigint;
  deadline: bigint;
}

export interface MilestoneArg {
  amount: bigint;
  deadline: bigint;
  released?: boolean;
  releasedAmount?: bigint;
}

export interface EscrowData {
  client: string;
  freelancer: string;
  token: string;
  totalAmount: bigint;
  milestones: Milestone[];
  status: EscrowStatus;
  createdAt: bigint;
  expiry: bigint;
}

export interface DisputeData {
  escrowId: bigint;
  escrowContract: string;
  raisedBy: string;
  reason: string;
  status: DisputeStatus;
  raisedAt: bigint;
  clientShare: bigint;
  freelancerShare: bigint;
}

export interface DisputeProposal {
  clientShare: bigint;
  freelancerShare: bigint;
}

export interface Rating {
  rater: string;
  ratee: string;
  escrowId: bigint;
  score: number;
  submittedAt: bigint;
}

export interface ReputationAggregate {
  totalScore: bigint;
  weight: bigint;
  count: bigint;
}

export interface CreateArgsInput {
  client: string;
  freelancer: string;
  token: string;
  milestones: MilestoneArg[];
  expiry: bigint;
}

export interface UpdateMilestonesArgsInput {
  escrowId: bigint;
  milestones: MilestoneArg[];
}

export type MilestoneBatchOp =
  | { type: "add"; amount: number | bigint; deadline?: number | bigint; description?: string }
  | { type: "remove"; index: number }
  | { type: "edit"; index: number; amount: number | bigint; deadline?: number | bigint; description?: string };

export interface ContractEventLike {
  id?: string;
  ledger: number;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  txHash?: string;
  ledgerClosedAt?: string;
}

export type ContractType = "escrow" | "dispute" | "reputation";

export enum EscrowErrorCode {
  NotFound = 1,
  InvalidStatus = 2,
  Unauthorized = 3,
  MilestoneAlreadyReleased = 4,
  MilestoneIndexOutOfBounds = 5,
  NotExpired = 6,
  ZeroAmount = 7,
  InvalidMilestones = 8,
  InvalidExpiry = 9,
  InvalidCounterparty = 10,
  AlreadyInitialized = 11,
  NotInitialized = 12,
  InvalidShares = 13,
  Overflow = 14,
  AmountExceedsMilestone = 15,
  DisputeTimeoutNotReached = 16,
  TooManyMilestones = 17,
  InvalidDisputeTimeout = 18,
  Paused = 19,
  NoPendingDisputeContract = 20,
  DisputeContractTimelockActive = 21,
  InvalidDisputeContract = 22,
}

export enum DisputeErrorCode {
  NotFound = 1,
  AlreadyInitialized = 2,
  NotInitialized = 3,
  InvalidStatus = 4,
  AlreadyRaised = 5,
  EscrowNotFound = 6,
  EscrowNotDisputed = 7,
  Unauthorized = 8,
  InvalidResolution = 9,
  Overflow = 10,
  InvalidPanel = 11,
  InvalidThreshold = 12,
  InsufficientApprovals = 13,
  Paused = 14,
}

export enum ReputationErrorCode {
  NotFound = 1,
  AlreadyInitialized = 2,
  NotInitialized = 3,
  InvalidScore = 4,
  AlreadyRated = 5,
  EscrowNotFound = 6,
  JobNotCompleted = 7,
  Unauthorized = 8,
  InvalidRatee = 9,
  Overflow = 10,
}
