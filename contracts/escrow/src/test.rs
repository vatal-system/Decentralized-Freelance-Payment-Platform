//! Unit tests for the escrow contract.
//!
//! Each state transition and failure path has its own test. Happy paths use the
//! panicking client (`create`, `fund`, …); failure paths use the `try_*` client
//! and match on the contract error.
//!
//! Note on `try_*` results: the generated client returns a *nested* `Result`.
//! `Err(Ok(e))` means the contract itself returned `Err(e)`; `Ok(_)`/`Err(Err(_))`
//! are invocation/success cases. See `soroban_sdk::Env::try_invoke_contract`.

#![cfg(test)]

use crate::{EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, Milestone};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn deploy_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
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

struct Fixture {
    env: Env,
    escrow: Address,
    client: Address,
    freelancer: Address,
    token: Address,
}

fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token = deploy_token(&env, &Address::generate(&env));
    StellarAssetClient::new(&env, &token).mint(&client, &10_000);

    let escrow = env.register(EscrowContract, ());
    Fixture {
        env,
        escrow,
        client,
        freelancer,
        token,
    }
}

impl Fixture {
    fn c(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.escrow)
    }

    fn balance(&self, addr: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(addr)
    }

    /// Create a funded escrow with the given milestone amounts.
    fn funded(&self, amounts: &[i128]) -> u64 {
        let id = self.c().create(
            &self.client,
            &self.freelancer,
            &self.token,
            &milestones(&self.env, amounts),
            &10_000,
        );
        self.c().fund(&id);
        id
    }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

#[test]
fn create_stores_expected_state() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );
    assert_eq!(id, 0, "first escrow id is 0");

    let data = f.c().get(&id);
    assert_eq!(data.status, EscrowStatus::Created);
    assert_eq!(data.total_amount, 1_000);
    assert_eq!(data.milestones.len(), 2);
    assert_eq!(data.created_at, 1_000);
    assert_eq!(f.balance(&f.escrow), 0, "nothing held before funding");
}

#[test]
fn create_rejects_empty_milestones() {
    let f = fixture();
    let res = f.c().try_create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[]),
        &10_000,
    );
    assert!(matches!(res, Err(Ok(EscrowError::InvalidMilestones))));
}

#[test]
fn create_rejects_zero_and_negative_amounts() {
    let f = fixture();
    for amounts in [&[0i128][..], &[100, 0][..], &[-5][..]] {
        let res = f.c().try_create(
            &f.client,
            &f.freelancer,
            &f.token,
            &milestones(&f.env, amounts),
            &10_000,
        );
        assert!(
            matches!(res, Err(Ok(EscrowError::ZeroAmount))),
            "amounts {amounts:?} must be rejected"
        );
    }
}

#[test]
fn create_rejects_past_expiry() {
    let f = fixture();
    let res = f.c().try_create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[100]),
        &1_000, // == now
    );
    assert!(matches!(res, Err(Ok(EscrowError::InvalidExpiry))));
}

#[test]
fn create_rejects_same_counterparty() {
    let f = fixture();
    let res = f.c().try_create(
        &f.client,
        &f.client,
        &f.token,
        &milestones(&f.env, &[100]),
        &10_000,
    );
    assert!(matches!(res, Err(Ok(EscrowError::InvalidCounterparty))));
}

// ---------------------------------------------------------------------------
// fund
// ---------------------------------------------------------------------------

#[test]
fn fund_moves_funds_into_escrow() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &10_000,
    );
    f.c().fund(&id);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active);
    assert_eq!(f.balance(&f.escrow), 1_000);
    assert_eq!(f.balance(&f.client), 9_000);
}

#[test]
fn fund_twice_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    let res = f.c().try_fund(&id);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

// ---------------------------------------------------------------------------
// release_milestone
// ---------------------------------------------------------------------------

#[test]
fn release_pays_freelancer_and_completes() {
    let f = fixture();
    let id = f.funded(&[300, 700]);

    f.c().release_milestone(&id, &0);
    assert_eq!(f.balance(&f.freelancer), 300);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active, "more remain");

    f.c().release_milestone(&id, &1);
    assert_eq!(f.balance(&f.freelancer), 1_000);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
}

#[test]
fn release_twice_is_rejected() {
    let f = fixture();
    let id = f.funded(&[300, 700]);
    f.c().release_milestone(&id, &0);
    let res = f.c().try_release_milestone(&id, &0);
    assert!(matches!(
        res,
        Err(Ok(EscrowError::MilestoneAlreadyReleased))
    ));
}

#[test]
fn release_out_of_bounds_is_rejected() {
    let f = fixture();
    let id = f.funded(&[300, 700]);
    let res = f.c().try_release_milestone(&id, &2);
    assert!(matches!(
        res,
        Err(Ok(EscrowError::MilestoneIndexOutOfBounds))
    ));
}

#[test]
fn release_after_completion_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().release_milestone(&id, &0);
    let res = f.c().try_release_milestone(&id, &0);
    // Status is Completed, so the release is rejected before the "already" check.
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn release_before_funding_is_rejected() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[100]),
        &10_000,
    );
    let res = f.c().try_release_milestone(&id, &0);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

// ---------------------------------------------------------------------------
// open_dispute
// ---------------------------------------------------------------------------

#[test]
fn open_dispute_by_each_party() {
    let f = fixture();
    let a = f.funded(&[1_000]);
    f.c().open_dispute(&a, &f.client);
    assert_eq!(f.c().get(&a).status, EscrowStatus::Disputed);

    let b = f.funded(&[1_000]);
    f.c().open_dispute(&b, &f.freelancer);
    assert_eq!(f.c().get(&b).status, EscrowStatus::Disputed);
}

#[test]
fn open_dispute_by_stranger_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    let stranger = Address::generate(&f.env);
    let res = f.c().try_open_dispute(&id, &stranger);
    assert!(matches!(res, Err(Ok(EscrowError::Unauthorized))));
}

#[test]
fn open_dispute_from_completed_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().release_milestone(&id, &0);
    let res = f.c().try_open_dispute(&id, &f.client);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

// ---------------------------------------------------------------------------
// release after dispute is frozen
// ---------------------------------------------------------------------------

#[test]
fn release_after_dispute_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let res = f.c().try_release_milestone(&id, &0);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

fn init_escrow(f: &Fixture, admin: &Address, dispute: &Address) {
    f.c().init(admin, dispute);
}

#[test]
fn resolve_before_init_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let res = f.c().try_resolve(&id, &400, &600);
    assert!(matches!(res, Err(Ok(EscrowError::NotInitialized))));
}

#[test]
fn resolve_when_not_disputed_is_rejected() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);
    let id = f.funded(&[1_000]);
    let res = f.c().try_resolve(&id, &400, &600);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn resolve_with_wrong_share_sum_is_rejected() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);
    let id = f.funded(&[400, 600]);
    f.c().open_dispute(&id, &f.client);

    // 400 + 500 != 1000
    let res = f.c().try_resolve(&id, &400, &500);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidShares))));
    // Negative share
    let res = f.c().try_resolve(&id, &-100, &1_100);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidShares))));
}

#[test]
fn resolve_distributes_funds_and_completes() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);

    let id = f.funded(&[400, 600]);
    f.c().open_dispute(&id, &f.freelancer);

    f.c().resolve(&id, &250, &750);
    assert_eq!(f.balance(&f.client), 9_000 + 250);
    assert_eq!(f.balance(&f.freelancer), 750);
    assert_eq!(f.balance(&f.escrow), 0, "escrow fully drained");
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);

    // Cannot resolve twice.
    let res = f.c().try_resolve(&id, &0, &0);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn resolve_only_refunds_unreleased_milestones() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);

    let id = f.funded(&[400, 600]);
    f.c().release_milestone(&id, &0); // 400 paid, 600 remains
    f.c().open_dispute(&id, &f.client);
    f.c().resolve(&id, &600, &0);

    assert_eq!(f.balance(&f.client), 9_000 + 600);
    assert_eq!(f.balance(&f.freelancer), 400);
    assert_eq!(f.balance(&f.escrow), 0);
}

// ---------------------------------------------------------------------------
// reclaim_expired
// ---------------------------------------------------------------------------

#[test]
fn reclaim_before_expiry_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    let res = f.c().try_reclaim_expired(&id);
    assert!(matches!(res, Err(Ok(EscrowError::NotExpired))));
}

#[test]
fn reclaim_after_expiry_refunds_unreleased() {
    let f = fixture();
    let id = f.funded(&[400, 600]);
    f.c().release_milestone(&id, &0); // 400 paid

    f.env.ledger().set_timestamp(10_001); // past expiry (10_000)
    f.c().reclaim_expired(&id);

    assert_eq!(f.balance(&f.client), 9_000 + 600);
    assert_eq!(f.balance(&f.freelancer), 400);
    assert_eq!(f.balance(&f.escrow), 0);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Refunded);

    // Second reclaim is rejected.
    let res = f.c().try_reclaim_expired(&id);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn reclaim_from_disputed_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    f.env.ledger().set_timestamp(10_001);
    let res = f.c().try_reclaim_expired(&id);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

// ---------------------------------------------------------------------------
// initialization / views
// ---------------------------------------------------------------------------

#[test]
fn init_twice_is_rejected() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);
    let res = f.c().try_init(&admin, &dispute);
    assert!(matches!(res, Err(Ok(EscrowError::AlreadyInitialized))));
}

#[test]
fn get_unknown_escrow_is_rejected() {
    let f = fixture();
    let res = f.c().try_get(&999);
    assert!(matches!(res, Err(Ok(EscrowError::NotFound))));
}

// ---------------------------------------------------------------------------
// authorization
// ---------------------------------------------------------------------------

#[test]
#[should_panic]
fn create_requires_client_auth() {
    // No `mock_all_auths`: the missing authorization must panic.
    let env = Env::default();
    env.ledger().set_timestamp(1_000);
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let token = deploy_token(&env, &Address::generate(&env));
    let escrow = env.register(EscrowContract, ());
    let c = EscrowContractClient::new(&env, &escrow);
    c.create(
        &client,
        &freelancer,
        &token,
        &milestones(&env, &[100]),
        &10_000,
    );
}
