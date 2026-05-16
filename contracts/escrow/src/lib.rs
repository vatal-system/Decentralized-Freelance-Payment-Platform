//! Escrow Contract
//!
//! Holds funds in escrow for a job between a client and freelancer.
//! Supports milestone-based releases and integrates with the dispute contract.
//!
//! # State Machine
//!
//!   Created → Funded → Active → Completed
//!                  ↘ Disputed → Resolved
//!                  ↘ Expired  → Refunded
//!
//! # Contributor Notes
//! - All token transfers use the Stellar Asset Contract (SAC) interface.
//! - Checks-Effects-Interactions pattern must be preserved in every state transition.
//! - Add new milestone logic inside `release_milestone`, not in `complete`.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum EscrowStatus {
    Created,
    Funded,
    Active,
    Completed,
    Disputed,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    pub amount: i128,
    pub released: bool,
    /// Unix timestamp after which the client may reclaim this milestone
    pub deadline: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowData {
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub total_amount: i128,
    pub milestones: Vec<Milestone>,
    pub status: EscrowStatus,
    pub created_at: u64,
    /// Safety timelock: if no activity by this timestamp, client can reclaim
    pub expiry: u64,
}

#[contracttype]
pub enum DataKey {
    Escrow(u64),
    Counter,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    NotFound = 1,
    InvalidStatus = 2,
    Unauthorized = 3,
    MilestoneAlreadyReleased = 4,
    MilestoneIndexOutOfBounds = 5,
    NotExpired = 6,
    ZeroAmount = 7,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Create a new escrow job.
    ///
    /// # Arguments
    /// - `client`      – party funding the job
    /// - `freelancer`  – party delivering the work
    /// - `token`       – SAC-compatible token address (e.g. USDC)
    /// - `milestones`  – ordered list of milestone amounts; must sum to total
    /// - `expiry`      – unix timestamp safety deadline
    ///
    /// Returns the new escrow ID.
    pub fn create(
        env: Env,
        client: Address,
        freelancer: Address,
        token: Address,
        milestones: Vec<Milestone>,
        expiry: u64,
    ) -> u64 {
        client.require_auth();

        // TODO: validate milestones sum > 0 and expiry > now
        let total_amount: i128 = milestones.iter().map(|m| m.amount).sum();

        let id = Self::next_id(&env);
        let escrow = EscrowData {
            client,
            freelancer,
            token,
            total_amount,
            milestones,
            status: EscrowStatus::Created,
            created_at: env.ledger().timestamp(),
            expiry,
        };
        env.storage().persistent().set(&DataKey::Escrow(id), &escrow);
        id
    }

    /// Client deposits funds, moving escrow to Funded → Active.
    pub fn fund(env: Env, escrow_id: u64) {
        let mut escrow: EscrowData = Self::load(&env, escrow_id);
        escrow.client.require_auth();

        assert!(escrow.status == EscrowStatus::Created, "invalid status");

        // Transfer total from client to this contract
        let client = escrow.client.clone();
        let amount = escrow.total_amount;
        token::Client::new(&env, &escrow.token).transfer(
            &client,
            &env.current_contract_address(),
            &amount,
        );

        escrow.status = EscrowStatus::Active;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
    }

    /// Client approves release of a specific milestone to the freelancer.
    pub fn release_milestone(env: Env, escrow_id: u64, milestone_index: u32) {
        let mut escrow: EscrowData = Self::load(&env, escrow_id);
        escrow.client.require_auth();

        assert!(escrow.status == EscrowStatus::Active, "invalid status");

        let idx = milestone_index as usize;
        // TODO: bounds-check idx against escrow.milestones.len()

        let mut milestone = escrow.milestones.get(milestone_index).unwrap();
        assert!(!milestone.released, "already released");

        // Effects before interaction
        milestone.released = true;
        escrow.milestones.set(milestone_index, milestone.clone());

        // Check if all milestones released → mark Completed
        let all_done = escrow.milestones.iter().all(|m| m.released);
        if all_done {
            escrow.status = EscrowStatus::Completed;
        }
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        // Interaction: pay freelancer
        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.freelancer,
            &milestone.amount,
        );
    }

    /// Either party can open a dispute, freezing the escrow.
    /// Dispute resolution is handled by the separate dispute contract.
    pub fn open_dispute(env: Env, escrow_id: u64, initiator: Address) {
        let mut escrow: EscrowData = Self::load(&env, escrow_id);
        initiator.require_auth();

        assert!(escrow.status == EscrowStatus::Active, "invalid status");
        assert!(
            initiator == escrow.client || initiator == escrow.freelancer,
            "unauthorized"
        );

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
    }

    /// Called by the dispute contract to resolve and distribute remaining funds.
    ///
    /// # Arguments
    /// - `client_share`     – amount returned to client
    /// - `freelancer_share` – amount sent to freelancer
    pub fn resolve(
        env: Env,
        escrow_id: u64,
        dispute_contract: Address,
        client_share: i128,
        freelancer_share: i128,
    ) {
        dispute_contract.require_auth();

        let mut escrow: EscrowData = Self::load(&env, escrow_id);
        assert!(escrow.status == EscrowStatus::Disputed, "invalid status");

        escrow.status = EscrowStatus::Completed;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        let token = token::Client::new(&env, &escrow.token);
        let contract_addr = env.current_contract_address();

        if client_share > 0 {
            token.transfer(&contract_addr, &escrow.client, &client_share);
        }
        if freelancer_share > 0 {
            token.transfer(&contract_addr, &escrow.freelancer, &freelancer_share);
        }
    }

    /// Refund client if escrow has passed its safety expiry with no completion.
    pub fn reclaim_expired(env: Env, escrow_id: u64) {
        let mut escrow: EscrowData = Self::load(&env, escrow_id);
        escrow.client.require_auth();

        assert!(
            escrow.status == EscrowStatus::Active,
            "invalid status"
        );
        assert!(
            env.ledger().timestamp() > escrow.expiry,
            "not expired"
        );

        // Calculate unreleased amount
        let unreleased: i128 = escrow
            .milestones
            .iter()
            .filter(|m| !m.released)
            .map(|m| m.amount)
            .sum();

        escrow.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        token::Client::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.client,
            &unreleased,
        );
    }

    /// Read escrow state (view).
    pub fn get(env: Env, escrow_id: u64) -> EscrowData {
        Self::load(&env, escrow_id)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn load(env: &Env, id: u64) -> EscrowData {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(id))
            .expect("escrow not found")
    }

    fn next_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0u64);
        env.storage().instance().set(&DataKey::Counter, &(id + 1));
        id
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{vec, Env};

    #[test]
    fn test_create_and_fund() {
        // TODO: register a mock token contract, call create() then fund(),
        // assert status == Active and contract token balance == total_amount.
        let _env = Env::default();
    }

    #[test]
    fn test_release_milestone() {
        // TODO: fund escrow, release milestone 0, assert freelancer balance.
        let _env = Env::default();
    }

    #[test]
    fn test_reclaim_expired() {
        // TODO: fund escrow, advance ledger past expiry, call reclaim_expired,
        // assert client balance restored.
        let _env = Env::default();
    }
}
