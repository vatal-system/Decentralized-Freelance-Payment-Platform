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
//! - Raw ratings are stored unchanged; `get_aggregate` derives a **weighted**
//!   view from them (see `docs/REPUTATION.md`):
//!     * each rating is weighted by the escrow's `total_amount`,
//!     * only the first rating from a given rater counts (anti-spam),
//!     * `weight` is the sum of weights and `total_score` the weight-summed
//!       score, so `average = total_score / weight`.
//! - Phase 3 (see `docs/wave-issues`): skill-tag endorsements.

#![no_std]

use interface::{EscrowClient, EscrowData, EscrowStatus};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Vec,
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

/// Weighted reputation for an address.
///
/// `average = total_score / weight` (0 when `weight` is 0). `count` is the
/// number of ratings that counted toward the aggregate.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub struct Aggregate {
    pub total_score: u64,
    pub weight: u64,
    pub count: u64,
}

#[contracttype]
pub enum DataKey {
    /// Keyed by (rater, escrow_id) to prevent duplicate ratings.
    Rating(Address, u64),
    /// Ratee → the (rater, escrow_id) pairs that have rated them.
    RateeRaters(Address),
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
    /// The ratee's weighted-aggregate count after this rating is recorded.
    pub count: u64,
    /// The ratee's weighted-aggregate total_score after this rating is recorded.
    pub total_score: u64,
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
    /// rater and ratee are its two participants. The raw rating is stored as-is;
    /// weighting happens in [`get_aggregate`].
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

        // Index the (rater, escrow) pair under the ratee so the aggregate can be
        // derived without scanning all ratings.
        let index_key = DataKey::RateeRaters(ratee.clone());
        let mut raters: Vec<(Address, u64)> = env
            .storage()
            .persistent()
            .get(&index_key)
            .unwrap_or(Vec::new(&env));
        let already_indexed = raters
            .iter()
            .any(|entry| entry.0 == rater && entry.1 == escrow_id);
        if !already_indexed {
            raters.push_back((rater.clone(), escrow_id));
        }
        env.storage().persistent().set(&index_key, &raters);
        env.storage()
            .persistent()
            .extend_ttl(&index_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Self::extend_instance(&env);

        let aggregate = Self::get_aggregate(env.clone(), ratee.clone());
        Rated {
            escrow_id,
            rater,
            ratee,
            score,
            count: aggregate.count,
            total_score: aggregate.total_score,
        }
        .publish(&env);
        Ok(())
    }

    /// Weighted reputation for `address`.
    ///
    /// Each counted rating is weighted by its escrow's `total_amount`; only the
    /// first rating from a given rater counts (anti-spam). Averaging is
    /// `total_score / weight`. Raw ratings are never modified.
    pub fn get_aggregate(env: Env, address: Address) -> Aggregate {
        let entries: Vec<(Address, u64)> = env
            .storage()
            .persistent()
            .get(&DataKey::RateeRaters(address))
            .unwrap_or(Vec::new(&env));
        let escrow_contract: Option<Address> =
            env.storage().instance().get(&DataKey::EscrowContract);

        let mut total_score: u64 = 0;
        let mut weight: u64 = 0;
        let mut count: u64 = 0;
        let mut seen: Vec<Address> = Vec::new(&env);

        for entry in entries.iter() {
            let (rater, escrow_id) = entry;

            // Anti-spam: at most one rating per (rater, ratee) pair counts.
            if seen.iter().any(|seen_rater| seen_rater == rater) {
                continue;
            }
            seen.push_back(rater.clone());

            let rating: Option<Rating> = env
                .storage()
                .persistent()
                .get(&DataKey::Rating(rater.clone(), escrow_id));
            let Some(rating) = rating else {
                continue;
            };

            // Weight by the size of the job; unreadable escrows contribute 0.
            let escrow_weight = match &escrow_contract {
                Some(contract) => Self::escrow_total(&env, contract, escrow_id),
                None => 0,
            };
            if escrow_weight == 0 {
                continue;
            }

            total_score =
                total_score.saturating_add((rating.score as u64).saturating_mul(escrow_weight));
            weight = weight.saturating_add(escrow_weight);
            count = count.saturating_add(1);
        }

        Aggregate {
            total_score,
            weight,
            count,
        }
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

    /// The escrow's total amount, or 0 if it cannot be read / is not positive.
    fn escrow_total(env: &Env, escrow_contract: &Address, escrow_id: u64) -> u64 {
        let escrow = EscrowClient::new(env, escrow_contract)
            .try_get(&escrow_id)
            .ok()
            .and_then(|inner| inner.ok());
        match escrow {
            Some(data) => data.total_amount.try_into().unwrap_or(0),
            None => 0,
        }
    }

    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
