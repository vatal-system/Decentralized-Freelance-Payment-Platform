//! Dispute Contract
//!
//! Manages dispute resolution for frozen escrows.
//!
//! # Resolution Flow
//!
//!   escrow.open_dispute() → dispute.raise() → dispute.arbitrate() → escrow.resolve()
//!
//! # Contributor Notes
//! - Phase 1: single trusted arbitrator, set once via `init` (the arbitrator must
//!   authorize `init`, so the role cannot be sniped by a front-runner).
//! - `raise` cross-checks the escrow contract: the escrow must be in `Disputed`
//!   state and the initiator must be a participant.
//! - `arbitrate` cross-calls `escrow.resolve()`, which independently validates
//!   that the shares sum to the funds still held.
//! - See the `docs/wave-issues` backlog for multi-arbitrator / timelocked disputes.
//!
//! This crate depends on the `escrow` crate for its generated client so the two
//! contracts share one source of truth for the escrow types.

#![no_std]

use interface::{EscrowClient, EscrowData, EscrowStatus};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
};

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum DisputeStatus {
    Raised,
    UnderReview,
    Resolved,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub struct DisputeData {
    pub escrow_id: u64,
    pub escrow_contract: Address,
    pub raised_by: Address,
    pub reason: String,
    pub status: DisputeStatus,
    pub raised_at: u64,
    /// Distribution recorded when the dispute is resolved.
    pub client_share: i128,
    pub freelancer_share: i128,
}

#[contracttype]
pub enum DataKey {
    Dispute(u64),
    Counter,
    Arbitrator,
    /// escrow_id → dispute_id, to prevent duplicate disputes per escrow.
    EscrowDispute(u64),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Raised {
    #[topic]
    pub escrow_id: u64,
    pub dispute_id: u64,
    pub raised_by: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeResolved {
    #[topic]
    pub escrow_id: u64,
    pub dispute_id: u64,
    pub client_share: i128,
    pub freelancer_share: i128,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DisputeError {
    NotFound = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    InvalidStatus = 4,
    AlreadyRaised = 5,
    EscrowNotFound = 6,
    EscrowNotDisputed = 7,
    Unauthorized = 8,
    EscrowRejected = 9,
    Overflow = 10,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DisputeContract;

#[contractimpl]
impl DisputeContract {
    /// One-time initialisation: set the trusted arbitrator address.
    ///
    /// The arbitrator must sign, so a third party cannot take over the role by
    /// calling `init` first on a freshly deployed contract.
    pub fn init(env: Env, arbitrator: Address) -> Result<(), DisputeError> {
        arbitrator.require_auth();
        if env.storage().instance().has(&DataKey::Arbitrator) {
            return Err(DisputeError::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&DataKey::Arbitrator, &arbitrator);
        Self::extend_instance(&env);
        Ok(())
    }

    /// Raise a dispute for a frozen escrow.
    ///
    /// Verifies against the escrow contract that the escrow is `Disputed` and the
    /// caller is a participant. Returns the dispute ID.
    pub fn raise(
        env: Env,
        escrow_id: u64,
        escrow_contract: Address,
        raised_by: Address,
        reason: String,
    ) -> Result<u64, DisputeError> {
        raised_by.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::EscrowDispute(escrow_id))
        {
            return Err(DisputeError::AlreadyRaised);
        }

        // Cross-contract: confirm the escrow is disputed and the caller is a party.
        // `try_*` returns a nested Result: the outer for invocation/conversion
        // failures and the inner for the contract's own Result error.
        let escrow: EscrowData = EscrowClient::new(&env, &escrow_contract)
            .try_get(&escrow_id)
            .map_err(|_| DisputeError::EscrowNotFound)?
            .map_err(|_| DisputeError::EscrowNotFound)?;
        if escrow.status != EscrowStatus::Disputed {
            return Err(DisputeError::EscrowNotDisputed);
        }
        if raised_by != escrow.client && raised_by != escrow.freelancer {
            return Err(DisputeError::Unauthorized);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64);
        let next = id.checked_add(1).ok_or(DisputeError::Overflow)?;
        env.storage().instance().set(&DataKey::Counter, &next);

        let dispute = DisputeData {
            escrow_id,
            escrow_contract: escrow_contract.clone(),
            raised_by,
            reason,
            status: DisputeStatus::Raised,
            raised_at: env.ledger().timestamp(),
            client_share: 0,
            freelancer_share: 0,
        };
        Self::save(&env, id, &dispute);
        env.storage()
            .persistent()
            .set(&DataKey::EscrowDispute(escrow_id), &id);
        env.storage().persistent().extend_ttl(
            &DataKey::EscrowDispute(escrow_id),
            TTL_THRESHOLD,
            TTL_EXTEND_TO,
        );

        Raised {
            escrow_id,
            dispute_id: id,
            raised_by: dispute.raised_by.clone(),
        }
        .publish(&env);
        Ok(id)
    }

    /// Arbitrator resolves the dispute and triggers fund distribution.
    ///
    /// # Arguments
    /// - `client_share`     – portion returned to client (0 if a full freelancer win)
    /// - `freelancer_share` – portion paid to freelancer (0 if a full client win)
    pub fn arbitrate(
        env: Env,
        dispute_id: u64,
        client_share: i128,
        freelancer_share: i128,
    ) -> Result<(), DisputeError> {
        let arbitrator: Address = env
            .storage()
            .instance()
            .get(&DataKey::Arbitrator)
            .ok_or(DisputeError::NotInitialized)?;
        arbitrator.require_auth();

        let mut dispute = Self::load(&env, dispute_id)?;
        if dispute.status != DisputeStatus::Raised && dispute.status != DisputeStatus::UnderReview {
            return Err(DisputeError::InvalidStatus);
        }

        // Effects before interaction.
        dispute.status = DisputeStatus::Resolved;
        dispute.client_share = client_share;
        dispute.freelancer_share = freelancer_share;
        Self::save(&env, dispute_id, &dispute);

        // Interaction: escrow validates the shares sum to the funds it holds.
        EscrowClient::new(&env, &dispute.escrow_contract)
            .try_resolve(&dispute.escrow_id, &client_share, &freelancer_share)
            .map_err(|_| DisputeError::EscrowRejected)?
            .map_err(|_| DisputeError::EscrowRejected)?;

        DisputeResolved {
            escrow_id: dispute.escrow_id,
            dispute_id,
            client_share,
            freelancer_share,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a dispute (view).
    pub fn get(env: Env, dispute_id: u64) -> Result<DisputeData, DisputeError> {
        Self::load(&env, dispute_id)
    }

    /// Read the dispute ID for an escrow, if any (view).
    pub fn dispute_for(env: Env, escrow_id: u64) -> Result<u64, DisputeError> {
        env.storage()
            .persistent()
            .get(&DataKey::EscrowDispute(escrow_id))
            .ok_or(DisputeError::NotFound)
    }

    /// Read the configured arbitrator (view).
    pub fn arbitrator(env: Env) -> Result<Address, DisputeError> {
        env.storage()
            .instance()
            .get(&DataKey::Arbitrator)
            .ok_or(DisputeError::NotInitialized)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn load(env: &Env, id: u64) -> Result<DisputeData, DisputeError> {
        let dispute: DisputeData = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(id))
            .ok_or(DisputeError::NotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Dispute(id), TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(dispute)
    }

    fn save(env: &Env, id: u64, dispute: &DisputeData) {
        let key = DataKey::Dispute(id);
        env.storage().persistent().set(&key, dispute);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Self::extend_instance(env);
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
