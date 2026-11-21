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

extern crate std;

use crate::{
    DataKey, EscrowContract, EscrowContractClient, EscrowError, EscrowStatus, Milestone,
    DISPUTE_CONTRACT_TIMELOCK_SECONDS, TTL_EXTEND_TO, TTL_THRESHOLD,
};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    xdr::{self, Limits, ReadXdr},
    Address, BytesN, Env, Map, Symbol, TryFromVal, Val, Vec,
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
            released_amount: 0,
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
// Event log helpers
// ---------------------------------------------------------------------------

/// Decode the data map of the first event named `name` in the event log.
fn event_data(env: &Env, name: &str) -> Val {
    for e in env.events().all().events() {
        let xdr::ContractEventBody::V0(body) = &e.body;
        let Some(topic0) = body.topics.first() else {
            continue;
        };
        let topic_val = Val::try_from_val(env, topic0).unwrap();
        if Symbol::try_from_val(env, &topic_val).unwrap() == Symbol::new(env, name) {
            return Val::try_from_val(env, &body.data).unwrap();
        }
    }
    panic!("event {name:?} not found");
}

/// Read a named field out of an event's data map.
fn field<T: TryFromVal<Env, Val>>(env: &Env, data: &Val, name: &str) -> T {
    let map = Map::<Symbol, Val>::try_from_val(env, data).unwrap();
    let value = map.get(Symbol::new(env, name)).unwrap();
    T::try_from_val(env, &value).unwrap()
}

/// Decode the `#[topic]` field (`topic[1]`) of the first event named `name`.
fn event_topic1<T: TryFromVal<Env, Val>>(env: &Env, name: &str) -> T {
    for e in env.events().all().events() {
        let xdr::ContractEventBody::V0(body) = &e.body;
        let Some(topic0) = body.topics.first() else {
            continue;
        };
        let topic_val = Val::try_from_val(env, topic0).unwrap();
        if Symbol::try_from_val(env, &topic_val).unwrap() == Symbol::new(env, name) {
            let topic1 = body.topics.get(1).expect("event has no topic1");
            let val = Val::try_from_val(env, topic1).unwrap();
            return T::try_from_val(env, &val).unwrap();
        }
    }
    panic!("event {name:?} not found");
}

/// True if the event log contains an event whose first topic matches `name`.
/// Mirrors [`event_data`] but reports absence instead of panicking.
fn event_exists(env: &Env, name: &str) -> bool {
    for e in env.events().all().events() {
        let xdr::ContractEventBody::V0(body) = &e.body;
        let Some(topic0) = body.topics.first() else {
            continue;
        };
        let topic_val = Val::try_from_val(env, topic0).unwrap();
        if Symbol::try_from_val(env, &topic_val).unwrap() == Symbol::new(env, name) {
            return true;
        }
    }
    false
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
fn created_event_carries_freelancer_and_total() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );

    let data = event_data(&f.env, "created");
    let escrow_id: u64 = field(&f.env, &data, "escrow_id");
    let freelancer: Address = field(&f.env, &data, "freelancer");
    let total_amount: i128 = field(&f.env, &data, "total_amount");

    assert_eq!(escrow_id, id);
    assert_eq!(freelancer, f.freelancer);
    assert_eq!(total_amount, 1_000);
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

#[test]
fn create_accepts_max_milestones() {
    let f = fixture();
    let amounts = [100i128; 20];
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &amounts),
        &10_000,
    );
    let data = f.c().get(&id);
    assert_eq!(data.milestones.len(), 20);
    assert_eq!(data.total_amount, 2_000);
}

#[test]
fn create_rejects_too_many_milestones() {
    let f = fixture();
    let amounts = [100i128; 21];
    let res = f.c().try_create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &amounts),
        &10_000,
    );
    assert!(matches!(res, Err(Ok(EscrowError::TooManyMilestones))));
}

// ---------------------------------------------------------------------------
// update_milestones
// ---------------------------------------------------------------------------

#[test]
fn update_milestones_replaces_breakdown_and_total() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );

    f.c()
        .update_milestones(&id, &milestones(&f.env, &[100, 200, 300]));

    let data = f.c().get(&id);
    assert_eq!(data.status, EscrowStatus::Created, "still unfunded");
    assert_eq!(data.total_amount, 600);
    assert_eq!(data.milestones.len(), 3);
    assert_eq!(data.milestones.get(0).unwrap().amount, 100);
    assert_eq!(data.milestones.get(2).unwrap().amount, 300);
}

#[test]
fn update_milestones_emits_the_new_count_and_total() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );

    f.c()
        .update_milestones(&id, &milestones(&f.env, &[100, 200, 300]));

    let data = event_data(&f.env, "milestones_updated");
    let count: u32 = field(&f.env, &data, "count");
    let total: i128 = field(&f.env, &data, "total_amount");
    assert_eq!(count, 3);
    assert_eq!(total, 600);
}

#[test]
fn update_milestones_after_fund_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    let res = f
        .c()
        .try_update_milestones(&id, &milestones(&f.env, &[500]));
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
    // The original breakdown is untouched.
    assert_eq!(f.c().get(&id).total_amount, 1_000);
}

#[test]
fn update_milestones_rejects_empty_and_bad_amounts() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );

    let res = f.c().try_update_milestones(&id, &milestones(&f.env, &[]));
    assert!(matches!(res, Err(Ok(EscrowError::InvalidMilestones))));

    for amounts in [&[0i128][..], &[100, 0][..], &[-5][..]] {
        let res = f
            .c()
            .try_update_milestones(&id, &milestones(&f.env, amounts));
        assert!(
            matches!(res, Err(Ok(EscrowError::ZeroAmount))),
            "amounts {amounts:?} must be rejected"
        );
    }
}

#[test]
fn update_milestones_rejects_an_overflowing_total() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );

    let res = f
        .c()
        .try_update_milestones(&id, &milestones(&f.env, &[i128::MAX, 1]));
    assert!(matches!(res, Err(Ok(EscrowError::Overflow))));
    // A rejected edit leaves the original breakdown and total in place.
    assert_eq!(f.c().get(&id).total_amount, 1_000);
}

#[test]
fn update_milestones_unknown_escrow_is_rejected() {
    let f = fixture();
    let res = f
        .c()
        .try_update_milestones(&999, &milestones(&f.env, &[100]));
    assert!(matches!(res, Err(Ok(EscrowError::NotFound))));
}

#[test]
fn update_milestones_accepts_max_milestones() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );
    let amounts = [50i128; 20];
    f.c().update_milestones(&id, &milestones(&f.env, &amounts));
    assert_eq!(f.c().get(&id).milestones.len(), 20);
}

#[test]
fn update_milestones_rejects_too_many_milestones() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &10_000,
    );
    let amounts = [50i128; 21];
    let res = f
        .c()
        .try_update_milestones(&id, &milestones(&f.env, &amounts));
    assert!(matches!(res, Err(Ok(EscrowError::TooManyMilestones))));
}

#[test]
fn update_milestones_at_expiry_is_rejected() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &2_000,
    );
    // Exactly at the expiry timestamp — the same `>=` boundary that `fund`
    // enforces — the update must be refused.
    f.env.ledger().set_timestamp(2_000);

    let res = f
        .c()
        .try_update_milestones(&id, &milestones(&f.env, &[400, 600]));

    assert!(matches!(res, Err(Ok(EscrowError::InvalidExpiry))));
    // Nothing was written and no event was published.
    let data = f.c().get(&id);
    assert_eq!(data.status, EscrowStatus::Created);
    assert_eq!(data.total_amount, 1_000);
    assert_eq!(data.milestones.len(), 1);
    assert!(!event_exists(&f.env, "milestones_updated"));
}

#[test]
fn update_milestones_after_expiry_is_rejected() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[300, 700]),
        &2_000,
    );
    // Past the stored expiry timestamp.
    f.env.ledger().set_timestamp(2_500);

    let res = f
        .c()
        .try_update_milestones(&id, &milestones(&f.env, &[100, 200, 300]));

    assert!(matches!(res, Err(Ok(EscrowError::InvalidExpiry))));
    // The original breakdown is untouched and no event was published.
    let data = f.c().get(&id);
    assert_eq!(data.status, EscrowStatus::Created);
    assert_eq!(data.total_amount, 1_000);
    assert_eq!(data.milestones.len(), 2);
    assert_eq!(data.milestones.get(0).unwrap().amount, 300);
    assert!(!event_exists(&f.env, "milestones_updated"));
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
fn fund_at_expiry_is_rejected_without_moving_funds() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &2_000,
    );
    f.env.ledger().set_timestamp(2_000);

    let res = f.c().try_fund(&id);

    assert!(matches!(res, Err(Ok(EscrowError::InvalidExpiry))));
    assert_eq!(f.c().get(&id).status, EscrowStatus::Created);
    assert_eq!(f.balance(&f.client), 10_000);
    assert_eq!(f.balance(&f.escrow), 0);
}

#[test]
fn funded_event_carries_freelancer() {
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &10_000,
    );
    f.c().fund(&id);

    let data = event_data(&f.env, "funded");
    let escrow_id: u64 = field(&f.env, &data, "escrow_id");
    let freelancer: Address = field(&f.env, &data, "freelancer");
    let amount: i128 = field(&f.env, &data, "amount");

    assert_eq!(escrow_id, id);
    assert_eq!(freelancer, f.freelancer);
    assert_eq!(amount, 1_000);
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
// release_partial
// ---------------------------------------------------------------------------

#[test]
fn release_partial_then_remainder_completes() {
    let f = fixture();
    let id = f.funded(&[1_000]);

    f.c().release_partial(&id, &0, &300);
    assert_eq!(f.balance(&f.freelancer), 300);
    assert_eq!(
        f.c().get(&id).status,
        EscrowStatus::Active,
        "700 outstanding"
    );
    let m = f.c().get(&id).milestones.get(0).unwrap();
    assert_eq!(m.released_amount, 300);
    assert!(!m.released);

    // `release_milestone` pays the remaining 700 and completes the escrow.
    f.c().release_milestone(&id, &0);
    assert_eq!(f.balance(&f.freelancer), 1_000);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
}

#[test]
fn release_partial_sum_reaching_amount_flips_released() {
    let f = fixture();
    let id = f.funded(&[1_000]);

    f.c().release_partial(&id, &0, &300);
    f.c().release_partial(&id, &0, &700);

    let m = f.c().get(&id).milestones.get(0).unwrap();
    assert_eq!(m.released_amount, 1_000);
    assert!(m.released);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
    assert_eq!(f.balance(&f.freelancer), 1_000);
}

#[test]
fn release_partial_emits_the_amount_paid_by_this_call() {
    let f = fixture();
    let id = f.funded(&[1_000]);

    f.c().release_partial(&id, &0, &250);

    let data = event_data(&f.env, "milestone_released");
    let index: u32 = field(&f.env, &data, "index");
    let amount: i128 = field(&f.env, &data, "amount");
    assert_eq!(index, 0);
    assert_eq!(
        amount, 250,
        "the event carries the partial payment, not the total"
    );
}

#[test]
fn release_partial_completes_only_after_every_milestone_is_paid_in_full() {
    let f = fixture();
    let id = f.funded(&[100, 200]);

    // Paying the first milestone in full is not enough to complete the escrow.
    f.c().release_partial(&id, &0, &100);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active);

    // A partial payment on the second milestone also leaves it Active.
    f.c().release_partial(&id, &1, &50);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active);

    // The last release completes it and drains the contract.
    f.c().release_partial(&id, &1, &150);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
    assert_eq!(f.balance(&f.freelancer), 300);
    assert_eq!(f.balance(&f.escrow), 0);
}

#[test]
fn release_partial_over_release_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);

    let res = f.c().try_release_partial(&id, &0, &1_001);
    assert!(matches!(res, Err(Ok(EscrowError::AmountExceedsMilestone))));

    // The cap is cumulative: 400 + 601 > 1_000.
    f.c().release_partial(&id, &0, &400);
    let res = f.c().try_release_partial(&id, &0, &601);
    assert!(matches!(res, Err(Ok(EscrowError::AmountExceedsMilestone))));
}

#[test]
fn release_partial_rejects_zero_and_negative() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    for amount in [0i128, -1] {
        let res = f.c().try_release_partial(&id, &0, &amount);
        assert!(
            matches!(res, Err(Ok(EscrowError::ZeroAmount))),
            "amount {amount} must be rejected"
        );
    }
}

#[test]
fn release_partial_after_dispute_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let res = f.c().try_release_partial(&id, &0, &100);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn release_partial_out_of_bounds_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    let res = f.c().try_release_partial(&id, &2, &100);
    assert!(matches!(
        res,
        Err(Ok(EscrowError::MilestoneIndexOutOfBounds))
    ));
}

#[test]
fn partial_release_exact_sequence_completes_milestone() {
    let f = fixture();
    let id = f.funded(&[100]);

    // 1st partial release: 30 of 100
    f.c().release_partial(&id, &0, &30);
    assert_eq!(f.balance(&f.freelancer), 30);
    let m = f.c().get(&id).milestones.get(0).unwrap();
    assert_eq!(m.released_amount, 30);
    assert!(!m.released);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active);

    // 2nd partial release: 30 more of 100 (cumulative 60)
    f.c().release_partial(&id, &0, &30);
    assert_eq!(f.balance(&f.freelancer), 60);
    let m = f.c().get(&id).milestones.get(0).unwrap();
    assert_eq!(m.released_amount, 60);
    assert!(!m.released);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active);

    // 3rd partial release: remaining 40 of 100 (cumulative 100) completes milestone
    f.c().release_partial(&id, &0, &40);
    assert_eq!(f.balance(&f.freelancer), 100);
    let m = f.c().get(&id).milestones.get(0).unwrap();
    assert_eq!(m.released_amount, 100);
    assert!(m.released);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
    assert_eq!(f.balance(&f.escrow), 0);

    // Any subsequent release attempt is rejected since escrow is completed
    let res = f.c().try_release_partial(&id, &0, &1);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn partial_release_exceeding_remaining_is_rejected() {
    let f = fixture();
    let id = f.funded(&[100]);

    // Release 30 of 100 -> 70 remaining
    f.c().release_partial(&id, &0, &30);

    // 71 is 1 stroop more than remaining (70) -> rejected
    let res = f.c().try_release_partial(&id, &0, &71);
    assert!(matches!(res, Err(Ok(EscrowError::AmountExceedsMilestone))));

    // Release 69 -> 1 remaining
    f.c().release_partial(&id, &0, &69);

    // 2 is 1 stroop more than remaining (1) -> rejected
    let res = f.c().try_release_partial(&id, &0, &2);
    assert!(matches!(res, Err(Ok(EscrowError::AmountExceedsMilestone))));

    // Exact remaining 1 succeeds and completes milestone
    f.c().release_partial(&id, &0, &1);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
    assert_eq!(f.balance(&f.freelancer), 100);
    assert_eq!(f.balance(&f.escrow), 0);
}

#[test]
fn dispute_after_partial_releases_only_splits_unreleased_balance() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);

    // 2 milestones: 100 and 200, total = 300
    let id = f.funded(&[100, 200]);

    // Partial release 40 on milestone 0
    f.c().release_partial(&id, &0, &40);
    assert_eq!(f.balance(&f.freelancer), 40);

    // Remaining on milestone 0 is 60, milestone 1 is 200. Total unreleased = 260.
    f.c().open_dispute(&id, &f.client);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Disputed);

    // Attempting to resolve with initial full 300 (e.g. 150 + 150) must be rejected
    let res = f.c().try_resolve(&id, &150, &150);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidShares))));

    // Resolving with exact unreleased 260 (client: 100, freelancer: 160) succeeds
    f.c().resolve(&id, &100, &160);

    // Balances check:
    // Freelancer received: 40 (earlier partial) + 160 (dispute share) = 200
    assert_eq!(f.balance(&f.freelancer), 200);
    // Client funded 300 (10,000 - 300 = 9,700), received back 100 -> 9,800
    assert_eq!(f.balance(&f.client), 9_800);
    // Escrow contract has 0 remaining (no funds stranded or leaked)
    assert_eq!(f.balance(&f.escrow), 0);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
}

#[test]
fn reclaim_expired_after_partial_release_refunds_only_unreleased_stroops() {
    let f = fixture();
    // 2 milestones: 400 and 600, total = 1000
    let id = f.funded(&[400, 600]);

    // Release 150 partially on milestone 0
    f.c().release_partial(&id, &0, &150);
    assert_eq!(f.balance(&f.freelancer), 150);

    // Advance timestamp past expiry (default expiry is 10,000)
    f.env.ledger().set_timestamp(10_001);

    // Client reclaims expired escrow
    f.c().reclaim_expired(&id);

    // Unreleased balance was: (400 - 150) + 600 = 850
    // Client had 9,000 left after funding 1,000. Reclaim adds 850 -> 9,850.
    assert_eq!(f.balance(&f.client), 9_850);
    // Freelancer retains the 150 already released
    assert_eq!(f.balance(&f.freelancer), 150);
    // Escrow contract balance is drained to 0
    assert_eq!(f.balance(&f.escrow), 0);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Refunded);

    // Second reclaim is rejected
    let res = f.c().try_reclaim_expired(&id);
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
// reclaim_after_dispute_timeout
// ---------------------------------------------------------------------------

#[test]
fn reclaim_after_dispute_timeout_refunds_unreleased() {
    let f = fixture();
    let id = f.funded(&[400, 600]);
    f.c().release_milestone(&id, &0); // 400 paid
    f.c().open_dispute(&id, &f.client);

    let deadline = f.c().dispute_deadline(&id);
    assert_eq!(deadline, 1_000 + 7 * 24 * 60 * 60);

    // Before the deadline the escape hatch is closed.
    let res = f.c().try_reclaim_after_dispute_timeout(&id);
    assert!(matches!(
        res,
        Err(Ok(EscrowError::DisputeTimeoutNotReached))
    ));

    f.env.ledger().set_timestamp(deadline + 1);
    f.c().reclaim_after_dispute_timeout(&id);

    assert_eq!(f.balance(&f.client), 9_000 + 600);
    assert_eq!(f.balance(&f.freelancer), 400);
    assert_eq!(f.balance(&f.escrow), 0);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Refunded);
}

#[test]
fn dispute_timeout_is_configurable_and_applies_to_new_disputes() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);

    assert_eq!(f.c().dispute_timeout_seconds(), 7 * 24 * 60 * 60);
    f.c().set_dispute_timeout(&120);
    assert_eq!(f.c().dispute_timeout_seconds(), 120);

    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    assert_eq!(f.c().dispute_deadline(&id), 1_000 + 120);
}

#[test]
fn zero_dispute_timeout_is_rejected() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);

    let res = f.c().try_set_dispute_timeout(&0);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidDisputeTimeout))));
}

#[test]
fn set_dispute_timeout_before_init_is_rejected() {
    let f = fixture();
    let res = f.c().try_set_dispute_timeout(&120);
    assert!(matches!(res, Err(Ok(EscrowError::NotInitialized))));
}

#[test]
fn reclaim_after_dispute_timeout_on_active_is_rejected() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    let res = f.c().try_reclaim_after_dispute_timeout(&id);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
}

#[test]
fn late_ruling_after_timeout_reclaim_cannot_double_spend() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);

    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let deadline = f.c().dispute_deadline(&id);
    f.env.ledger().set_timestamp(deadline + 1);
    f.c().reclaim_after_dispute_timeout(&id);
    assert_eq!(f.balance(&f.client), 10_000);

    // A late ruling now hits a Refunded escrow and is rejected.
    let res = f.c().try_resolve(&id, &1_000, &0);
    assert!(matches!(res, Err(Ok(EscrowError::InvalidStatus))));
    assert_eq!(f.balance(&f.escrow), 0, "no double spend");
}

#[test]
#[should_panic]
fn reclaim_after_dispute_timeout_requires_client_auth() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let deadline = f.c().dispute_deadline(&id);
    f.env.ledger().set_timestamp(deadline + 1);
    f.env.set_auths(&[]);
    f.c().reclaim_after_dispute_timeout(&id);
}

// ---------------------------------------------------------------------------
// dispute deadline TTL
// ---------------------------------------------------------------------------

/// TTL of `key` in the escrow contract's persistent storage.
fn deadline_ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.env
        .as_contract(&f.escrow, || f.env.storage().persistent().get_ttl(key))
}

/// Move the ledger forward until `key`'s TTL sits below the refresh threshold,
/// leaving it still live. Returns the reduced TTL.
fn age_below_ttl_threshold(f: &Fixture, key: &DataKey) -> u32 {
    let ttl = deadline_ttl(f, key);
    assert!(ttl > TTL_THRESHOLD, "entry should start with TTL headroom");
    let seq = f.env.ledger().sequence();
    f.env
        .ledger()
        .set_sequence_number(seq + (ttl - TTL_THRESHOLD) + 1);
    let low = deadline_ttl(f, key);
    assert!(low < TTL_THRESHOLD, "entry should now need a refresh");
    low
}

#[test]
fn dispute_deadline_read_extends_deadline_ttl() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let key = DataKey::DisputeDeadline(id);

    let low = age_below_ttl_threshold(&f, &key);
    assert!(low < TTL_THRESHOLD);

    // The view must still answer, and its read must refresh the key.
    assert_eq!(f.c().dispute_deadline(&id), 1_000 + 7 * 24 * 60 * 60);
    let renewed = deadline_ttl(&f, &key);
    assert!(
        renewed > low,
        "read should extend the TTL, not leave it stale"
    );
    assert!(renewed >= TTL_THRESHOLD);
    assert!(renewed <= TTL_EXTEND_TO);
}

#[test]
fn reclaim_after_dispute_timeout_refreshes_deadline_ttl() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.c().open_dispute(&id, &f.client);
    let key = DataKey::DisputeDeadline(id);
    let deadline = f.c().dispute_deadline(&id);

    age_below_ttl_threshold(&f, &key);
    f.env.ledger().set_timestamp(deadline + 1);
    f.c().reclaim_after_dispute_timeout(&id);

    assert_eq!(f.c().get(&id).status, EscrowStatus::Refunded);
    let renewed = deadline_ttl(&f, &key);
    assert!(renewed >= TTL_THRESHOLD);
}

#[test]
fn dispute_deadline_without_an_open_dispute_is_not_found() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    // Reading a missing deadline must return `NotFound` rather than trap while
    // trying to extend the TTL of an entry that does not exist.
    let res = f.c().try_dispute_deadline(&id);
    assert!(matches!(res, Err(Ok(EscrowError::NotFound))));
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

const ZERO_CONTRACT: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const ACCOUNT_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

#[test]
fn init_rejects_invalid_dispute_contract() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let invalid = [
        admin.clone(),
        f.escrow.clone(),
        Address::from_str(&f.env, ZERO_CONTRACT),
        Address::from_str(&f.env, ACCOUNT_ADDRESS),
    ];
    for bad in invalid.iter() {
        let res = f.c().try_init(&admin, bad);
        assert!(matches!(res, Err(Ok(EscrowError::InvalidDisputeContract))));
    }
    // Nothing was persisted, so a valid init still succeeds.
    f.c().init(&admin, &Address::generate(&f.env));
}

#[test]
fn set_dispute_contract_rejects_invalid_dispute_contract() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);
    let invalid = [
        admin.clone(),
        f.escrow.clone(),
        Address::from_str(&f.env, ZERO_CONTRACT),
        Address::from_str(&f.env, ACCOUNT_ADDRESS),
    ];
    for bad in invalid.iter() {
        let res = f.c().try_set_dispute_contract(bad);
        assert!(matches!(res, Err(Ok(EscrowError::InvalidDisputeContract))));
    }
    assert!(f.c().pending_dispute_contract().is_none());
    assert_eq!(f.c().dispute_contract(), dispute);
}

#[test]
fn pause_blocks_escrow_changes_until_admin_unpauses() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    f.c().init(&admin, &dispute);
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &10_000,
    );

    f.c().pause();
    assert!(f.c().is_paused());
    assert!(matches!(
        f.c().try_create(
            &f.client,
            &f.freelancer,
            &f.token,
            &milestones(&f.env, &[1_000]),
            &10_000,
        ),
        Err(Ok(EscrowError::Paused))
    ));
    assert!(matches!(f.c().try_fund(&id), Err(Ok(EscrowError::Paused))));

    f.c().unpause();
    assert!(!f.c().is_paused());
    f.c().fund(&id);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Active);

    f.c().pause();
    assert!(matches!(
        f.c().try_release_milestone(&id, &0),
        Err(Ok(EscrowError::Paused))
    ));
    f.c().unpause();
    f.c().release_milestone(&id, &0);
    assert_eq!(f.c().get(&id).status, EscrowStatus::Completed);
}

#[test]
#[should_panic]
fn pause_requires_admin_authorization() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    f.c().init(&admin, &Address::generate(&f.env));
    f.env.set_auths(&[]);
    f.c().pause();
}

#[test]
fn set_code_before_init_is_rejected() {
    let f = fixture();
    let hash = BytesN::from_array(&f.env, &[7u8; 32]);
    let res = f.c().try_set_code(&hash);
    assert!(matches!(res, Err(Ok(EscrowError::NotInitialized))));
}

#[test]
#[should_panic]
fn set_code_requires_admin_authorization() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    f.c().init(&admin, &Address::generate(&f.env));
    f.env.set_auths(&[]);
    f.c().set_code(&BytesN::from_array(&f.env, &[7u8; 32]));
}

#[test]
fn get_unknown_escrow_is_rejected() {
    let f = fixture();
    let res = f.c().try_get(&999);
    assert!(matches!(res, Err(Ok(EscrowError::NotFound))));
}

// ---------------------------------------------------------------------------
// set_dispute_contract
// ---------------------------------------------------------------------------

#[test]
fn set_dispute_contract_only_proposes_until_timelock_elapses() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let old_dispute = Address::generate(&f.env);
    let new_dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &old_dispute);

    f.c().set_dispute_contract(&new_dispute);

    let data = event_data(&f.env, "dispute_contract_proposed");
    let proposed: Address = field(&f.env, &data, "new_contract");
    let effective_at: u64 = field(&f.env, &data, "effective_at");
    assert_eq!(proposed, new_dispute);
    assert_eq!(effective_at, 1_000 + DISPUTE_CONTRACT_TIMELOCK_SECONDS);

    assert_eq!(f.c().dispute_contract(), old_dispute, "not rotated yet");
    let pending = f.c().pending_dispute_contract().unwrap();
    assert_eq!(pending.new_contract, new_dispute);
    assert_eq!(pending.effective_at, effective_at);

    let res = f.c().try_apply_dispute_contract();
    assert!(matches!(
        res,
        Err(Ok(EscrowError::DisputeContractTimelockActive))
    ));
    assert_eq!(f.c().dispute_contract(), old_dispute);
}

#[test]
fn apply_dispute_contract_rotates_and_emits_event_after_timelock() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let old_dispute = Address::generate(&f.env);
    let new_dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &old_dispute);
    f.c().set_dispute_contract(&new_dispute);

    f.env
        .ledger()
        .set_timestamp(1_000 + DISPUTE_CONTRACT_TIMELOCK_SECONDS);
    f.c().apply_dispute_contract();

    // Read the log before any further invocation: the test env exposes the
    // events of recent invocations only, so a later call (the view read
    // below) clears them.
    let data = event_data(&f.env, "dispute_contract_updated");
    let old_contract: Address = field(&f.env, &data, "old_contract");
    let new_contract: Address = field(&f.env, &data, "new_contract");
    assert_eq!(old_contract, old_dispute);
    assert_eq!(new_contract, new_dispute);

    let topic_admin: Address = event_topic1(&f.env, "dispute_contract_updated");
    assert_eq!(topic_admin, admin, "admin is the #[topic] field");

    assert_eq!(
        f.c().dispute_contract(),
        new_dispute,
        "view reflects rotation"
    );
    assert!(f.c().pending_dispute_contract().is_none());
}

#[test]
fn apply_dispute_contract_without_proposal_is_rejected() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    init_escrow(&f, &admin, &Address::generate(&f.env));
    let res = f.c().try_apply_dispute_contract();
    assert!(matches!(
        res,
        Err(Ok(EscrowError::NoPendingDisputeContract))
    ));
}

#[test]
fn cancel_dispute_contract_change_clears_pending_proposal() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let old_dispute = Address::generate(&f.env);
    let new_dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &old_dispute);
    f.c().set_dispute_contract(&new_dispute);

    f.c().cancel_dispute_contract_change();
    let data = event_data(&f.env, "dispute_contract_cancelled");
    let cancelled: Address = field(&f.env, &data, "cancelled_contract");
    assert_eq!(cancelled, new_dispute);

    assert!(f.c().pending_dispute_contract().is_none());
    f.env
        .ledger()
        .set_timestamp(1_000 + DISPUTE_CONTRACT_TIMELOCK_SECONDS);
    let res = f.c().try_apply_dispute_contract();
    assert!(matches!(
        res,
        Err(Ok(EscrowError::NoPendingDisputeContract))
    ));
    assert_eq!(f.c().dispute_contract(), old_dispute);

    let res = f.c().try_cancel_dispute_contract_change();
    assert!(matches!(
        res,
        Err(Ok(EscrowError::NoPendingDisputeContract))
    ));
}

#[test]
fn re_proposing_replaces_pending_and_restarts_timelock() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    init_escrow(&f, &admin, &Address::generate(&f.env));
    let first = Address::generate(&f.env);
    let second = Address::generate(&f.env);
    f.c().set_dispute_contract(&first);

    f.env.ledger().set_timestamp(2_000);
    f.c().set_dispute_contract(&second);

    let pending = f.c().pending_dispute_contract().unwrap();
    assert_eq!(pending.new_contract, second);
    assert_eq!(
        pending.effective_at,
        2_000 + DISPUTE_CONTRACT_TIMELOCK_SECONDS
    );
}

#[test]
fn set_dispute_contract_before_init_is_rejected() {
    let f = fixture();
    let dispute = Address::generate(&f.env);
    let res = f.c().try_set_dispute_contract(&dispute);
    assert!(matches!(res, Err(Ok(EscrowError::NotInitialized))));
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

#[test]
#[should_panic]
fn init_requires_admin_auth() {
    // Fresh env with no mocked auths: `admin.require_auth()` must panic.
    let env = Env::default();
    let escrow = env.register(EscrowContract, ());
    let admin = Address::generate(&env);
    let dispute = Address::generate(&env);
    EscrowContractClient::new(&env, &escrow).init(&admin, &dispute);
}

#[test]
#[should_panic]
fn set_dispute_timeout_requires_admin_auth() {
    let f = fixture();
    let admin = Address::generate(&f.env);
    let dispute = Address::generate(&f.env);
    init_escrow(&f, &admin, &dispute);
    f.env.set_auths(&[]);
    f.c().set_dispute_timeout(&120);
}

#[test]
#[should_panic]
fn fund_requires_client_auth() {
    // Set up the escrow while auths are mocked, then disable mocking for the
    // call under test so the missing client authorization must panic.
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &10_000,
    );
    f.env.set_auths(&[]);
    f.c().fund(&id);
}

#[test]
#[should_panic]
fn update_milestones_requires_client_auth() {
    // A non-client cannot produce the client's authorization, so the call panics.
    let f = fixture();
    let id = f.c().create(
        &f.client,
        &f.freelancer,
        &f.token,
        &milestones(&f.env, &[1_000]),
        &10_000,
    );
    f.env.set_auths(&[]);
    f.c().update_milestones(&id, &milestones(&f.env, &[500]));
}

#[test]
#[should_panic]
fn release_milestone_requires_client_auth() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.env.set_auths(&[]);
    f.c().release_milestone(&id, &0);
}

#[test]
#[should_panic]
fn open_dispute_requires_initiator_auth() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.env.set_auths(&[]);
    f.c().open_dispute(&id, &f.client);
}

#[test]
#[should_panic]
fn reclaim_expired_requires_client_auth() {
    let f = fixture();
    let id = f.funded(&[1_000]);
    f.env.ledger().set_timestamp(10_001); // past expiry
    f.env.set_auths(&[]);
    f.c().reclaim_expired(&id);
}

// ---------------------------------------------------------------------------
// Cross-language encoding: the arguments the backend builds for `create`
// ---------------------------------------------------------------------------

/// The exact `Vec<Milestone>` XDR that `backend/src/lib/escrowArgs.ts` builds
/// for a known input, pinned byte-for-byte in
/// `backend/src/__tests__/escrowArgs.test.ts` (and mirrored by the frontend's
/// `milestonesToScVal`). The maps are keyed by `Symbol` with keys in
/// **ascending order** — the layout a `#[contracttype]` struct decodes from.
const BACKEND_MILESTONES_XDR: &str =
    "AAAAEAAAAAEAAAACAAAAEQAAAAEAAAAEAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAAAAAAEsAAAADwAAAAhkZWFkbGluZQAAAAUAAAAAAAAAAAAAAA8AAAAIcmVsZWFzZWQAAAAAAAAAAAAAAA8AAAAPcmVsZWFzZWRfYW1vdW50AAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAAEAAAAEAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAAAAAAK8AAAADwAAAAhkZWFkbGluZQAAAAUAAAAAZVPxAAAAAA8AAAAIcmVsZWFzZWQAAAAAAAAAAAAAAA8AAAAPcmVsZWFzZWRfYW1vdW50AAAAAAoAAAAAAAAAAAAAAAAAAAAA";

/// The same two milestones encoded in the `Milestone` **declaration** order
/// (`amount`, `released`, `released_amount`, `deadline`) — what the backend
/// produced before the encoding was sorted. Kept here as the negative case.
const UNSORTED_MILESTONES_XDR: &str =
    "AAAAEAAAAAEAAAACAAAAEQAAAAEAAAAEAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAAAAAAEsAAAADwAAAAhyZWxlYXNlZAAAAAAAAAAAAAAADwAAAA9yZWxlYXNlZF9hbW91bnQAAAAACgAAAAAAAAAAAAAAAAAAAAAAAAAPAAAACGRlYWRsaW5lAAAABQAAAAAAAAAAAAAAEQAAAAEAAAAEAAAADwAAAAZhbW91bnQAAAAAAAoAAAAAAAAAAAAAAAAAAAK8AAAADwAAAAhyZWxlYXNlZAAAAAAAAAAAAAAADwAAAA9yZWxlYXNlZF9hbW91bnQAAAAACgAAAAAAAAAAAAAAAAAAAAAAAAAPAAAACGRlYWRsaW5lAAAABQAAAABlU/EA";

/// Call `create` with raw `ScVal` arguments, the way a client that built the
/// XDR out of band (the backend, the frontend) submits it.
fn create_raw(f: &Fixture, milestones_xdr: &str) -> Result<u64, std::string::String> {
    let parsed = <xdr::ScVal as ReadXdr>::from_xdr_base64(milestones_xdr, Limits::none())
        .map_err(|_| std::string::String::from("milestone XDR does not parse"))?;

    let milestones_val = Val::try_from_val(&f.env, &parsed)
        .map_err(|_| std::string::String::from("milestones rejected: invalid Val"))?;

    let milestones = Vec::<Milestone>::try_from_val(&f.env, &milestones_val).map_err(|_| {
        std::string::String::from("milestones rejected: cannot convert to Milestone vec")
    })?;

    let res = f
        .c()
        .try_create(&f.client, &f.freelancer, &f.token, &milestones, &10_000);

    match res {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(err)) => Err(std::format!("create rejected: {err:?}")),
        Err(err) => Err(std::format!(
            "create rejected with invocation error: {err:?}"
        )),
    }
}

#[test]
fn create_accepts_the_backends_pinned_milestone_xdr() {
    let f = fixture();

    let id = create_raw(&f, BACKEND_MILESTONES_XDR).expect("the pinned encoding must be accepted");

    // The state it stored is the state the bytes described.
    let data = f.c().get(&id);
    assert_eq!(data.milestones.len(), 2);
    let first = data.milestones.get(0).unwrap();
    assert_eq!(first.amount, 300);
    assert_eq!(first.deadline, 0);
    assert!(!first.released);
    assert_eq!(first.released_amount, 0);
    let second = data.milestones.get(1).unwrap();
    assert_eq!(second.amount, 700);
    assert_eq!(second.deadline, 1_700_000_000);
    assert_eq!(data.total_amount, 1_000);
}

#[test]
fn create_rejects_milestone_maps_whose_keys_are_not_sorted() {
    // The declaration-order encoding carries identical fields but not in the
    // sorted order the host requires of `ScMap`s; the two encodings are NOT
    // interchangeable on-chain, which is why the backend sorts and pins the
    // bytes. If this test starts passing, the host relaxed the rule and the
    // comment in `escrowArgs.ts` should be revisited.
    let f = fixture();
    let err = create_raw(&f, UNSORTED_MILESTONES_XDR)
        .expect_err("an unsorted ScMap must not be accepted as contract args");
    assert!(
        err.contains("rejected") || err.contains("does not parse"),
        "unexpected failure: {err}"
    );
}
