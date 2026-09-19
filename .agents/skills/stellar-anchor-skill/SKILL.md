---
name: stellar-anchor-skill
description: |
  Integrate with or build Stellar anchors. Use this skill whenever the task involves moving between fiat and Stellar-issued assets. Triggers include: "fiat on-ramp", "off-ramp", "cash-in / cash-out", "deposit / withdrawal", "anchor integration", "wallet onboarding", "USDC deposit from bank", "Anchor Platform", "java-stellar-anchor-sdk", "anchor test suite", "interactive deposit flow", "KYC against an anchor", "RFQ / firm quote", "cross-border remittance on Stellar". The official `standards` skill points to SEP specifications; this skill is the implementation layer — what to build, in what order, and the non-obvious failure modes. Do NOT use for: reading raw SEP spec text (use stellar/standards); Soroban smart-contract work (use stellar/soroban); generic wallet/frontend UI (use stellar/dapp-frontend).
license: Apache-2.0
compatibility:
  - claude-code
  - agent-skills
metadata:
  author: Cheesecake Labs
  version: '0.1.0'
  category: stellar
  audience:
    - wallet-developers
    - fintech-engineers
    - protocol-integrators
  related-skills:
    - stellar/standards
    - stellar/soroban
    - stellar/dapp-frontend
---

# Stellar Anchor Integration

Anchors are the on/off-ramps of the Stellar network: regulated entities (fintechs, payment processors, exchanges) that issue Stellar assets backed 1:1 by fiat or other off-chain value, and that move users between bank rails and the network through a standardized set of SEPs (Stellar Ecosystem Proposals).

This skill covers **both sides** of anchor work:

- **Client side** — you are building a wallet or app that needs to deposit, withdraw, or transfer through someone else's anchor (Vibrant, Circle, etc.). Most users land here.
- **Server side** — you are the fintech building the anchor itself, usually on top of the SDF's Anchor Platform.

If you are not sure which side the task is, ask the user before loading reference files. Loading the wrong half wastes context.

---

## Gotchas — read this before writing any anchor code

These are the non-obvious failure modes that the SEP text under-emphasizes and that AI agents (and humans) consistently get wrong. Each is verified against the live spec and testanchor behavior; if you find one is stale, fix it and open a PR.

1. **The SEP-10 challenge transaction has sequence number 0 and must NEVER be submitted to the network.** Sign it locally and POST it back to the auth endpoint. Submitting it to Horizon/RPC will fail and looks like an auth bug; it is not — it is a category error about what the challenge is.
2. **`home_domain` is not `web_auth_domain`.** When the auth server lives on a different subdomain than the TOML host (e.g. TOML on `anchor.example.com`, auth on `auth.example.com`), the SEP-10 client must pass both correctly and the server must include `web_auth_domain` in the challenge. Conflating them produces a JWT that validates locally but is rejected by the anchor with cryptic errors.
3. **SEP-24 interactive URLs must open in a popup or system webview, not an iframe.** Anchors serve them with `X-Frame-Options: DENY` or a strict CSP. The completion signal comes via `postMessage`, not URL redirect — register the listener before opening the window.
4. **Withdrawals to a shared custodial anchor account require the exact `memo` and `memo_type` from the withdraw response.** The destination address is the same for every user; the memo is how funds are attributed. Omit it or send the wrong type and funds are stranded — most anchors will not auto-recover them.
5. **The user must have a trustline to the anchor's asset before a deposit can land**, unless the anchor advertises `claimable_balance_supported: true` in `/info`. Always check `/info` before quoting a flow to the user; do not assume claimable balance support.
6. **Persisted amounts come back as strings, not numbers.** SEP-24 / SEP-6 / SEP-31 transaction objects type `amount_in`, `amount_out`, and fee amounts as strings (e.g., `"100.0000000"`) — Stellar amounts have 7-decimal precision and `parseFloat` silently loses it. Parse with a decimal library. Equality checks ("did I send what the anchor expects?") must compare strings or decimals, never floats. Request bodies do accept numeric `amount`, but you still owe the user a decimal-safe path when echoing it back.
7. **`asset_code` alone is ambiguous** — `USDC` from Circle and `USDC` from a different issuer are different assets. Always pair `asset_code` with `asset_issuer` (or use SEP-38 asset identifiers like `stellar:USDC:GA5Z…`).
8. **Transaction status is a state machine, not a boolean.** The path is roughly `incomplete` → `pending_user_transfer_start` → `pending_anchor` / `pending_external` → `completed`. Branches differ by SEP: SEP-24 adds `pending_trust` (the deposit is waiting on a trustline you must create), `pending_user` (the user owes the anchor an action — re-open the interactive URL), and `on_hold` (compliance review). SEP-6 adds `pending_customer_info_update` (re-engage KYC via SEP-12) and `pending_transaction_info_update` (the anchor needs more transaction-level data). Map every status your code can see to a concrete user-facing action; ignoring a branch means a stuck transaction with no user-visible recovery path.
9. **SEP-38 firm quotes have an `expires_at` and live anchors reject expired ones.** The SEP-38 spec only obligates the anchor to honor the rate *until* `expires_at`; it does not formally define what happens after, so the failure mode is anchor-dependent (most return 400; some move the transaction into `error`). Always treat an expired-quote failure as a normal recoverable state: re-quote, re-post the SEP-6/24/31 request, and only surface a user-visible error if the re-quote itself fails. Do not surface the underlying "quote expired" string to the user.
10. **`stellar.toml` must live at `/.well-known/stellar.toml`, with `Access-Control-Allow-Origin: *` and ideally `Content-Type: text/plain`.** Missing CORS is the single most common SEP-1 discovery failure from browser-based wallets. SEP-1 itself does not literally require HTTPS for the TOML file, but every endpoint *listed inside it* (`TRANSFER_SERVER`, `WEB_AUTH_ENDPOINT`, `KYC_SERVER`, `ANCHOR_QUOTE_SERVER`, …) MUST be `https://`, and every modern wallet refuses to load an `http://` TOML — treat HTTPS as mandatory. The file must parse as valid TOML (a trailing comma kills the entire integration) and the spec caps it at 100 KB.
11. **SEP-10 does not mandate a JWT lifetime — each anchor picks its own.** The spec only says "Servers should select an expiration time for the JWT that is appropriate for the assumptions and risk of the interactions." In practice anchors range from ~15 minutes to a day, and a long KYC or interactive session WILL outlive the token at some anchors. Catch 401s on any authenticated call and re-run SEP-10 transparently; never bounce the user back to the start of the flow because a JWT lapsed.
12. **`/info` is the contract.** Read `deposit`, `withdraw`, `fee`, `transactions`, and `features` blocks before assuming any capability — anchors disable flows, change fees, and toggle `claimable_balance_supported` independently of the spec. Even the SDF's own `testanchor.stellar.org` advertises `features.account_creation: false` and `features.claimable_balances: false`; the *reference* anchor will not create accounts or use claimable balances for you. Assuming otherwise is the fastest way to a stuck deposit.
13. **The TOML `SIGNING_KEY` is used by more than just SEP-10.** It verifies the SEP-10 challenge transaction signature *and* the optional SEP-24 / SEP-6 URL-callback signature (`Signature: t=<ts>, s=<base64-ed25519>` over `<ts>.<wallet_host>.<body>`). Wallets often build two unrelated verification paths and load the key from two places that can drift. Resolve it once from `stellar.toml`, cache it, and reuse it for both.

---

## Quick start — which file do I load?

Decide what the user is doing, then load only the files you need.

### Client side — integrating with someone else's anchor

| Task | Load |
|---|---|
| Discover an anchor and authenticate a user | [references/client/discovery-and-auth.md](references/client/discovery-and-auth.md) |
| Interactive (hosted UI) deposit or withdraw | [references/client/sep24-interactive.md](references/client/sep24-interactive.md) |
| Programmatic / API-only deposit or withdraw | [references/client/sep6-programmatic.md](references/client/sep6-programmatic.md) |
| Collect or update KYC fields | [references/client/sep12-kyc.md](references/client/sep12-kyc.md) |
| Get an exchange rate or firm quote | [references/client/sep38-quotes.md](references/client/sep38-quotes.md) |
| Cross-border / sending-anchor → receiving-anchor remittance | [references/client/sep31-cross-border.md](references/client/sep31-cross-border.md) |

Almost every client flow starts with `discovery-and-auth.md`. Load it first unless the user has already proven SEP-1 + SEP-10 are working.

### Server side — building an anchor

| Task | Load |
|---|---|
| Stand up the SDF Anchor Platform (Docker, config) | [references/server/anchor-platform-setup.md](references/server/anchor-platform-setup.md) |
| Implement the business server callbacks (rates, fees, KYC, custody, payment observation) | [references/server/business-server.md](references/server/business-server.md) |
| Pre-launch checklist (custody, rate limits, compliance, monitoring) | [references/server/production-checklist.md](references/server/production-checklist.md) |

### Testing — for either side

| Task | Load |
|---|---|
| Validate against the SDF test anchor, the Demo Wallet, or `@stellar/anchor-tests` | [references/testing/testing-and-validation.md](references/testing/testing-and-validation.md) |

**You should run the testing flow whenever you finish an integration.** The SDF maintains a compliance test suite for exactly this purpose — running it is the difference between "it worked in my dev loop" and "it works in production."

---

## How the SEPs fit together

The SEPs are LEGO bricks; an anchor uses a subset depending on its product.

```
SEP-1   stellar.toml         — discovery (always)
SEP-10  Web Auth             — auth (always, unless SEP-31 anchor-to-anchor)
SEP-12  KYC API              — customer data (composed with SEP-6/24/31)
SEP-38  Quotes / RFQ         — pricing (optional but standard for non-1:1 conversions)
SEP-6   Programmatic         — API-only deposit/withdraw
SEP-24  Interactive          — hosted UI deposit/withdraw
SEP-31  Cross-border         — anchor-to-anchor remittance (no user wallet)
```

A typical retail wallet integration is **SEP-1 → SEP-10 → SEP-24** (+ SEP-38 if quotes shown pre-deposit, + SEP-12 if KYC happens outside the hosted UI).

A typical remittance platform is **SEP-1 → SEP-10 → SEP-12 → SEP-38 → SEP-31** — no end-user wallet involved, only the sending and receiving organizations.

---

## Spec ground truth

Specs change. Never assert SEP behavior from memory — fetch the current text from `stellar/stellar-protocol` on GitHub before producing code:

- SEP-1:  https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
- SEP-6:  https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0006.md
- SEP-9:  https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0009.md
- SEP-10: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
- SEP-12: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md
- SEP-24: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
- SEP-31: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md
- SEP-38: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md

Other anchors of the truth:

- Anchor Platform docs: https://developers.stellar.org/docs/platforms/anchor-platform/admin-guide
- Anchor fundamentals: https://developers.stellar.org/docs/learn/fundamentals/anchors
- Reference server (`java-stellar-anchor-sdk`): https://github.com/stellar/anchor-platform
- Compliance test suite: https://github.com/stellar/stellar-anchor-tests
- Test anchor: https://testanchor.stellar.org
- Demo wallet: https://demo-wallet.stellar.org
