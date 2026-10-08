//! Unit tests for the reputation contract.
//!
//! Deploys a real escrow contract so the "job must be completed" and
//! "caller must be a participant" checks are exercised for real.

#![cfg(test)]

use crate::{ReputationContract, ReputationContractClient, ReputationError};
use escrow::{EscrowContract, EscrowContractClient, Milestone};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

struct Fx {
    env: Env,
    escrow: Address,
    reputation: Address,
    client: Address,
    freelancer: Address,
    token: Address,
}

fn milestones(env: &Env, amounts: &[i128]) -> Vec<Milestone> {
    let mut v = Vec::new(env);
    for a in amounts {
        v.push_back(Milestone {
            amount: *a,
            released: false,
            deadline: 0,
        });
    }
    v
}

fn setup() -> Fx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&client, &10_000);

    let escrow = env.register(EscrowContract, ());
    let reputation = env.register(ReputationContract, ());
    EscrowContractClient::new(&env, &escrow).init(&admin, &escrow);
    ReputationContractClient::new(&env, &reputation).init(&admin, &escrow);

    Fx {
        env,
        escrow,
        reputation,
        client,
        freelancer,
        token,
    }
}

impl Fx {
    fn escrow_client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }
    fn rep_client(&self) -> ReputationContractClient<'_> {
        ReputationContractClient::new(&self.env, &self.reputation)
    }

    fn funded(&self) -> u64 {
        let ec = self.escrow_client();
        let id = ec.create(
            &self.client,
            &self.freelancer,
            &self.token,
            &milestones(&self.env, &[1_000]),
            &10_000,
        );
        ec.fund(&id);
        id
    }

    fn completed(&self) -> u64 {
        let id = self.funded();
        self.escrow_client().release_milestone(&id, &0);
        id
    }
}

#[test]
fn submit_before_completion_is_rejected() {
    let f = setup();
    let id = f.funded();
    let res = f.rep_client().try_submit(&f.client, &f.freelancer, &id, &5);
    assert!(matches!(res, Err(Ok(ReputationError::EscrowNotCompleted))));
}

#[test]
fn submit_unknown_escrow_is_rejected() {
    let f = setup();
    let res = f
        .rep_client()
        .try_submit(&f.client, &f.freelancer, &404, &5);
    assert!(matches!(res, Err(Ok(ReputationError::EscrowNotFound))));
}

#[test]
fn submit_with_invalid_score_is_rejected() {
    let f = setup();
    let id = f.completed();
    for score in [0u32, 6, 100] {
        let res = f
            .rep_client()
            .try_submit(&f.client, &f.freelancer, &id, &score);
        assert!(
            matches!(res, Err(Ok(ReputationError::InvalidScore))),
            "score {score} must be rejected"
        );
    }
}

#[test]
fn submit_by_non_participant_is_rejected() {
    let f = setup();
    let id = f.completed();
    let stranger = Address::generate(&f.env);
    let res = f.rep_client().try_submit(&stranger, &f.freelancer, &id, &5);
    assert!(matches!(res, Err(Ok(ReputationError::Unauthorized))));
}

#[test]
fn submit_with_wrong_ratee_is_rejected() {
    let f = setup();
    let id = f.completed();
    let stranger = Address::generate(&f.env);
    // The client may only rate the freelancer of this job.
    let res = f.rep_client().try_submit(&f.client, &stranger, &id, &5);
    assert!(matches!(res, Err(Ok(ReputationError::InvalidRatee))));
}

#[test]
fn duplicate_rating_is_rejected() {
    let f = setup();
    let id = f.completed();
    f.rep_client().submit(&f.client, &f.freelancer, &id, &5);
    let res = f.rep_client().try_submit(&f.client, &f.freelancer, &id, &4);
    assert!(matches!(res, Err(Ok(ReputationError::AlreadyRated))));
}

#[test]
fn both_parties_rate_and_aggregate_updates() {
    let f = setup();
    let id = f.completed();

    f.rep_client().submit(&f.client, &f.freelancer, &id, &5);
    f.rep_client().submit(&f.freelancer, &f.client, &id, &4);

    let freelancer_agg = f.rep_client().get_aggregate(&f.freelancer);
    assert_eq!(freelancer_agg.count, 1);
    assert_eq!(freelancer_agg.total_score, 5);

    let client_agg = f.rep_client().get_aggregate(&f.client);
    assert_eq!(client_agg.count, 1);
    assert_eq!(client_agg.total_score, 4);

    let rating = f.rep_client().get_rating(&f.client, &id);
    assert_eq!(rating.score, 5);
    assert_eq!(rating.ratee, f.freelancer);
}

#[test]
fn aggregate_for_unknown_address_is_empty() {
    let f = setup();
    let agg = f.rep_client().get_aggregate(&Address::generate(&f.env));
    assert_eq!(agg.count, 0);
    assert_eq!(agg.total_score, 0);
}
