//! Reputation Contract
//!
//! Records on-chain ratings after each completed job.
//! Ratings are immutable once submitted and tied to the escrow ID to prevent
//! duplicate submissions.
//!
//! # Contributor Notes
//! - Phase 1: simple 1–5 star rating stored per (rater, escrow_id) pair.
//! - Phase 2 (TODO): weighted score decay (recent jobs count more).
//! - Phase 3 (TODO): skill-tag endorsements.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub struct Rating {
    pub rater: Address,
    pub ratee: Address,
    pub escrow_id: u64,
    pub score: u32, // 1–5
    pub submitted_at: u64,
}

#[contracttype]
pub enum DataKey {
    /// Keyed by (rater, escrow_id) to prevent duplicate ratings
    Rating(Address, u64),
    /// Aggregate: (address) → (total_score, count)
    Aggregate(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct Aggregate {
    pub total_score: u64,
    pub count: u64,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Submit a rating after a job completes.
    ///
    /// Only the client or freelancer of the escrow may rate the other party.
    /// Caller must pass the escrow_contract address so this contract can verify
    /// the escrow is Completed and the rater is a participant.
    ///
    /// # Arguments
    /// - `rater`           – address submitting the rating
    /// - `ratee`           – address being rated
    /// - `escrow_id`       – completed escrow this rating is for
    /// - `score`           – 1 to 5
    pub fn submit(
        env: Env,
        rater: Address,
        ratee: Address,
        escrow_id: u64,
        score: u32,
    ) {
        rater.require_auth();
        assert!(score >= 1 && score <= 5, "score must be 1-5");

        let key = DataKey::Rating(rater.clone(), escrow_id);
        assert!(
            !env.storage().persistent().has(&key),
            "already rated this escrow"
        );

        // TODO: cross-contract call to escrow contract to verify:
        //   1. escrow.status == Completed
        //   2. rater is client or freelancer
        //   3. ratee is the other party

        let rating = Rating {
            rater: rater.clone(),
            ratee: ratee.clone(),
            escrow_id,
            score,
            submitted_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&key, &rating);

        // Update aggregate
        let agg_key = DataKey::Aggregate(ratee);
        let mut agg: Aggregate = env
            .storage()
            .persistent()
            .get(&agg_key)
            .unwrap_or(Aggregate { total_score: 0, count: 0 });
        agg.total_score += score as u64;
        agg.count += 1;
        env.storage().persistent().set(&agg_key, &agg);
    }

    /// Returns (total_score, count). Average = total_score / count.
    pub fn get_aggregate(env: Env, address: Address) -> Aggregate {
        env.storage()
            .persistent()
            .get(&DataKey::Aggregate(address))
            .unwrap_or(Aggregate { total_score: 0, count: 0 })
    }

    pub fn get_rating(env: Env, rater: Address, escrow_id: u64) -> Rating {
        env.storage()
            .persistent()
            .get(&DataKey::Rating(rater, escrow_id))
            .expect("rating not found")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_submit_and_aggregate() {
        // TODO: submit two ratings for the same ratee, assert aggregate totals.
        let _env = Env::default();
    }

    #[test]
    fn test_duplicate_rating_rejected() {
        // TODO: submit same (rater, escrow_id) twice, assert panic.
        let _env = Env::default();
    }
}
