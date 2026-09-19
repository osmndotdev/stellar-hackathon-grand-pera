//! Plink: link-first group funding.
//!
//! One pool = one goal. Contributions (USDC) are held by this contract until
//! either the target is reached (the creator can `claim`) or the deadline
//! passes below target (each contributor can `refund`).
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient,
    Address, Env, String, Symbol, Vec,
};

const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_TO: u32 = 120 * DAY_IN_LEDGERS;

const MAX_TITLE_LEN: u32 = 80;
const MAX_NAME_LEN: u32 = 32;
const MAX_CONTRIBUTORS: u32 = 200;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Count,
    Pool(u32),
    Contrib(u32, Address),
    Contributors(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pool {
    pub id: u32,
    pub creator: Address,
    /// Display name the creator chose (informational).
    pub organizer: String,
    pub title: String,
    /// Funding target in token base units (USDC has 7 decimals).
    pub target: i128,
    /// Unix timestamp (seconds). Contributions close after it.
    pub deadline: u64,
    pub raised: i128,
    pub claimed: bool,
    /// Index into the frontend's accent palette.
    pub vibe: u32,
    pub emoji: String,
    pub created_at: u64,
    pub contributor_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contribution {
    pub contributor: Address,
    pub amount: i128,
    pub name: String,
    /// "bank" or "crypto" — how the contributor paid in. Informational only.
    pub method: Symbol,
    pub at: u64,
    pub refunded: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidAmount = 2,
    InvalidDeadline = 3,
    TitleTooLong = 4,
    NameTooLong = 5,
    PoolClosed = 6,
    AlreadyClaimed = 7,
    TargetNotReached = 8,
    NotRefundable = 9,
    NothingToRefund = 10,
    TooManyContributors = 11,
}

#[contractevent]
pub struct PoolCreated {
    #[topic]
    pub id: u32,
    #[topic]
    pub creator: Address,
    pub target: i128,
    pub deadline: u64,
}

#[contractevent]
pub struct Contributed {
    #[topic]
    pub id: u32,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub raised: i128,
}

#[contractevent]
pub struct Claimed {
    #[topic]
    pub id: u32,
    #[topic]
    pub creator: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Refunded {
    #[topic]
    pub id: u32,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
}

#[contract]
pub struct PlinkContract;

#[contractimpl]
impl PlinkContract {
    /// `token` is the settlement asset (USDC SAC on testnet).
    pub fn __constructor(env: Env, admin: Address, token: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Count, &0u32);
    }

    // ---------------------------------------------------------------- writes

    pub fn create(
        env: Env,
        creator: Address,
        organizer: String,
        title: String,
        target: i128,
        deadline: u64,
        emoji: String,
        vibe: u32,
    ) -> Result<u32, Error> {
        creator.require_auth();
        if organizer.len() > MAX_NAME_LEN {
            return Err(Error::NameTooLong);
        }
        if target <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }
        if title.len() > MAX_TITLE_LEN || title.len() == 0 {
            return Err(Error::TitleTooLong);
        }
        bump_instance(&env);

        let id: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0) + 1;
        env.storage().instance().set(&DataKey::Count, &id);

        let pool = Pool {
            id,
            creator: creator.clone(),
            organizer,
            title,
            target,
            deadline,
            raised: 0,
            claimed: false,
            vibe,
            emoji,
            created_at: env.ledger().timestamp(),
            contributor_count: 0,
        };
        put_pool(&env, &pool);
        let empty: Vec<Address> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Contributors(id), &empty);
        bump_key(&env, &DataKey::Contributors(id));

        PoolCreated {
            id,
            creator,
            target,
            deadline,
        }
        .publish(&env);
        Ok(id)
    }

    /// Move `amount` of the settlement token from `from` into the pool.
    /// A repeat contribution from the same address is added to their record.
    pub fn contribute(
        env: Env,
        id: u32,
        from: Address,
        amount: i128,
        name: String,
        method: Symbol,
    ) -> Result<i128, Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if name.len() > MAX_NAME_LEN {
            return Err(Error::NameTooLong);
        }
        let mut pool = get_pool(&env, id)?;
        if pool.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if env.ledger().timestamp() > pool.deadline {
            return Err(Error::PoolClosed);
        }
        bump_instance(&env);

        let token = TokenClient::new(&env, &token_address(&env));
        token.transfer(&from, &env.current_contract_address(), &amount);

        let key = DataKey::Contrib(id, from.clone());
        let now = env.ledger().timestamp();
        let contrib = match env.storage().persistent().get::<_, Contribution>(&key) {
            Some(mut c) => {
                c.amount += amount;
                c.name = name;
                c.method = method;
                c.at = now;
                c.refunded = false;
                c
            }
            None => {
                let mut list: Vec<Address> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Contributors(id))
                    .unwrap_or(Vec::new(&env));
                if list.len() >= MAX_CONTRIBUTORS {
                    return Err(Error::TooManyContributors);
                }
                list.push_back(from.clone());
                env.storage()
                    .persistent()
                    .set(&DataKey::Contributors(id), &list);
                bump_key(&env, &DataKey::Contributors(id));
                pool.contributor_count += 1;
                Contribution {
                    contributor: from.clone(),
                    amount,
                    name,
                    method,
                    at: now,
                    refunded: false,
                }
            }
        };
        env.storage().persistent().set(&key, &contrib);
        bump_key(&env, &key);

        pool.raised += amount;
        put_pool(&env, &pool);

        Contributed {
            id,
            contributor: from,
            amount,
            raised: pool.raised,
        }
        .publish(&env);
        Ok(pool.raised)
    }

    /// Creator takes the pooled funds once the target is reached.
    pub fn claim(env: Env, id: u32) -> Result<i128, Error> {
        let mut pool = get_pool(&env, id)?;
        pool.creator.require_auth();
        if pool.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if pool.raised < pool.target {
            return Err(Error::TargetNotReached);
        }
        bump_instance(&env);

        let amount = pool.raised;
        pool.claimed = true;
        put_pool(&env, &pool);

        let token = TokenClient::new(&env, &token_address(&env));
        token.transfer(&env.current_contract_address(), &pool.creator, &amount);

        Claimed {
            id,
            creator: pool.creator,
            amount,
        }
        .publish(&env);
        Ok(amount)
    }

    /// After the deadline, if the target was missed, a contributor reclaims
    /// their tokens.
    pub fn refund(env: Env, id: u32, contributor: Address) -> Result<i128, Error> {
        contributor.require_auth();
        let mut pool = get_pool(&env, id)?;
        if pool.claimed {
            return Err(Error::AlreadyClaimed);
        }
        if env.ledger().timestamp() <= pool.deadline || pool.raised >= pool.target {
            return Err(Error::NotRefundable);
        }
        let key = DataKey::Contrib(id, contributor.clone());
        let mut contrib: Contribution = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NothingToRefund)?;
        if contrib.refunded || contrib.amount == 0 {
            return Err(Error::NothingToRefund);
        }
        bump_instance(&env);

        let amount = contrib.amount;
        contrib.refunded = true;
        env.storage().persistent().set(&key, &contrib);
        bump_key(&env, &key);

        pool.raised -= amount;
        put_pool(&env, &pool);

        let token = TokenClient::new(&env, &token_address(&env));
        token.transfer(&env.current_contract_address(), &contributor, &amount);

        Refunded {
            id,
            contributor,
            amount,
        }
        .publish(&env);
        Ok(amount)
    }

    // ------------------------------------------------------------- demo only

    /// DEMO HELPER (admin only): rewrite a pool's deadline so an "expired,
    /// underfunded" pool can be staged for the refund demo without waiting.
    /// Not part of the product; remove before any mainnet deployment.
    pub fn debug_set_deadline(env: Env, id: u32, deadline: u64) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let mut pool = get_pool(&env, id)?;
        pool.deadline = deadline;
        put_pool(&env, &pool);
        Ok(())
    }

    // ----------------------------------------------------------------- reads

    pub fn get_pool(env: Env, id: u32) -> Result<Pool, Error> {
        get_pool(&env, id)
    }

    pub fn get_contribution(env: Env, id: u32, contributor: Address) -> Option<Contribution> {
        env.storage()
            .persistent()
            .get(&DataKey::Contrib(id, contributor))
    }

    pub fn get_contributions(env: Env, id: u32) -> Vec<Contribution> {
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Contributors(id))
            .unwrap_or(Vec::new(&env));
        let mut out: Vec<Contribution> = Vec::new(&env);
        for addr in list.iter() {
            if let Some(c) = env
                .storage()
                .persistent()
                .get::<_, Contribution>(&DataKey::Contrib(id, addr))
            {
                out.push_back(c);
            }
        }
        out
    }

    /// Pools with ids in `[from, from + limit)`, skipping missing ones.
    pub fn list_pools(env: Env, from: u32, limit: u32) -> Vec<Pool> {
        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        let mut out: Vec<Pool> = Vec::new(&env);
        let mut i = if from == 0 { 1 } else { from };
        while i <= count && out.len() < limit {
            if let Ok(p) = get_pool(&env, i) {
                out.push_back(p);
            }
            i += 1;
        }
        out
    }

    pub fn count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    pub fn token(env: Env) -> Address {
        token_address(&env)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}

// ------------------------------------------------------------------ helpers

fn token_address(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

fn get_pool(env: &Env, id: u32) -> Result<Pool, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Pool(id))
        .ok_or(Error::NotFound)
}

fn put_pool(env: &Env, pool: &Pool) {
    let key = DataKey::Pool(pool.id);
    env.storage().persistent().set(&key, pool);
    bump_key(env, &key);
}

fn bump_key(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

mod test;
