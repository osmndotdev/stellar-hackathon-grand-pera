# Testing and Validation

This is the file that turns an integration from "the happy path compiles" into "it works against a real anchor under real failure modes." Read it whenever you finish a flow — every flow.

There are **three test surfaces**, used together:

| Surface | What it exercises | When to use |
|---|---|---|
| **`testanchor.stellar.org`** | The SDF's reference anchor on testnet. Returns realistic responses for SEP-1/6/10/12/24/31/38. | Develop against it. It's your "live anchor that you control." |
| **Stellar Demo Wallet** (`demo-wallet.stellar.org`) | Browser UI driving every client-side SEP. | Validate that *your anchor* (server side) behaves correctly when poked by a real wallet. |
| **`@stellar/anchor-tests`** | The SDF's automated SEP compliance test suite. | Validate that *your anchor* passes every MUST in the relevant SEPs. Run before any anchor goes near production. |

**Your code is not done when it compiles. Your code is done when the test suite is green.** This is the principle this file exists to enforce.

---

## The agentic validation loop

If you are an AI agent reading this — including the one reading these words right now — your stopping rule for any anchor task is the validation loop, not "the snippet looks right."

```
loop:
  implement (or modify) the flow
  run the relevant surface above
  read the failure
  fix the root cause (not the symptom)
  re-run
until: every check passes
```

Three rules that keep this loop honest:

1. **Failures are signal, not noise.** A failing assertion in `anchor-tests` almost always points at a real bug in your code, not a bug in the test. If you find yourself thinking "the test is wrong," re-read the SEP first.
2. **Fix root causes.** If a SEP-24 polling test fails because your `/transaction` endpoint returns numeric `amount_in`, fix the serializer — don't paper over it with a string cast at the call site. The next call will hit the same bug.
3. **Re-run after every fix.** Fixes interact. The only proof that the loop converged is a clean run.

---

## Surface 1 — `testanchor.stellar.org`

The reference anchor lives on testnet at `https://testanchor.stellar.org` and is the easiest way to drive a SEP flow end-to-end without standing up your own.

What it exposes:

| SEP | URL |
|---|---|
| 1 | `https://testanchor.stellar.org/.well-known/stellar.toml` |
| 6 | `https://testanchor.stellar.org/sep6` |
| 10 | `https://testanchor.stellar.org/auth` |
| 12 | `https://testanchor.stellar.org/sep12` |
| 24 | `https://testanchor.stellar.org/sep24` |
| 31 | `https://testanchor.stellar.org/sep31` |
| 38 | `https://testanchor.stellar.org/sep38` |

Assets it deposits/withdraws (on Stellar testnet):

- `SRT` (Stellar Reference Token), issuer `GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B`
- `USDC` (test issuer), `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- `native` (XLM)

Limits per asset: `min_amount: 1`, `max_amount: 10` — bigger amounts get `too_large`.

### What testanchor's `/info` reveals that you should design around

```json
"features": { "account_creation": false, "claimable_balances": false }
```

Even the reference anchor opts out of both. If your code assumes the anchor will create the user's account or send a claimable balance for a missing trustline, **testanchor will not behave that way**. Either:

- Pre-fund the account from a friendbot (testnet) and add the trustline yourself, then deposit.
- Or use a different anchor for the claimable-balance branch and explicitly test that branch against an anchor that supports it.

### Network passphrase

Read it from the TOML: `"Test SDF Network ; September 2015"`. Hard-coding the mainnet passphrase is a top-three reason "the SDK rejects my signature on a transaction that looks correct."

### Funding the test account

```bash
curl "https://friendbot.stellar.org?addr=<G-account>"
```

Friendbot funds testnet accounts with XLM. Do this **before** SEP-10 — `account_creation: false` means testanchor will not create the user's account for you.

---

## Surface 2 — Stellar Demo Wallet

URL: `https://demo-wallet.stellar.org` (also self-hostable from `stellar/stellar-demo-wallet`).

This is the inverse-direction test: instead of *you* being the wallet hitting an anchor, the Demo Wallet acts as the wallet hitting *your anchor*. Use it to validate that your anchor behaves correctly under real wallet pressure.

What it covers:

- Generates testnet keypairs, friendbots them.
- Adds trustlines to the assets in your anchor's `[[CURRENCIES]]`.
- Walks SEP-1 → SEP-10 → SEP-24 (interactive) end-to-end with a UI.
- Lets you trigger SEP-6 deposits and withdrawals.
- Pulls SEP-31 and SEP-38 quote flows.

Workflow: point it at your home domain, follow the SEP your code implements, observe what the wallet sees. Network tab + console open — the Demo Wallet logs every request and response.

When something doesn't work, the failure usually comes from **state your anchor returns that the wallet can't parse**, not from the wallet itself. Common offenders: `pending_user_transfer_start` with `withdraw_memo: null`, missing CORS on `/info`, JWT with the wrong `sub` format.

---

## Surface 3 — `@stellar/anchor-tests`

The SDF's automated compliance suite. Source: https://github.com/stellar/stellar-anchor-tests.

### Install and invoke

```bash
yarn add --dev @stellar/anchor-tests
# or
npm install --save-dev @stellar/anchor-tests
```

```bash
npx stellar-anchor-tests \
  --home-domain testanchor.stellar.org \
  --seps 1 10 24 \
  --asset-code USDC \
  --verbose
```

### Flags that matter

| Flag | Purpose |
|---|---|
| `--home-domain` / `-h` | The anchor's home domain. Required. The suite prepends `https://`. |
| `--seps` / `-s` | Space-separated SEP numbers to test (e.g. `1 10 24 38`). Required. |
| `--asset-code` / `-a` | Which currency to drive the deposit/withdraw tests against. Must match the TOML's `[[CURRENCIES]]`. |
| `--sep-config` | Path to a JSON file with per-SEP test parameters. Required for SEP-12, SEP-24, SEP-31, SEP-38 (anything that goes beyond GET endpoints). |
| `--verbose` / `-v` | Dump request and response bodies for every failing test. Always pass this in CI. |

Run the test suite against `testanchor.stellar.org` first — if a single SEP fails there, your config is wrong, not the anchor.

### The config file (`--sep-config`)

Roughly:

```jsonc
{
  "sep10": {
    "accountSecret": "S...",                       // a funded testnet account secret
    "homeDomain": "your-anchor-domain.com"         // for multi-home-domain auth servers
  },
  "sep12": {
    "customers": {
      "alice": {
        "type": "sep31-sender",
        "first_name": "Alice",
        "last_name": "Doe",
        "email_address": "alice@example.com"
        // …whatever SEP-9 fields your KYC requires
      },
      "bob": { "type": "sep31-receiver", "...": "..." }
    }
  },
  "sep24": {
    "depositPendingUserActionRequired": true,      // if your anchor needs user input mid-flow
    "withdrawPendingUserActionRequired": true
  },
  "sep31": {
    "sendingClientName": "alice",
    "receivingClientName": "bob",
    "transactionFields": { "receiver_routing_number": "...", "receiver_account_number": "..." }
  },
  "sep38": {
    "contextAsset": "USDC",
    "sellAsset": "iso4217:USD",
    "buyAsset": "stellar:USDC:G…",
    "sellAmount": "100"
  }
}
```

The exact shape evolves — read the [README](https://github.com/stellar/stellar-anchor-tests/blob/master/%40stellar/anchor-tests/README.md) for the current version and write the file by example, not from memory.

### Reading the output

Each test prints `✓ test description` (pass) or `✕ test description` (fail). With `--verbose`, failures dump the offending request/response. The summary at the end:

```
Tests: 47 passed, 47 total
Time:  12.3s
```

Anything other than `N passed, N total` means stop coding and read the failure. The suite assertions correspond 1:1 with SEP MUST/SHOULD clauses — a failing test is a spec violation.

### When you legitimately disagree with the suite

Rare but it happens (suite lag behind a SEP version, ambiguous spec wording). Before concluding the suite is wrong:

1. Fetch the SEP text from `stellar/stellar-protocol` master and re-read the relevant section.
2. Search for an existing issue at https://github.com/stellar/stellar-anchor-tests/issues.
3. If still convinced, file an issue with the request/response from `--verbose`. Don't ship around the test silently.

---

## A concrete loop — building a SEP-24 deposit against testanchor

The pattern this skill is built around. Run this loop the first time you build any client integration.

```
1. Implement SEP-1 fetch + parse                  → see discovery-and-auth.md
2. Implement SEP-10 challenge get/verify/sign/post → see discovery-and-auth.md
3. Implement /info + POST /transactions/deposit/interactive
4. Implement popup open + postMessage handler + /transaction polling
5. Run:
     npx stellar-anchor-tests \
       --home-domain testanchor.stellar.org \
       --seps 1 10 24 \
       --asset-code SRT \
       --sep-config ./tests/anchor-test-config.json \
       --verbose
6. For each failure: read the assertion, fix the root cause, GOTO 5.
7. Manually walk the flow end-to-end with the Demo Wallet for human-visible UX checks.
```

You are done when step 5 prints `Tests: N passed, N total` and step 7 lands a real deposit on the user account.

---

## Common failures and what they mean

| Failure | Almost always means |
|---|---|
| `stellar.toml` test fails on a 200 response | Missing `Access-Control-Allow-Origin: *` or content-type mismatch |
| SEP-10 "challenge has invalid sequence number" | Your *test setup* is wrong — re-check `accountSecret` is funded on testnet |
| SEP-10 "web_auth_domain mismatch" | Your server is generating challenges with the wrong `WEB_AUTH_ENDPOINT` host |
| SEP-24 "transaction missing required field `amount_in_asset`/`amount_out_asset`" | These are REQUIRED for non-equivalent (SEP-38 quote-based) flows and must be a SEP-38 asset identifier (e.g. `iso4217:USD`, `stellar:USDC:G...`). A missing one means you returned bare/non-equivalent assets without the SEP-38 id |
| SEP-24 transaction rejected for using `amount_fee` | `amount_fee` is deprecated in favor of `fee_details` — return the `fee_details` object instead |
| SEP-24 "withdrawal status never reached `pending_user_transfer_start`" | Your custody/observer pipeline isn't generating the withdraw_anchor_account + memo response in time, or your KYC step is stuck |
| SEP-38 quote "expired before use" | Your `expires_at` is shorter than the test timeout — extend it or fix the clock |
| Any SEP-12 test | The `customers` block in `--sep-config` is incomplete for the fields your anchor demands; check your `GET /customer` `fields` response and align them |

---

## Cross-references

- Before writing SEP-24 code: [sep24-interactive.md](../client/sep24-interactive.md)
- Before writing SEP-1/10 code: [discovery-and-auth.md](../client/discovery-and-auth.md)
- For anchor builders running this suite against their own server: [anchor-platform-setup.md](../server/anchor-platform-setup.md), [production-checklist.md](../server/production-checklist.md)
