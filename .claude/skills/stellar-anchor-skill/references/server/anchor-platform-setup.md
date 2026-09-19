# Anchor Platform Setup

The SDF's **Anchor Platform** is the reference server-side implementation of the anchor SEPs. It does the SEP plumbing (SEP-1, SEP-10 auth, SEP-12 KYC dispatch, SEP-24/6/31 transaction state machines, SEP-38 quote orchestration) so that your team only writes the *business* parts: KYC validation, banking-rail integration, custody, and rate sourcing.

Authoritative sources — always check these before this file, they change faster than I do:

- Repo: https://github.com/stellar/anchor-platform
- Admin guide: https://developers.stellar.org/docs/platforms/anchor-platform/admin-guide
- Getting started: https://developers.stellar.org/docs/platforms/anchor-platform/admin-guide/getting-started

This file is the on-ramp. The exact env-var names and YAML keys evolve release-to-release; treat anything here as a starting point and verify against the repo's current `config/` directory.

---

## Component map

```
                +-------------------------+
   wallets ---> |     SEP Server          |  :8080   public SEP-1/6/10/12/24/31/38 endpoints
                +-------------------------+
                            |
                  (events via Kafka)
                            v
                +-------------------------+
                |     Platform API        |  :8085   internal API your business server calls
                +-------------------------+
                            ^
                            |   (callbacks: rates, fees, KYC, custody, payment delivery)
                            |
                +-------------------------+
                |  Your business server   |  :8091  (or wherever)
                +-------------------------+

  +-------------------------+         +--------------------+
  |   Stellar Observer      | <-----> |  Stellar network   |
  +-------------------------+         +--------------------+
            |
   (deposit detection, on-chain status)
            v
   Event Processor (Kafka consumer)
```

What each one owns:

- **SEP Server** — the only thing wallets talk to. Implements SEP-1/6/10/12/24/31/38 endpoints, issues SEP-10 JWTs, hosts the SEP-24 interactive UI.
- **Platform API** — internal HTTP API your business server uses to read transactions, patch transaction status, and react to events. Never exposed to the public internet.
- **Stellar Observer** — watches Horizon for deposits to your distribution account and emits Kafka events.
- **Event Processor** — turns Kafka events into business-server callbacks (`transaction_created`, `transaction_status_changed`, …).
- **Your business server** — every domain decision lives here: which fields KYC requires, which rate to quote, which off-chain payout to fire. The platform leaves it to you on purpose.

Postgres holds transactions; Kafka brokers events. Both are dependencies in `quick-run/docker-compose.yaml`.

---

## Quickstart on testnet

```bash
git clone https://github.com/stellar/anchor-platform.git
cd anchor-platform/quick-run
./ap_start.sh
```

This brings up the SEP Server, Platform API, Stellar Observer, Event Processor, reference business server, Postgres, and Kafka. After a minute:

```bash
curl http://localhost:8080/.well-known/stellar.toml
docker-compose ps
```

If `stellar.toml` returns and all services are `Up`, you have a working anchor on testnet.

To swap the reference business server for your own:

```bash
docker-compose stop reference-server
# point the platform at your business server URL via the env vars below
# run your business server on the chosen port
```

---

## The `config/` directory

Inside `quick-run/config/` (names per the current admin guide):

| File | What it owns |
|---|---|
| `assets.yaml` | Asset definitions — codes, issuers, decimals, distribution accounts, enabled SEPs per asset. |
| `clients.yaml` | Allowed SEP-10 client domains (non-custodial wallets you want to authenticate). |
| `reference-config.yaml` | Reference business server settings — example KYC fields, fees, rate behavior. |
| `stellar.localhost.toml` | The `stellar.toml` served at `/.well-known/stellar.toml`. |
| `dev.env` | Environment variables for the SEP Server, Platform API, Observer, Event Processor. |

Everything below is wired via env vars in `dev.env` or in the corresponding production `.env`. Names may change; the canonical list lives in the repo's `service-runner/src/main/resources/` and in the admin guide.

---

## Enabling SEPs

Each SEP is independently togglable. Conceptually:

```env
SEP1_ENABLED=true
SEP10_ENABLED=true
SEP12_ENABLED=true
SEP24_ENABLED=true
SEP6_ENABLED=false        # only if you want the programmatic API
SEP31_ENABLED=false       # only if you're a cross-border corridor
SEP38_ENABLED=true        # required for non-1:1 conversions in any of the above
```

Then per asset in `assets.yaml`, declare which SEPs apply (deposit/withdraw for SEP-6/24, send/receive for SEP-31, …) and what limits and fees are.

A minimal `assets.yaml` for a USDC anchor:

```yaml
assets:
  - schema: stellar
    code: USDC
    issuer: GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
    distribution_account: GD…              # the hot account that holds USDC for payouts
    significant_decimals: 7
    sep24_enabled: true
    sep31_enabled: false
    deposit:
      enabled: true
      min_amount: 1
      max_amount: 10000
      methods: [SEPA, SWIFT]
    withdraw:
      enabled: true
      min_amount: 5
      max_amount: 10000
      methods: [bank_account]
```

The exact YAML schema evolves — copy from the repo's example, modify, don't write from scratch.

---

## Secrets — the must-set environment variables

The platform refuses to start without certain secrets. The names below are *representative*; cross-check against `config/dev.env.example` in the repo for the current spelling.

| Secret | Role |
|---|---|
| `SECRET_JWT_KEY` | Symmetric key used to sign SEP-10 JWTs and the JWT short-lived tokens passed into the SEP-24 interactive URL. ≥ 32 random bytes. |
| `SECRET_SEP10_SIGNING_SEED` | Stellar secret seed (`S…`) that signs the SEP-10 challenge transactions. Its public key MUST equal `SIGNING_KEY` in `stellar.toml`. Used network-wide for verifying everything signed by your anchor. |
| `SECRET_PLATFORM_API_AUTH_SECRET` | Shared secret your business server presents when calling the internal Platform API. Required when `platform_api.auth.type=JWT`. |
| `SECRET_CALLBACK_API_AUTH_SECRET` | The other direction: the platform presents this when calling your business server's callbacks. |
| `SECRET_DATA_USERNAME` / `SECRET_DATA_PASSWORD` | Postgres credentials. |
| `SECRET_EVENTS_QUEUE_KAFKA_*` | Kafka credentials if you're using a hosted Kafka. |

**Key separation, in production**

The platform does NOT custody the user-facing distribution account. The `distribution_account` in `assets.yaml` is a Stellar account, but the platform does NOT need its secret key directly when running in **custody-server** mode — the custody server (or an external custodian like Fireblocks) signs payouts. Read [business-server.md](business-server.md) for that pipeline.

Where keys live:

- `SECRET_SEP10_SIGNING_SEED` — auth signing only. Never the distribution key. Compromise costs you the ability to authenticate users until rotated; it does NOT cost you funds.
- Distribution account secret — never put it in the platform's env. It belongs in the custody layer (Fireblocks API key, signing service, HSM). For dev/testnet you can use a local secret in the custody server, but for mainnet anything other than a real custody integration is a footgun.

---

## Testnet vs mainnet — the variables that move

| | Testnet | Mainnet |
|---|---|---|
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` (or run your own) |
| `STELLAR_NETWORK_BASE_FEE` | 100 stroops fine | Track network base fee; under-feeing means transactions sit in the queue |
| Friendbot | Available — use it to fund accounts | Doesn't exist; fund accounts from your treasury |
| Asset issuers | Test issuers (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` for SDF's test USDC) | Real issuers (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` for Circle's USDC) |

A mistake worth flagging: setting the **mainnet** passphrase while pointing at the **testnet** Horizon (or vice versa) makes every signed transaction get rejected with a generic "tx_bad_seq" or "tx_bad_auth" — Horizon doesn't surface "you signed with the wrong network." Pin both at the same time when you flip.

---

## Wiring your business server

When the SEP Server needs a non-SEP decision (compute a fee, fetch a rate, deliver a payout), it calls *your* business server. You configure the URL in `dev.env`:

```env
CALLBACK_API_BASE_URL=http://your-business-server:8091
```

Your business server must implement the callback API the platform documents (see [business-server.md](business-server.md)). The reference server in `quick-run` is a Kotlin example you can read end-to-end.

Authentication on the call goes both ways:

- Platform → business server: signs requests with `SECRET_CALLBACK_API_AUTH_SECRET`.
- Business server → Platform API: presents `SECRET_PLATFORM_API_AUTH_SECRET`.

---

## Validating the setup before moving on

The single best test is the SEP compliance suite. From the project root:

```bash
npx stellar-anchor-tests \
  --home-domain localhost:8080 \
  --seps 1 10 24 \
  --asset-code USDC \
  --verbose
```

See [testing-and-validation.md](../testing/testing-and-validation.md) for the full surface and the agentic-loop pattern. **If this passes locally, you have a real SEP-compliant anchor.** If it fails, fix before any other work — every failure points at a `assets.yaml`, `stellar.toml`, or env-var problem you'd rather find now than in production.

---

## Footgun checklist (anchor-platform-specific)

- **`SIGNING_KEY` in `stellar.toml` must equal the public key of `SECRET_SEP10_SIGNING_SEED`.** They drift the moment one is rotated and not the other. Verify on every deploy.
- **`distribution_account` in `assets.yaml` must hold a trustline to the asset.** Without it, payouts fail with `op_no_trust`. The platform doesn't auto-trustline for you.
- **`WEB_AUTH_ENDPOINT` host in your `stellar.toml` must match what the SEP Server actually serves.** Behind a reverse proxy or load balancer, the host the public sees can differ from the host the container thinks it's on — the SEP-10 `web_auth_domain` ManageData op uses the *served* host. Mismatch → wallets sign challenges that the server rejects.
- **Postgres and Kafka are mandatory, not optional.** The platform does not run in-memory for production. Treat them as core infrastructure with monitoring and backups.
- **The reference business server is for *learning*, not production.** It hard-codes example KYC, fakes off-chain payouts, and does not implement custody integration. Replace it.
- **Mainnet base fee is dynamic.** Hard-coding `100` stroops is fine on testnet; on mainnet, fetch from `/fee_stats` or pay > p50 to avoid stuck transactions during congestion.
- **CORS for `/.well-known/stellar.toml` is on the *web server* fronting the SEP Server**, not on the SEP Server itself in every config. Check the served headers, not just the YAML.
