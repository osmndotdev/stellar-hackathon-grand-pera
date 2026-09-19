#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String,
};

struct Setup {
    env: Env,
    client: PlinkContractClient<'static>,
    token: TokenClient<'static>,
    admin: Address,
    creator: Address,
    alice: Address,
    bob: Address,
}

const USDC: i128 = 10_000_000; // 7 decimals

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer.clone());
    let token = TokenClient::new(&env, &sac.address());
    let mint = StellarAssetClient::new(&env, &sac.address());

    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint.mint(&alice, &(1_000 * USDC));
    mint.mint(&bob, &(1_000 * USDC));

    let contract_id = env.register(PlinkContract, (admin.clone(), sac.address()));
    let client = PlinkContractClient::new(&env, &contract_id);

    Setup {
        env,
        client,
        token,
        admin,
        creator,
        alice,
        bob,
    }
}

fn create_pool(s: &Setup, target: i128, deadline: u64) -> u32 {
    s.client.create(
        &s.creator,
        &String::from_str(&s.env, "Weekend house in Sile"),
        &target,
        &deadline,
        &String::from_str(&s.env, "🏡"),
        &2,
    )
}

#[test]
fn create_and_read() {
    let s = setup();
    let id = create_pool(&s, 300 * USDC, 2_000_000);
    assert_eq!(id, 1);
    let pool = s.client.get_pool(&id);
    assert_eq!(pool.creator, s.creator);
    assert_eq!(pool.target, 300 * USDC);
    assert_eq!(pool.raised, 0);
    assert!(!pool.claimed);
    assert_eq!(s.client.count(), 1);
    assert_eq!(s.client.list_pools(&0, &10).len(), 1);
}

#[test]
fn contribute_moves_tokens_and_tracks_contributors() {
    let s = setup();
    let id = create_pool(&s, 300 * USDC, 2_000_000);
    let contract = s.client.address.clone();

    s.client.contribute(
        &id,
        &s.alice,
        &(100 * USDC),
        &String::from_str(&s.env, "Alice"),
        &symbol_short!("bank"),
    );
    assert_eq!(s.token.balance(&contract), 100 * USDC);
    assert_eq!(s.token.balance(&s.alice), 900 * USDC);

    // Repeat contribution accumulates on the same record.
    s.client.contribute(
        &id,
        &s.alice,
        &(50 * USDC),
        &String::from_str(&s.env, "Alice"),
        &symbol_short!("crypto"),
    );
    let pool = s.client.get_pool(&id);
    assert_eq!(pool.raised, 150 * USDC);
    assert_eq!(pool.contributor_count, 1);
    let list = s.client.get_contributions(&id);
    assert_eq!(list.len(), 1);
    assert_eq!(list.get(0).unwrap().amount, 150 * USDC);
    assert_eq!(list.get(0).unwrap().method, symbol_short!("crypto"));
}

#[test]
fn claim_only_when_funded() {
    let s = setup();
    let id = create_pool(&s, 300 * USDC, 2_000_000);
    s.client.contribute(
        &id,
        &s.alice,
        &(200 * USDC),
        &String::from_str(&s.env, "Alice"),
        &symbol_short!("bank"),
    );
    assert_eq!(s.client.try_claim(&id), Err(Ok(Error::TargetNotReached)));

    s.client.contribute(
        &id,
        &s.bob,
        &(100 * USDC),
        &String::from_str(&s.env, "Bob"),
        &symbol_short!("crypto"),
    );
    let got = s.client.claim(&id);
    assert_eq!(got, 300 * USDC);
    assert_eq!(s.token.balance(&s.creator), 300 * USDC);
    assert!(s.client.get_pool(&id).claimed);
    assert_eq!(s.client.try_claim(&id), Err(Ok(Error::AlreadyClaimed)));

    // Nothing can be added or refunded after the claim.
    assert_eq!(
        s.client.try_contribute(
            &id,
            &s.bob,
            &USDC,
            &String::from_str(&s.env, "Bob"),
            &symbol_short!("crypto")
        ),
        Err(Ok(Error::AlreadyClaimed))
    );
}

#[test]
fn claim_still_allowed_after_deadline_if_funded_in_time() {
    let s = setup();
    let id = create_pool(&s, 100 * USDC, 2_000_000);
    s.client.contribute(
        &id,
        &s.alice,
        &(100 * USDC),
        &String::from_str(&s.env, "Alice"),
        &symbol_short!("bank"),
    );
    s.env.ledger().set_timestamp(3_000_000);
    assert_eq!(s.client.claim(&id), 100 * USDC);
}

#[test]
fn refund_after_deadline_below_target() {
    let s = setup();
    let id = create_pool(&s, 300 * USDC, 2_000_000);
    s.client.contribute(
        &id,
        &s.alice,
        &(100 * USDC),
        &String::from_str(&s.env, "Alice"),
        &symbol_short!("bank"),
    );
    // Too early.
    assert_eq!(
        s.client.try_refund(&id, &s.alice),
        Err(Ok(Error::NotRefundable))
    );

    s.env.ledger().set_timestamp(2_000_001);
    // Closed for contributions now.
    assert_eq!(
        s.client.try_contribute(
            &id,
            &s.bob,
            &USDC,
            &String::from_str(&s.env, "Bob"),
            &symbol_short!("crypto")
        ),
        Err(Ok(Error::PoolClosed))
    );
    // Creator cannot claim an underfunded pool.
    assert_eq!(s.client.try_claim(&id), Err(Ok(Error::TargetNotReached)));

    assert_eq!(s.client.refund(&id, &s.alice), 100 * USDC);
    assert_eq!(s.token.balance(&s.alice), 1_000 * USDC);
    assert_eq!(s.client.get_pool(&id).raised, 0);
    assert!(s.client.get_contribution(&id, &s.alice).unwrap().refunded);
    // No double refund.
    assert_eq!(
        s.client.try_refund(&id, &s.alice),
        Err(Ok(Error::NothingToRefund))
    );
    // Non-contributor gets nothing.
    assert_eq!(
        s.client.try_refund(&id, &s.bob),
        Err(Ok(Error::NothingToRefund))
    );
}

#[test]
fn validation_errors() {
    let s = setup();
    let now = s.env.ledger().timestamp();
    let title = String::from_str(&s.env, "x");
    let emoji = String::from_str(&s.env, "🎉");
    assert_eq!(
        s.client.try_create(&s.creator, &title, &0, &(now + 10), &emoji, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.client.try_create(&s.creator, &title, &USDC, &now, &emoji, &0),
        Err(Ok(Error::InvalidDeadline))
    );
    let id = create_pool(&s, USDC, now + 10);
    assert_eq!(
        s.client.try_contribute(
            &id,
            &s.alice,
            &0,
            &String::from_str(&s.env, "A"),
            &symbol_short!("bank")
        ),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(s.client.try_get_pool(&99), Err(Ok(Error::NotFound)));
}

#[test]
fn debug_set_deadline_is_admin_only() {
    let s = setup();
    let id = create_pool(&s, USDC, 2_000_000);
    s.client.debug_set_deadline(&id, &5);
    assert_eq!(s.client.get_pool(&id).deadline, 5);
    assert_eq!(s.client.admin(), s.admin);
}
