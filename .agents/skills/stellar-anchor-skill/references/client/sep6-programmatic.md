# SEP-6 Programmatic Deposits and Withdrawals

SEP-6 is the **API-only** on/off-ramp. No popup, no hosted UI, no anchor-rendered forms. Your app collects everything (KYC, funding details, instructions) and the anchor returns deposit/withdraw instructions as JSON.

Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0006.md

**Prerequisites identical to SEP-24:** SEP-1 done, SEP-10 JWT in hand, the right endpoint resolved — but read **`TRANSFER_SERVER`** (NOT `TRANSFER_SERVER_SEP0024`).

---

## When to choose SEP-6 over SEP-24

| Use SEP-6 when… | Use SEP-24 when… |
|---|---|
| You own the KYC UX and don't want to hand the user to the anchor | You want the anchor to handle KYC and form rendering |
| You're a back-end service with no end-user UI at all | You're a retail wallet |
| You collect customer data via SEP-12 ahead of time and re-use it | KYC is per-transaction or anchor-specific |
| The anchor explicitly recommends it (sometimes for high-value flows) | Default for most retail flows |

The spec's own guidance: SEP-24 exists for "interactively using a popup opened within the wallet application"; SEP-6 is for "programmatically" without a UI handoff.

**Most teams that start with SEP-6 because "API is cleaner" come back to SEP-24** once they realize they don't want to own per-anchor form changes. Pick SEP-6 deliberately, not by default.

---

## The flow at a glance

```
1. GET  /info                                (no auth)  — capabilities, fields per asset
2. PUT  /customer (SEP-12)                   (auth)     — pre-load KYC
3. GET  /deposit OR /withdraw                (auth)     — anchor returns instructions
4. Deposit:    send fiat per `how` field; trustline branch like SEP-24
   Withdrawal: send Stellar payment to account_id with memo
5. Poll /transaction; PATCH if the anchor asks for more data
6. Done when status = completed | refunded | expired | error
```

SEP-6 looks like SEP-24 turned inside out: the customer information collection that SEP-24 does in the popup happens here through SEP-12 calls and the `fields` object on `/info`.

---

## Step 1 — GET /info

```http
GET {TRANSFER_SERVER}/info
```

No authentication. The response shape extends the SEP-24 one with a critical extra: each asset entry has a `fields` object telling you exactly which parameters the anchor expects on `/deposit` and `/withdraw`.

```json
{
  "deposit": {
    "USDC": {
      "enabled": true,
      "fee_fixed": 0, "fee_percent": 1.5,
      "min_amount": 1, "max_amount": 10000,
      "fields": {
        "type": {
          "description": "type of deposit, e.g. SEPA, SWIFT, cash",
          "choices": ["SEPA", "SWIFT", "cash"]
        }
      }
    }
  },
  "withdraw": {
    "USDC": {
      "enabled": true,
      "fee_fixed": 0.5, "fee_percent": 1.0,
      "min_amount": 5, "max_amount": 10000,
      "types": {
        "bank_account": {
          "fields": {
            "dest":       { "description": "bank account number" },
            "dest_extra": { "description": "routing number" }
          }
        }
      }
    }
  },
  "deposit-exchange": { /* same shape; for SEP-38 firm-quote flows */ },
  "withdraw-exchange": { /* … */ },
  "features": { "account_creation": false, "claimable_balances": false }
}
```

Two things to internalize:

1. **`fields` is the contract.** Read it. Send exactly those parameters on the `/deposit` or `/withdraw` call. Missing a required field returns 400 or moves the transaction to `pending_customer_info_update`.
2. **`dest` / `dest_extra` are deprecated** for collecting PII via URL parameters (it leaks into logs). Pass that information through SEP-12 with a `customer_id` and let the anchor pull it server-side. New integrations should treat `dest`/`dest_extra` as a fallback for legacy anchors, not the default.

---

## Step 2 — Pre-load KYC via SEP-12

Unlike SEP-24, where the anchor's hosted UI prompts for KYC, in SEP-6 your code is responsible for collecting and submitting SEP-9 fields before the user sees any "where do I send the money" instructions.

```
PUT  {KYC_SERVER}/customer       → returns { id: "<customer_id>" }              (id only)
GET  {KYC_SERVER}/customer       → returns { id, status: "ACCEPTED|NEEDS_INFO|PROCESSING|REJECTED", fields, provided_fields }
```

`PUT /customer` returns **only** `{ id }` — it does not carry `status` or `fields`. Read the KYC status and the list of outstanding fields from `GET /customer` after each PUT (this matches [sep12-kyc.md](sep12-kyc.md)). Save the `id` and pass it as `customer_id` on `/deposit` and `/withdraw`. See [sep12-kyc.md](sep12-kyc.md) for the full SEP-12 flow.

If `GET /customer` returns status `NEEDS_INFO`, the anchor returns `fields` listing what's missing — submit via PUT, re-`GET` to re-check status, repeat until `ACCEPTED`.

---

## Step 3a — GET /deposit

```http
GET {TRANSFER_SERVER}/deposit?asset_code=USDC
                              &asset_issuer=GA5Z...
                              &account=G...                       # optional; defaults to JWT sub
                              &amount=100                          # optional
                              &funding_method=SEPA                 # send as `funding_method`; required if the anchor advertises this field (often keyed `type`) in /info `fields`
                              &customer_id=<from SEP-12>
                              &quote_id=<from SEP-38>              # for /deposit-exchange only
                              &claimable_balance_supported=true    # see SEP-24 branch
                              &on_change_callback=https://wallet/cb # optional
Authorization: Bearer <JWT>
```

`funding_method` indicates how the user will fund the deposit (SEPA, SWIFT, cash, mobile money) and replaces the deprecated `type` request parameter.

**Watch the key mapping — it differs between `/info` and the request.** Many anchors still *advertise* this field keyed `type` inside the `fields` object on `/info` (as in the example above) for legacy compatibility, but you *send* it as `funding_method` on the `/deposit` (or `/withdraw`) request. The one exception: if an anchor's `/info` field is literally named `type`, a legacy anchor may also accept the value under the `type` request parameter — but prefer `funding_method` and only fall back to `type` if the anchor explicitly requires it.

### Response (the deposit instructions)

```json
{
  "how": "Send funds to IBAN ES91 2100 0418 4502 0005 1332 with reference DEPOSIT-12345",
  "id": "82fhs729f63dh0v4",
  "fee_fixed": 0,
  "fee_percent": 1.5,
  "min_amount": 1,
  "max_amount": 10000,
  "extra_info": {
    "bank_name": "Banco Santander",
    "iban": "ES91 2100 0418 4502 0005 1332",
    "swift": "BSCHESMM",
    "reference": "DEPOSIT-12345"
  }
}
```

`how` is the human-readable instruction. `extra_info` is the same data in structured form — **use `extra_info`** for everything you display in your own UI; `how` is for fallback display when you don't recognize the keys. Anchors are free to populate either or both.

---

## Step 3b — GET /withdraw

```http
GET {TRANSFER_SERVER}/withdraw?asset_code=USDC
                               &asset_issuer=GA5Z...
                               &funding_method=bank_account
                               &amount=50
                               &customer_id=<from SEP-12>
                               &refund_memo=12345           # optional, for shared accounts
                               &refund_memo_type=id
                               &on_change_callback=https://wallet/cb
Authorization: Bearer <JWT>
```

Response:

```json
{
  "account_id": "GCIBUCGPOHWMMMFPFKDKE2...",
  "memo": "1234567890",
  "memo_type": "id",
  "id": "82fhs729f63dh0v4",
  "fee_fixed": 0.5,
  "fee_percent": 1.0
}
```

Same memo contract as SEP-24: send the Stellar payment with `memo` of type `memo_type` to `account_id`. **Omitting the memo on a shared custodial destination strands funds.** (See router gotcha #4.)

Unlike SEP-24, the response is immediate — there's no `pending_user_transfer_start` waiting period. Send the payment as soon as you have the response.

---

## Step 4 — Poll /transaction

```http
GET {TRANSFER_SERVER}/transaction?id=82fhs729f63dh0v4
Authorization: Bearer <JWT>
```

### The SEP-6 status state machine

The shared statuses (`incomplete`, `pending_user_transfer_start`, `pending_user_transfer_complete`, `pending_external`, `pending_anchor`, `pending_stellar`, `pending_trust`, `pending_user`, `completed`, `refunded`, `expired`, `no_market`, `too_small`, `too_large`, `error`) behave identically to SEP-24 — see [sep24-interactive.md](sep24-interactive.md#the-status-state-machine).

**Two statuses unique to SEP-6 that your code MUST handle:**

| Status | Meaning | Your action |
|---|---|---|
| `pending_customer_info_update` | Anchor needs more KYC data. The transaction object includes a `required_customer_info_updates` array of SEP-9 field names. | PUT `/customer` (SEP-12) with the missing fields, then continue polling. |
| `pending_transaction_info_update` | Anchor needs more transaction-level data (typically dest details a fee tier requires). The transaction object includes a `required_info_updates` map of field names → field metadata. | **PATCH** `/transactions/{id}` with the missing fields. |

### PATCH /transactions/{id}

This endpoint doesn't exist in SEP-24 and is the SEP-6 way to feed additional transaction-level fields back without abandoning the transaction.

```http
PATCH {TRANSFER_SERVER}/transactions/{id}
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "fields": {
    "transaction": {
      "dest":       "0123456789",
      "dest_extra": "021000021"
    }
  }
}
```

After PATCH, the status returns to a normal pending state. If you ignore `pending_transaction_info_update`, the transaction will eventually `expire`.

---

## The non-equivalent-asset variant: /deposit-exchange and /withdraw-exchange

When the off-chain asset is not 1:1 to the on-chain asset (e.g. EUR fiat → USDC), use these endpoints instead of `/deposit` / `/withdraw`. Required:

1. Obtain a firm quote first: SEP-38 `POST /quote` → `quote_id`. See [sep38-quotes.md](sep38-quotes.md).
2. Call `/deposit-exchange` or `/withdraw-exchange` with `source_asset`/`destination_asset` (SEP-38 asset IDs) and `quote_id`.
3. Same status state machine; the response carries `amount_in_asset`, `amount_out_asset`, `fee_details`.

Trying to drive a non-equivalent flow through plain `/deposit` ends with 400s. Use the `-exchange` variants whenever currencies differ.

---

## A minimal end-to-end SEP-6 deposit (TypeScript-ish)

```ts
// preconditions: jwt = SEP-10 token, transferServer = TRANSFER_SERVER, kycServer = KYC_SERVER
let jwt = await runSep10();  // see discovery-and-auth.md

// Thin authenticated fetch wrapper: re-runs SEP-10 on 401 and retries, throws on
// other non-2xx with the response body, and only then parses JSON.
// Same transparent re-auth path as discovery-and-auth.md / gotcha #11.
async function authFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string) =>
    fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  let res = await send(jwt);
  if (res.status === 401) {
    jwt = await runSep10();          // transparent re-auth, no user prompt
    res = await send(jwt);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}: ${await res.text()}`);
  return res.json();
}

// /info is unauthenticated, but still check r.ok before parsing.
const info = await fetch(`${transferServer}/info`).then(r => {
  if (!r.ok) throw new Error(`${r.status} /info: ${r.statusText}`);
  return r.json();
});
const fields = info.deposit?.USDC?.fields ?? {};

// 1. KYC — PUT, then GET status; repeat until ACCEPTED.
//    PUT /customer returns only { id }; status/fields come from GET /customer.
let { id: customerId } = await sep12PutCustomer(kycServer, jwt, KYC_DATA);
let customer = await sep12GetCustomer(kycServer, jwt, KYC_TYPE);  // → { status, fields, ... }
while (customer.status !== "ACCEPTED") {
  if (customer.status === "REJECTED") throw new Error("KYC rejected");
  await collectMissingFields(customer.fields);
  ({ id: customerId } = await sep12PutCustomer(kycServer, jwt, KYC_DATA));
  customer = await sep12GetCustomer(kycServer, jwt, KYC_TYPE);
}

// 2. /deposit
const q = new URLSearchParams({
  asset_code: "USDC",
  asset_issuer: USDC_ISSUER,
  amount: "100",
  funding_method: "SEPA",
  customer_id: customerId,
  claimable_balance_supported: String(info.features?.claimable_balances === true),
});
const deposit = await authFetch<any>(`${transferServer}/deposit?${q}`);

displayInstructions(deposit.how, deposit.extra_info);  // show user the bank details

// 3. Poll
const txId = deposit.id;
for (;;) {
  const { transaction: tx } = await authFetch<any>(`${transferServer}/transaction?id=${txId}`);

  switch (tx.status) {
    case "pending_customer_info_update":
      await sep12PutCustomer(kycServer, jwt, missing(tx.required_customer_info_updates));
      break;
    case "pending_transaction_info_update":
      await authFetch(`${transferServer}/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { transaction: collectInfo(tx.required_info_updates) } }),
      });
      break;
    case "pending_trust":
      await addTrustline("USDC", USDC_ISSUER);
      break;
    case "completed": case "refunded": case "error": case "expired":
      return tx;
  }
  await sleep(4000);
}
```

---

## SEP-6 footguns checklist

- **`fields` from `/info` is not optional.** Submitting `/deposit` without all required fields returns 400 (best case) or stalls the transaction at `pending_customer_info_update` (worse case, eats your customer's time).
- **`pending_transaction_info_update` requires PATCH, not a re-POST.** Re-POSTing creates a new transaction id and abandons the old one. Always continue by id.
- **Don't pass PII via `dest` / `dest_extra` if you can avoid it.** The spec explicitly warns these leak into anchor logs; route through SEP-12.
- **`funding_method` ≠ `type` — and the `/info` key may not match the request key.** Send the field as `funding_method` on the request; the deprecated `type` request parameter is a legacy fallback. Anchors commonly still advertise this field keyed `type` in the `/info` `fields` object, so don't assume the `/info` key is the wire key — map it to `funding_method` unless the anchor explicitly requires `type`.
- **Check `r.ok` and handle 401 on every authenticated call.** Wrap `/deposit`, `/withdraw`, `/transaction`, and `PATCH /transactions/{id}` in a fetch helper that re-runs SEP-10 on a 401 and retries, throws on other non-2xx with the response body, and only then parses JSON. A long SEP-6 poll loop will outlive the JWT at some anchors. See gotcha #11 and [discovery-and-auth.md](discovery-and-auth.md#jwt-lifetime-and-mid-flow-re-auth) for the re-auth path.
- **`on_change_callback`** is a wallet-supplied URL the anchor will POST to whenever status changes. The same signature scheme as SEP-24's URL callbacks applies; verify with `SIGNING_KEY` from the TOML. Polling and callbacks are not mutually exclusive — use both.
- **Use `/deposit-exchange` and `/withdraw-exchange` for non-1:1 conversions** with a SEP-38 `quote_id`. Plain `/deposit` will reject mismatched asset pairs.
- **Validate against `testanchor.stellar.org` first** — see [testing-and-validation.md](../testing/testing-and-validation.md). It implements every SEP-6 endpoint including the `pending_customer_info_update` branch.
