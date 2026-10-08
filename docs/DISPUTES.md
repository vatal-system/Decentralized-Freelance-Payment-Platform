# Dispute resolution design

How a frozen escrow gets unfrozen: a panel of arbitrators rules by majority, with
a timelock escape hatch if they never do.

## Actors

- **Panel** — a list of arbitrator addresses, set once at `dispute.init`.
  `threshold` (M) of the N panel members must approve a resolution.
- **Parties** — the escrow's client and freelancer. Either may `raise` a dispute.
- **Escrow contract** — holds the funds and is the only contract that can move
  them; `escrow.resolve` is callable **only** by the registered dispute contract.

## Flow

```
1. Either party calls  escrow.open_dispute(escrow_id, initiator)
     → escrow status: Active → Disputed
     → records a dispute deadline (now + 7 days)

2. Either party calls  dispute.raise(escrow_id, escrow_contract, raised_by, reason)
     → verifies via escrow that the escrow is Disputed and raised_by is a party

3. At least `threshold` panel members call
       dispute.approve(dispute_id, arbitrator, client_share, freelancer_share)
     → each approval is authenticated by that arbitrator and bound to a split

4. Anyone calls       dispute.arbitrate(dispute_id, client_share, freelancer_share)
     → counts approvals matching exactly that split; needs >= threshold
     → escrow.resolve(escrow_id, client_share, freelancer_share)
         → escrow checks the shares sum to the funds still held, then pays out
         → escrow status: Disputed → Completed

   …or, if the panel never rules:

5. The client calls   escrow.reclaim_after_dispute_timeout(escrow_id)
     → only after the dispute deadline, only while Disputed
     → refunds the unreleased funds; escrow status: Disputed → Refunded
```

## Why these choices

- **Approvals are bound to a split.** Approving just "a resolution" would let any
  observer call `arbitrate` with arbitrary shares. Instead each `approve` records
  `(client_share, freelancer_share)` for that arbitrator, and `arbitrate` only
  counts approvals that match the split being executed. An arbitrator can change
  their vote by approving again.
- **`resolve` is unchanged and still independent.** It checks the shares sum to
  the escrow's remaining balance and that the caller is the registered dispute
  contract, so a compromised or buggy dispute contract cannot over- or under-pay.
- **`init` needs every panel member's signature.** This prevents an attacker from
  front-running a fresh deployment to install themselves as an arbitrator.
- **Timelock is a genuine escape hatch.** `reclaim_after_dispute_timeout` only
  fires after the deadline, only from `Disputed`, and moves the escrow to
  `Refunded`. A late ruling then fails `escrow.resolve`'s status check, so funds
  cannot be paid out twice.

## Residual risks

- The panel is a **trusted set**, not sybil-resistant. Their selection is an
  off-chain governance concern.
- There is no slashing or bonding for arbitrators who approve a bad split.
- The timelock is measured from `open_dispute` and is not extendable; a panel
  that needs more time must rule before the deadline or the client can reclaim.

Constants live in `contracts/escrow/src/lib.rs` (`DISPUTE_TIMEOUT_SECONDS`).
