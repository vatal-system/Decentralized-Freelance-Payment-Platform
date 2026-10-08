//! Unit tests for the dispute contract.
//!
//! These deploy a real escrow contract so the cross-contract verification and
//! the `escrow.resolve()` call are exercised for real.

#![cfg(test)]

use crate::{DisputeContract, DisputeContractClient, DisputeError, DisputeStatus};
use escrow::{EscrowContract, EscrowContractClient, Milestone};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String, Vec,
};

struct Fx {
    env: Env,
    escrow: Address,
    dispute: Address,
    client: Address,
    freelancer: Address,
    token: Address,
    arbitrator: Address,
}

fn milestones(env: &Env, amounts: &[i128]) -> Vec<Milestone> {
    let mut v = Vec::new(env);
    for a in amounts {
        v.push_back(Milestone {
            amount: *a,
            released: false,
            released_amount: 0,
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
    let arbitrator = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&client, &10_000);

    let escrow = env.register(EscrowContract, ());
    let dispute = env.register(DisputeContract, ());

    EscrowContractClient::new(&env, &escrow).init(&arbitrator, &dispute);
    DisputeContractClient::new(&env, &dispute).init(&arbitrator);

    Fx {
        env,
        escrow,
        dispute,
        client,
        freelancer,
        token,
        arbitrator,
    }
}

impl Fx {
    fn escrow_client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }
    fn dispute_client(&self) -> DisputeContractClient<'_> {
        DisputeContractClient::new(&self.env, &self.dispute)
    }
    fn balance(&self, addr: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(addr)
    }
    fn reason(&self) -> String {
        String::from_str(&self.env, "work not delivered as agreed")
    }

    /// An escrow that has been funded and then frozen by a dispute.
    fn disputed(&self) -> u64 {
        let ec = self.escrow_client();
        let id = ec.create(
            &self.client,
            &self.freelancer,
            &self.token,
            &milestones(&self.env, &[1_000]),
            &10_000,
        );
        ec.fund(&id);
        ec.open_dispute(&id, &self.client);
        id
    }

    /// A funded (not frozen) escrow.
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
}

#[test]
fn raise_requires_a_disputed_escrow() {
    let f = setup();
    let id = f.funded();
    let res = f
        .dispute_client()
        .try_raise(&id, &f.escrow, &f.client, &f.reason());
    assert!(matches!(res, Err(Ok(DisputeError::EscrowNotDisputed))));
}

#[test]
fn raise_by_stranger_is_rejected() {
    let f = setup();
    let id = f.disputed();
    let stranger = Address::generate(&f.env);
    let res = f
        .dispute_client()
        .try_raise(&id, &f.escrow, &stranger, &f.reason());
    assert!(matches!(res, Err(Ok(DisputeError::Unauthorized))));
}

#[test]
fn raise_twice_for_same_escrow_is_rejected() {
    let f = setup();
    let id = f.disputed();
    f.dispute_client()
        .raise(&id, &f.escrow, &f.client, &f.reason());
    let res = f
        .dispute_client()
        .try_raise(&id, &f.escrow, &f.client, &f.reason());
    assert!(matches!(res, Err(Ok(DisputeError::AlreadyRaised))));
}

#[test]
fn raise_unknown_escrow_is_rejected() {
    let f = setup();
    let res = f
        .dispute_client()
        .try_raise(&999, &f.escrow, &f.client, &f.reason());
    assert!(matches!(res, Err(Ok(DisputeError::EscrowNotFound))));
}

#[test]
fn raise_records_expected_state() {
    let f = setup();
    let id = f.disputed();
    let dispute_id = f
        .dispute_client()
        .raise(&id, &f.escrow, &f.client, &f.reason());

    let d = f.dispute_client().get(&dispute_id);
    assert_eq!(d.status, DisputeStatus::Raised);
    assert_eq!(d.escrow_id, id);
    assert_eq!(d.raised_by, f.client);
    assert_eq!(f.dispute_client().dispute_for(&id), dispute_id);
}

#[test]
fn arbitrate_distributes_funds_via_escrow() {
    let f = setup();
    let id = f.disputed();
    let dispute_id = f
        .dispute_client()
        .raise(&id, &f.escrow, &f.client, &f.reason());

    f.dispute_client().arbitrate(&dispute_id, &400, &600);

    assert_eq!(
        f.dispute_client().get(&dispute_id).status,
        DisputeStatus::Resolved
    );
    assert_eq!(f.balance(&f.client), 9_000 + 400);
    assert_eq!(f.balance(&f.freelancer), 600);
    assert_eq!(f.balance(&f.escrow), 0);
}

#[test]
fn arbitrate_with_invalid_shares_is_rejected_by_escrow() {
    let f = setup();
    let id = f.disputed();
    let dispute_id = f
        .dispute_client()
        .raise(&id, &f.escrow, &f.client, &f.reason());

    // 400 + 400 != 1000 held in escrow.
    let res = f.dispute_client().try_arbitrate(&dispute_id, &400, &400);
    assert!(matches!(res, Err(Ok(DisputeError::EscrowRejected))));
    // Nothing moved.
    assert_eq!(f.balance(&f.escrow), 1_000);
}

#[test]
fn arbitrate_twice_is_rejected() {
    let f = setup();
    let id = f.disputed();
    let dispute_id = f
        .dispute_client()
        .raise(&id, &f.escrow, &f.client, &f.reason());

    f.dispute_client().arbitrate(&dispute_id, &1_000, &0);
    let res = f.dispute_client().try_arbitrate(&dispute_id, &1_000, &0);
    assert!(matches!(res, Err(Ok(DisputeError::InvalidStatus))));
}

#[test]
fn init_twice_is_rejected() {
    let f = setup();
    let res = f.dispute_client().try_init(&f.arbitrator);
    assert!(matches!(res, Err(Ok(DisputeError::AlreadyInitialized))));
}

#[test]
#[should_panic]
fn init_requires_arbitrator_auth() {
    // A stranger must not be able to claim the arbitrator role.
    let env = Env::default();
    let dispute = env.register(DisputeContract, ());
    let stranger = Address::generate(&env);
    DisputeContractClient::new(&env, &dispute).init(&stranger);
}

#[test]
#[should_panic]
fn arbitrate_requires_arbitrator_auth() {
    // Set up a raised dispute while auths are mocked, then disable mocking so
    // the missing arbitrator authorization must panic.
    let f = setup();
    let id = f.disputed();
    let dispute_id = f
        .dispute_client()
        .raise(&id, &f.escrow, &f.client, &f.reason());
    f.env.set_auths(&[]);
    f.dispute_client().arbitrate(&dispute_id, &400, &600);
}
