//! Reputation Contract
//!
//! Records on-chain ratings after each completed job.
//! Ratings are immutable once submitted and keyed by `(rater, escrow_id)` to
//! prevent duplicates.
//!
//! # Contributor Notes
//! - A rating is only accepted if the escrow contract reports the job as
//!   `Completed` and the rater/ratee are the two participants. This contract
//!   therefore depends on the `escrow` crate for its generated client.
//! - Phase 2 (see `docs/wave-issues`): weighted score decay, anti-spam.
//! - Phase 3 (see `docs/wave-issues`): skill-tag endorsements.

#![no_std]

use interface::{EscrowClient, EscrowData, EscrowStatus};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env,
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
pub struct Rating {
    pub rater: Address,
    pub ratee: Address,
    pub escrow_id: u64,
    pub score: u32, // 1–5
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub struct Aggregate {
    pub total_score: u64,
    pub count: u64,
}

#[contracttype]
pub enum DataKey {
    /// Keyed by (rater, escrow_id) to prevent duplicate ratings.
    Rating(Address, u64),
    /// Aggregate: (ratee) → (total_score, count).
    Aggregate(Address),
    Admin,
    EscrowContract,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Rated {
    #[topic]
    pub escrow_id: u64,
    pub rater: Address,
    pub ratee: Address,
    pub score: u32,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReputationError {
    NotFound = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    InvalidScore = 4,
    AlreadyRated = 5,
    EscrowNotFound = 6,
    EscrowNotCompleted = 7,
    Unauthorized = 8,
    InvalidRatee = 9,
    Overflow = 10,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// One-time initialisation: set the admin and the trusted escrow contract.
    pub fn init(env: Env, admin: Address, escrow_contract: Address) -> Result<(), ReputationError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ReputationError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &escrow_contract);
        Self::extend_instance(&env);
        Ok(())
    }

    /// Submit a rating after a job completes.
    ///
    /// Verifies with the escrow contract that the job is completed and that the
    /// rater and ratee are its two participants.
    ///
    /// # Arguments
    /// - `rater`     – address submitting the rating (must be a participant)
    /// - `ratee`     – address being rated (must be the other participant)
    /// - `escrow_id` – completed escrow this rating is for
    /// - `score`     – 1 to 5
    pub fn submit(
        env: Env,
        rater: Address,
        ratee: Address,
        escrow_id: u64,
        score: u32,
    ) -> Result<(), ReputationError> {
        rater.require_auth();

        if !(1..=5).contains(&score) {
            return Err(ReputationError::InvalidScore);
        }

        let escrow_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .ok_or(ReputationError::NotInitialized)?;

        // `try_*` returns a nested Result: the outer for invocation/conversion
        // failures and the inner for the contract's own Result error.
        let escrow: EscrowData = EscrowClient::new(&env, &escrow_contract)
            .try_get(&escrow_id)
            .map_err(|_| ReputationError::EscrowNotFound)?
            .map_err(|_| ReputationError::EscrowNotFound)?;
        if escrow.status != EscrowStatus::Completed {
            return Err(ReputationError::EscrowNotCompleted);
        }

        // The rater must be one participant and the ratee the other.
        let expected_ratee = if rater == escrow.client {
            escrow.freelancer.clone()
        } else if rater == escrow.freelancer {
            escrow.client.clone()
        } else {
            return Err(ReputationError::Unauthorized);
        };
        if ratee != expected_ratee {
            return Err(ReputationError::InvalidRatee);
        }

        let key = DataKey::Rating(rater.clone(), escrow_id);
        if env.storage().persistent().has(&key) {
            return Err(ReputationError::AlreadyRated);
        }

        let rating = Rating {
            rater: rater.clone(),
            ratee: ratee.clone(),
            escrow_id,
            score,
            submitted_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&key, &rating);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        // Update aggregate for the ratee.
        let agg_key = DataKey::Aggregate(ratee.clone());
        let mut agg: Aggregate = env
            .storage()
            .persistent()
            .get(&agg_key)
            .unwrap_or(Aggregate {
                total_score: 0,
                count: 0,
            });
        agg.total_score = agg
            .total_score
            .checked_add(score as u64)
            .ok_or(ReputationError::Overflow)?;
        agg.count = agg.count.checked_add(1).ok_or(ReputationError::Overflow)?;
        env.storage().persistent().set(&agg_key, &agg);
        env.storage()
            .persistent()
            .extend_ttl(&agg_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Self::extend_instance(&env);

        Rated {
            escrow_id,
            rater,
            ratee,
            score,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns (total_score, count). Average = total_score / count.
    pub fn get_aggregate(env: Env, address: Address) -> Aggregate {
        env.storage()
            .persistent()
            .get(&DataKey::Aggregate(address))
            .unwrap_or(Aggregate {
                total_score: 0,
                count: 0,
            })
    }

    /// Read a single rating (view).
    pub fn get_rating(env: Env, rater: Address, escrow_id: u64) -> Result<Rating, ReputationError> {
        env.storage()
            .persistent()
            .get(&DataKey::Rating(rater, escrow_id))
            .ok_or(ReputationError::NotFound)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
