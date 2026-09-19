# SEP-24 Interactive Deposits and Withdrawals

SEP-24 is the **hosted UI** on/off-ramp: your wallet hands the user to the anchor's KYC + transfer form, gets a callback when the user finishes, and confirms the result on-chain. It is the most common anchor flow in production and what `testanchor.stellar.org` is built around.

**Prerequisites before any code in this file runs**

- SEP-1 parsed: you have the anchor's `TRANSFER_SERVER_SEP0024` URL (NOT `TRANSFER_SERVER` — that one is SEP-6).
- SEP-10 done: you hold a Bearer JWT for the user. Every endpoint below except `GET /info` and `GET /fee` requires `Authorization: Bearer <JWT>`.
- The user holds (or your code will create) a trustline to the asset on the deposit side. See [Trustline and claimable-balance branch](#trustline-and-claimable-balance-branch) for the conditional.

Spec ground truth: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md — fetch it before writing code; do not assume from this file alone if the date is far from 2026.

---

## When to use SEP-24 vs SEP-6 vs SEP-31

| Situation | Use |
|---|---|
| Retail wallet, anchor provides the KYC/transfer UI | **SEP-24** |
| Your app collects KYC itself, anchor is API-only, no hosted UI | [SEP-6](sep6-programmatic.md) |
| Sending-org → receiving-org remittance, no end-user wallet | [SEP-31](sep31-cross-border.md) |

Most teams that start with SEP-6 because "API is cleaner" come back to SEP-24 once they realize they don't want to own KYC, compliance UI, or anchor-specific form changes. Default to SEP-24 unless you have a concrete reason to own the UI.

---

## The flow at a glance

```
1.  GET  /info                                   (no auth)  — capabilities, fees, limits
2.  POST /transactions/deposit/interactive       (auth)     — or /withdraw/interactive
3.  Open response.url in a popup or webview      (NOT iframe)
4.  Listen for completion via callback or poll   /transaction
5.  Deposit:    wait for asset to arrive (trustline OR claimable balance)
    Withdrawal: send Stellar payment to withdraw_anchor_account with withdraw_memo
6.  Poll /transaction until status = completed | refunded | expired | error
```

Steps 2–5 are the meat. Everything below expands one of them.

---

## Step 1 — GET /info

```http
GET {TRANSFER_SERVER_SEP0024}/info
```

No authentication. Response is the contract your code must respect — read it for every asset, every time the user starts a flow. Anchors disable assets, change fees, and toggle features without warning.

```json
{
  "deposit":  { "USDC": { "enabled": true,  "min_amount": 1, "max_amount": 10000, "fee_fixed": 0, "fee_percent": 1.5 } },
  "withdraw": { "USDC": { "enabled": true,  "min_amount": 5, "max_amount": 10000, "fee_fixed": 0.5, "fee_percent": 1.0 } },
  "fee":      { "enabled": false, "authentication_required": true },
  "features": { "account_creation": true, "claimable_balances": false }
}
```

Things to actually check, not just fetch:

- `deposit[code].enabled` and `withdraw[code].enabled` — `false` means the flow is off; show a sensible empty state, don't call `/transactions/deposit/interactive`.
- `min_amount` / `max_amount` — pre-validate; submitting an out-of-range amount returns the `too_small` or `too_large` transaction status, not a clean 400.
- `features.claimable_balances` — drives the deposit branch below.
- `features.account_creation` — if `false` and the user's account is unfunded on the network, the anchor will 400; you must fund the account first (XLM reserve + trustline).
- `fee.enabled` — `GET /fee` is **deprecated**. If you need fees for a non-1:1 conversion, use [SEP-38 `/price` or `/quote`](sep38-quotes.md), not `/fee`.

---

## Step 2 — POST /transactions/{deposit,withdraw}/interactive

### Deposit

```http
POST {TRANSFER_SERVER_SEP0024}/transactions/deposit/interactive
Authorization: Bearer <SEP-10 JWT>
Content-Type: application/x-www-form-urlencoded

asset_code=USDC
&asset_issuer=<from stellar.toml [[CURRENCIES]]>   # resolve at runtime; do NOT hardcode
&account=GAAAA...                       # optional; defaults to JWT sub
&amount=100                              # optional
&quote_id=de762cda-...                   # optional; SEP-38 firm quote
&claimable_balance_supported=true        # send this; see branch below
&lang=en
```

Notes that bite:

- `asset_issuer` is technically optional, but **pair it with `asset_code` whenever you have it**. `USDC` from Circle (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` on mainnet) and `USDC` from `testanchor.stellar.org` (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` on testnet) and `USDC` from yet another issuer are all different assets and `/info` does not always disambiguate. **Resolve the issuer from the anchor's `stellar.toml [[CURRENCIES]]` at runtime** — never hardcode it, especially across testnet/mainnet flips.
- `amount` is a string-able number; if you pass `quote_id`, the anchor must respect it and will reject the request (400) if `asset_code` / `source_asset` / `amount` conflict with the quote.
- Content type can be `application/x-www-form-urlencoded`, `multipart/form-data` (when sending binary SEP-9 fields), or `application/json`. Pick urlencoded unless you're sending files.

### Withdrawal

```http
POST {TRANSFER_SERVER_SEP0024}/transactions/withdraw/interactive
Authorization: Bearer <SEP-10 JWT>
Content-Type: application/x-www-form-urlencoded

asset_code=USDC
&asset_issuer=GA5Z...
&account=GAAAA...                        # source of the Stellar payment; defaults to JWT sub
&amount=50                               # optional
&quote_id=...                            # optional
&refund_memo=12345                       # optional; if your account is shared
&refund_memo_type=id                     # required when refund_memo is set
&lang=en
```

The request `memo` / `memo_type` parameters here are **deprecated** — the spec says use the JWT `sub` (a memo can be embedded as `G...:1234567` or as a muxed `M...` account). The deprecated request params are not the same as the *response* `withdraw_memo`; see the withdrawal memo contract below.

### Response (both)

```json
{
  "type": "interactive_customer_info_needed",
  "url":  "https://anchor.example.com/sep24/start?token=...",
  "id":   "82fhs729f63dh0v4"
}
```

Store the `id` — it is the only handle you have to this transaction until it shows up in `/transactions`.

### Error responses

- `401` (or `403`) `{ "type": "authentication_required" }` — JWT missing, expired, or rejected. Anchors are inconsistent about which code they use, so treat **either 401 or 403 carrying `authentication_required`** as the same signal: re-run SEP-10 and retry transparently; do not surface this to the user. (This matches gotcha #11 — catch the re-auth trigger on the status code, not on assuming a single one.)
- Any other non-200: `{ "error": "human-readable message" }`. Most anchors return the asset / amount / KYC reason here in plain English — surface it.

---

## Step 3 — Open the URL (popup or webview, NEVER iframe)

Anchors serve the interactive URL with `X-Frame-Options: DENY` or a strict CSP `frame-ancestors`. Opening it in an iframe results in a blank window with no error. The two correct hosts:

- **Web** — `window.open(response.url, "_blank", "popup=yes,width=500,height=700")`.
- **Native / mobile** — system webview (`SFSafariViewController` on iOS, Chrome Custom Tabs on Android), or a dedicated WebView component with cookies enabled.
- **Node / CLI / backend job** — there is no `window.open` and no `postMessage`. The right pattern: print the `response.url` for the operator (or launch the system browser via the `open` npm package), then rely **entirely on polling `/transaction`** for completion. Do not try to scrape the interactive URL; the anchor's HTML is not a public contract.

Register the completion listener **before** opening the window; otherwise the anchor's `postMessage` arrives before you're listening for it.

### Two completion mechanisms

The wallet may append one or both of these query params to the URL before opening it:

| Param | Effect |
|---|---|
| `callback=postMessage` | Anchor calls `window.opener.postMessage(transactionObject, "*")` (falls back to `window.parent` if `opener` is null). |
| `callback=https://wallet.example.com/sep24/done` | Anchor POSTs the signed `transaction` JSON to that URL. |
| `on_change_callback=postMessage` or URL | Same shapes, fired on every `status` or `kyc_verified` change, not just completion. |

**postMessage handler — minimum viable**

`event.data` is the **bare transaction object** — the same shape as the `transaction` field of `GET /transaction`, NOT wrapped in `{ transaction: … }`. Read fields like `event.data.id` and `event.data.status` directly.

```js
window.addEventListener("message", (event) => {
  // event.origin === the anchor's domain — validate against your TOML lookup
  if (!ALLOWED_ANCHOR_ORIGINS.has(event.origin)) return;
  const tx = event.data;                       // bare transaction object, not { transaction: tx }
  if (tx?.id !== transactionId) return;
  handleTransactionUpdate(tx);
});
```

**URL callback signature verification.** When the anchor POSTs to your callback URL, it includes a `Signature` header of the form `t=<unix_ts>, s=<base64_ed25519_sig>`. The signed payload is `<timestamp>.<wallet_host>.<raw_body>`. Verify with the anchor's `SIGNING_KEY` from `stellar.toml`. Reject if the timestamp is more than ~1–2 minutes old (spec wording: "few seconds (1–2 minute(s) max)"). An unsigned or stale callback is the signature anti-pattern of this flow — without verification an attacker can spoof "completed" from any host.

Callbacks are best-effort. **Always also poll `/transaction`** — the popup can be closed, the network can flake, and the postMessage can fire before your listener is attached.

---

## Step 4 — Poll /transaction

```http
GET {TRANSFER_SERVER_SEP0024}/transaction?id=82fhs729f63dh0v4
Authorization: Bearer <SEP-10 JWT>
```

Response is **wrapped**: `{ "transaction": { id, status, … } }`. Destructure `const { transaction } = await res.json()` — the bare transaction object is not at the top level. (`GET /transactions`, plural, returns `{ "transactions": [ … ] }`.)

Reasonable cadence: every 3–5 seconds while the user is on-screen, backing off to every 15–30 seconds in the background. Stop polling on `completed`, `refunded`, `expired`, `no_market`, `too_small`, `too_large`, or `error`.

### The status state machine

Every status the spec defines, with the action your code is responsible for:

| Status | What it means | Your action |
|---|---|---|
| `incomplete` | User has not finished the interactive form. | Keep the popup/webview alive; do nothing else. |
| `pending_user_transfer_start` | **Withdrawal only.** Anchor is waiting for the Stellar payment. Read `withdraw_anchor_account`, `withdraw_memo`, `withdraw_memo_type`, `amount_in`. | Build and submit the payment with the exact memo. |
| `pending_user_transfer_complete` | Withdrawal: Stellar payment received; off-chain transfer in flight. | Show "we're sending the money" UI. |
| `pending_external` | Submitted to an external (bank/card) network; not yet confirmed. | Show "with the bank" UI. |
| `pending_anchor` | Anchor is processing internally. | Wait. |
| `on_hold` | Compliance review. | Show "additional checks" UI; surface `message` if present. |
| `pending_stellar` | Anchor submitted to Stellar; awaiting ledger close. | Wait; ~5–10s typical. |
| `pending_trust` | **Deposit only.** Account has no trustline to the asset. | Build a `ChangeTrust` op and submit it. |
| `pending_user` | Anchor needs the user to do something (email confirmation, 2FA). | Re-open the interactive URL or `more_info_url`. |
| `completed` | Terminal: success. | Stop polling; show success. |
| `refunded` | Terminal: refunded. | Stop polling; surface `refunds` object. |
| `expired` | Terminal: user abandoned. | Stop polling. |
| `no_market` | Anchor cannot fill at any price. | Stop polling; offer to retry with different amount. |
| `too_small` / `too_large` | Amount outside the anchor's limits. | Stop polling; re-prompt with the limits from `/info`. |
| `error` | Catch-all anchor-side failure. | Stop polling; surface `message`. |

Two statuses people miss:

- **`pending_trust`** only appears on the deposit side and only when `features.claimable_balances` is false or the wallet did not send `claimable_balance_supported=true`. If you see this, the user's funds are *waiting* — you owe them a `ChangeTrust` op.
- **`pending_user`** is not "we're waiting on the system" — it is "the user has homework." Re-open the interactive URL (or `more_info_url`) so they can complete it.

`pending_customer_info_update` is **not** a SEP-24 status — that branch lives in SEP-6. If you see it in SEP-24 docs elsewhere, it is wrong.

---

## Step 5a — Deposit completion

Once the anchor moves the transaction past `pending_anchor`, money lands on the user's account. Three sub-paths depending on account state and anchor support:

### A. User has a trustline and a funded account (happy path)

The anchor sends a `Payment` op. Your code does nothing — just polls until `completed`.

### B. User has no trustline and the anchor supports claimable balances

You sent `claimable_balance_supported=true` and `features.claimable_balances === true`. The anchor sends a `CreateClaimableBalance` op. You will see `claimable_balance_id` populated on `/transaction`. To deliver the funds:

1. Establish a trustline if missing (`ChangeTrust`).
2. Submit `ClaimClaimableBalance` with that `claimable_balance_id`.

### C. User has no trustline and the anchor does NOT support claimable balances

The transaction will sit at `pending_trust`. Your code must:

1. If the account is unfunded (no XLM): the anchor will (usually) send the minimum reserve + a small XLM allowance via `CreateAccount`. If `features.account_creation === false`, this won't happen — you fund the account yourself, then continue.
2. Submit `ChangeTrust` to establish the trustline.
3. Anchor detects the trustline and sends the deposit.

If the anchor's asset has `AUTH_REQUIRED`, the anchor must call `AllowTrust` (or set authorization flags via `SetTrustLineFlags`) after your `ChangeTrust`. This is automatic from your side.

The `ChangeTrust` itself, in full:

```ts
import { Asset, Horizon, Keypair, Operation, TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";

// Horizon URLs are NOT advertised in stellar.toml — pin them per network:
//   testnet: https://horizon-testnet.stellar.org
//   mainnet: https://horizon.stellar.org   (or your own Horizon instance)
async function addTrustline(
  horizon: Horizon.Server,
  userKeypair: Keypair,
  asset: Asset,
  networkPassphrase: string,          // from stellar.toml NETWORK_PASSPHRASE
): Promise<string> {
  const account = await horizon.loadAccount(userKeypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.changeTrust({ asset }))   // no `limit` = max trust
    .setTimeout(180)
    .build();
  tx.sign(userKeypair);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
}

// usage when polling sees status === "pending_trust":
await addTrustline(
  new Horizon.Server("https://horizon-testnet.stellar.org"),
  userKeypair,
  new Asset("USDC", usdcIssuerFromToml),
  toml.NETWORK_PASSPHRASE,
);
```

Two things this snippet quietly handles that starter code typically misses:

- **Account loading first.** `ChangeTrust` requires a funded source account (≥ baseline reserve + 1 trust reserve = 1 XLM). If the account is unfunded, `loadAccount` throws — friendbot it (testnet) or fund it from your treasury (mainnet) first.
- **Omitting `limit`** gives the user a max-trust trustline. Pass an explicit `limit: "0"` to *remove* a trustline (only works when the balance is zero), or a numeric string to cap it.

### Trustline and claimable-balance branch

Decision rule before posting the deposit request:

```
if features.claimable_balances === true and userHasNoTrustline:
    sendDeposit({claimable_balance_supported: true})
    # later, claim the balance after adding a trustline
elif userHasNoTrustline:
    promptUserOrAutoAddTrustline()        # ChangeTrust before the anchor pays
    sendDeposit({})
else:
    sendDeposit({})
```

---

## Step 5b — Withdrawal completion

When status reaches `pending_user_transfer_start`, the response now contains the contract for moving funds:

```json
{
  "id": "82fhs729f63dh0v4",
  "kind": "withdrawal",
  "status": "pending_user_transfer_start",
  "amount_in": "50.0000000",
  "withdraw_anchor_account": "GCIBUCGPOHWMMMFPFKDKE2..." ,
  "withdraw_memo": "1234567890",
  "withdraw_memo_type": "id"
}
```

Build the Stellar payment:

```js
const op = Operation.payment({
  destination: tx.withdraw_anchor_account,
  asset: new Asset(assetCode, assetIssuer),
  amount: tx.amount_in,          // string, exactly as returned
});

const txb = new TransactionBuilder(sourceAccount, { fee, networkPassphrase })
  .addOperation(op)
  .addMemo(buildMemo(tx.withdraw_memo_type, tx.withdraw_memo))  // <- non-negotiable
  .setTimeout(180)
  .build();
```

Three withdrawal traps:

1. **`withdraw_memo` can be `null` if you read it too early.** It is only populated once the status is `pending_user_transfer_start`. Reading it from the initial POST response gets you `null`. Wait for the right status.
2. **Memo type matters.** `id` → `Memo.id(value)`, `text` → `Memo.text(value)`, `hash` → `Memo.hash(Buffer.from(value, "base64"))`. Sending the right value with the wrong type fails attribution silently.
3. **Anchors accept ±10% amount variance**, per the spec, but counting on that for rounding is fragile — send exactly `amount_in` as a string and let the anchor decide.

After submission, the status moves through `pending_anchor` → `pending_external` (or `pending_user_transfer_complete`) → `completed`.

---

## SEP-38 firm-quote integration

For non-1:1 conversions (e.g. BRL → USDC), get a firm quote first:

```
POST {ANCHOR_QUOTE_SERVER}/quote   ->  { id, price, expires_at, ... }
```

Pass `quote_id` to `/transactions/deposit/interactive` or `/transactions/withdraw/interactive`. The anchor MUST honor the quoted rate if you complete the transfer before `expires_at`.

Two failure modes:

- **Quote expired between POST and user transfer.** The anchor rejects with 400 or moves the transaction to `error`. Implement a re-quote loop: catch, fetch a new quote, re-post, replace the transaction id in your UI.
- **Conflicting params.** If `asset_code` or `amount` in your POST disagrees with the quote, the anchor rejects with 400. Always derive these from the quote itself, not from the user's pre-quote input.

See [sep38-quotes.md](sep38-quotes.md) for the quote endpoints themselves.

---

## A minimal end-to-end deposit (TypeScript-ish)

```ts
// preconditions: jwt = SEP-10 token, transferServer = TRANSFER_SERVER_SEP0024,
//   horizon = new Horizon.Server(...), userKeypair = Keypair for the user,
//   networkPassphrase = stellar.toml NETWORK_PASSPHRASE  (see addTrustline above)
const info = await fetch(`${transferServer}/info`).then(r => r.json());
if (!info.deposit?.USDC?.enabled) throw new Error("USDC deposit disabled");

const supportsCB = info.features?.claimable_balances === true;

const body = new URLSearchParams({
  asset_code: "USDC",
  asset_issuer: USDC_ISSUER,
  amount: "100",
  claimable_balance_supported: String(supportsCB),
});

const start = await fetch(`${transferServer}/transactions/deposit/interactive`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/x-www-form-urlencoded" },
  body,
}).then(r => r.json());

if (start.type !== "interactive_customer_info_needed") throw new Error(start.error ?? "unexpected response");

// IMPORTANT: register the listener before opening the window
const txId = start.id;
window.addEventListener("message", onAnchorMessage);

const popup = window.open(start.url, "_blank", "popup=yes,width=500,height=700");

// belt-and-braces polling
const poll = setInterval(async () => {
  const { transaction: tx } = await fetch(
    `${transferServer}/transaction?id=${txId}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  ).then(r => r.json());

  if (tx.status === "pending_trust") {
    await addTrustline(horizon, userKeypair, new Asset("USDC", USDC_ISSUER), networkPassphrase);
  } else if (tx.status === "completed" || tx.status === "refunded" || tx.status === "error") {
    clearInterval(poll);
    handleTerminal(tx);
  }
}, 4000);
```

Replace the popup line with the native webview on mobile. The polling loop and the `pending_trust` branch are what most starter snippets leave out.

---

## SEP-24 footguns checklist

Specific to this flow, on top of the router-level gotchas:

- **JWT scope.** Some anchors issue a JWT bound to a specific transaction id (returned during the interactive flow); use the one from SEP-10 for the API calls, but if the interactive URL gives you a different short-lived JWT for `/transaction` polling within the session, honor that.
- **`/info` is per-language.** `?lang=pt-BR` returns localized `description` strings. Cache per locale.
- **Don't re-POST to start a new transaction when polling fails.** Re-POST creates a new anchor-side transaction id and abandons the old one. Always retry by id with `/transaction`.
- **Don't trust `amount_in` from the initial POST response.** It is the user's requested amount, not the amount the anchor will actually use. Read from `/transaction` once status reaches `pending_user_transfer_start`.
- **CORS works for `/info` and `/transaction`; some anchors block CORS on POST endpoints.** If you're a browser-only wallet, validate this against the specific anchor early; otherwise proxy through your backend.
- **Test on testnet against `testanchor.stellar.org` first.** See [testing-and-validation.md](../testing/testing-and-validation.md) — the SDF compliance test suite covers most of the bullets above automatically.
