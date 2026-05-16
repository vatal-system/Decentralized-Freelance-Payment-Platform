//! Dispute Contract
//!
//! Manages dispute resolution for frozen escrows.
//!
//! # Resolution Flow
//!
//!   open_dispute (escrow contract) → raise (here) → arbitrate → escrow.resolve()
//!
//! # Contributor Notes
//! - Phase 1: simple admin arbitration (single trusted arbitrator address).
//! - Phase 2 (TODO): multi-sig arbitration panel (3-of-5 vote).
//! - Phase 3 (TODO): on-chain reputation-weighted jury pool.
//! - The arbitrator address should be upgradeable via governance.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DisputeStatus {
    Raised,
    UnderReview,
    Resolved,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeData {
    pub escrow_id: u64,
    pub escrow_contract: Address,
    pub raised_by: Address,
    pub reason: String,
    pub status: DisputeStatus,
    pub raised_at: u64,
}

#[contracttype]
pub enum DataKey {
    Dispute(u64),
    Counter,
    Arbitrator,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct DisputeContract;

#[contractimpl]
impl DisputeContract {
    /// One-time initialisation: set the trusted arbitrator address.
    pub fn init(env: Env, arbitrator: Address) {
        assert!(
            !env.storage().instance().has(&DataKey::Arbitrator),
            "already initialized"
        );
        env.storage().instance().set(&DataKey::Arbitrator, &arbitrator);
    }

    /// Raise a dispute for a frozen escrow.
    ///
    /// Returns the dispute ID.
    pub fn raise(
        env: Env,
        escrow_id: u64,
        escrow_contract: Address,
        raised_by: Address,
        reason: String,
    ) -> u64 {
        raised_by.require_auth();

        let id = Self::next_id(&env);
        let dispute = DisputeData {
            escrow_id,
            escrow_contract,
            raised_by,
            reason,
            status: DisputeStatus::Raised,
            raised_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Dispute(id), &dispute);
        id
    }

    /// Arbitrator resolves the dispute and triggers fund distribution.
    ///
    /// # Arguments
    /// - `client_share`     – portion returned to client (0 if full freelancer win)
    /// - `freelancer_share` – portion paid to freelancer (0 if full client win)
    pub fn arbitrate(
        env: Env,
        dispute_id: u64,
        client_share: i128,
        freelancer_share: i128,
    ) {
        let arbitrator: Address = env
            .storage()
            .instance()
            .get(&DataKey::Arbitrator)
            .expect("not initialized");
        arbitrator.require_auth();

        let mut dispute: DisputeData = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .expect("dispute not found");

        assert!(dispute.status == DisputeStatus::Raised || dispute.status == DisputeStatus::UnderReview);

        dispute.status = DisputeStatus::Resolved;
        env.storage().persistent().set(&DataKey::Dispute(dispute_id), &dispute);

        // Cross-contract call: tell the escrow contract to distribute funds
        // TODO: import escrow contract client and call resolve()
        // escrow_client::Client::new(&env, &dispute.escrow_contract)
        //     .resolve(&dispute.escrow_id, &env.current_contract_address(), &client_share, &freelancer_share);
        let _ = (client_share, freelancer_share); // placeholder until cross-contract call is wired
    }

    pub fn get(env: Env, dispute_id: u64) -> DisputeData {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(dispute_id))
            .expect("dispute not found")
    }

    fn next_id(env: &Env) -> u64 {
        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0u64);
        env.storage().instance().set(&DataKey::Counter, &(id + 1));
        id
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_raise_and_arbitrate() {
        // TODO: init contract, raise dispute, arbitrate, assert status Resolved.
        let _env = Env::default();
    }
}
