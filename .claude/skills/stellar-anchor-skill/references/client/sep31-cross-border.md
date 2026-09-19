# SEP-31 Cross-Border Payments

SEP-31 is **anchor-to-anchor remittance**. There is no end-user wallet on either side: the **sending anchor** (a fintech or payment processor) receives funds from a sender off-chain, hands them via Stellar to a **receiving anchor**, who delivers them to the recipient off-chain.

If you are building a retail wallet, you almost certainly want SEP-24 or SEP-6, not SEP-31. SEP-31 is for the *organizations* in the corridor.

Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md

**Prerequisites:** SEP-1 done (`DIRECT_PAYMENT_SERVER` resolved), SEP-10 JWT (your sending-anchor authenticates as itself against the receiving anchor), at minimum your platform integrated with SEP-12 (for sender/receiver KYC) and SEP-38 (for any non-1:1 currency pair).

---

## The actors

```
+----------------+      +-----------------+      +--------+      +-------------------+      +------------------+
| Sending Client | ---> | Sending Anchor  | ===> | Stellar| ===> | Receiving Anchor  | ---> | Receiving Client |
| (sender org)   |      | (you, here)     |      |        |      | (the SEP-31 anchor)|     | (recipient)      |
+----------------+      +-----------------+      +--------+      +-------------------+      +------------------+
        |                       |                                          |                          |
        |  off-chain fiat       |                                          |  off-chain payout        |
        +-----------------------+                                          +--------------------------+
```

Your code lives at the "Sending Anchor" box. The receiving anchor is the SEP-31 endpoint you're calling. Both clients are organizations or natural persons your platform has its own onboarding for; **they never interact with Stellar directly**.

---

## The flow at a glance

```
1. GET   /info                       → which corridors, what KYC, which assets
2. PUT   /customer (SEP-12) x2       → register sender_id AND receiver_id
3. POST  /quote (SEP-38)             → lock rate if non-equivalent assets (optional, common)
4. POST  /transactions               → returns stellar_account_id + stellar_memo
5. Submit Stellar payment            → with EXACT memo, asset, amount
6. Poll  /transactions/:id           → wait for pending_external → completed
7. Handle PATCH if pending_transaction_info_update (deprecated; usually KYC route instead)
```

---

## Step 1 — GET /info

```http
GET {DIRECT_PAYMENT_SERVER}/info
```

```json
{
  "receive": {
    "USDC": {
      "enabled": true,
      "quotes_required": true,
      "quotes_supported": true,
      "fee_fixed": 0,
      "fee_percent": 0.5,
      "min_amount": 1,
      "max_amount": 1000000,
      "sep12": {
        "sender":   { "types": { "sep31-large-sender":   { "description": "Senders sending more than $10,000 USD" },
                                  "sep31-small-sender":   { "description": "Senders sending less than $10,000 USD" } } },
        "receiver": { "types": { "sep31-receiver":       { "description": "Recipient receiving funds via SEP-31" } } }
      }
    }
  }
}
```

Two things specific to SEP-31 in `/info` you have to act on:

1. **`sep12.sender.types` and `sep12.receiver.types`** — choose the right `type` strings to pass to SEP-12 for each side. Different KYC tiers exist for different transaction amounts.
2. **`quotes_required` / `quotes_supported`** — if `quotes_required: true`, you MUST get a SEP-38 firm quote before `POST /transactions`. If `false`, the anchor uses spot or a 1:1 mapping.

---

## Step 2 — KYC both sides via SEP-12

You PUT two customers — one for the sender, one for the receiver — and pass their `id`s into `POST /transactions`. See [sep12-kyc.md](sep12-kyc.md) for the full SEP-12 flow.

```
PUT  {KYC_SERVER}/customer  type=sep31-large-sender  …sender SEP-9 fields…
   → { id: "<sender_id>",  status: "ACCEPTED" | "NEEDS_INFO" | … }

PUT  {KYC_SERVER}/customer  type=sep31-receiver      …receiver SEP-9 fields…
   → { id: "<receiver_id>", status: "ACCEPTED" | "NEEDS_INFO" | … }
```

Both customers MUST reach `ACCEPTED` before the receiving anchor will accept `POST /transactions` — or they may accept it and immediately move to `pending_customer_info_update`. Either way, finish KYC first.

**Use the same `id`s across all transactions involving the same parties.** SEP-12 is keyed by `customer_id`; re-PUTting with the saved id continues the same record rather than creating a duplicate.

---

## Step 3 — Lock a quote (when assets differ)

When the sender is delivering USD off-chain and the recipient should receive MXN off-chain (with USDC as the on-chain rail in the middle), you need a SEP-38 firm quote so the rate is fixed before the Stellar payment leaves your treasury.

```
POST {ANCHOR_QUOTE_SERVER}/quote   context=sep31   sell_asset=stellar:USDC:…   buy_asset=iso4217:MXN   sell_amount=1000
   → { id: "<quote_id>", expires_at, total_price, price, sell_amount, buy_amount, fee, … }
```

Pass `quote_id` to `POST /transactions` in the next step. See [sep38-quotes.md](sep38-quotes.md).

---

## Step 4 — POST /transactions

```http
POST {DIRECT_PAYMENT_SERVER}/transactions
Authorization: Bearer <SEP-10 JWT>
Content-Type: application/json

{
  "amount":           "1000",
  "asset_code":       "USDC",
  "asset_issuer":     "GA5Z...",
  "destination_asset": "iso4217:MXN",     # for non-equivalent flows
  "quote_id":         "de762cda-…",        # required when /info says quotes_required
  "sender_id":        "<from SEP-12>",
  "receiver_id":      "<from SEP-12>",
  "funding_method":   "bank_account",
  "refund_memo":      "12345",             # optional, for shared accounts
  "refund_memo_type": "id",
  "lang":             "en"
}
```

`fields` (passing transaction-level data inline) is **deprecated** — route everything through SEP-12 instead. New integrations should not populate `fields`.

Response `201 Created`:

```json
{
  "id":                 "82fhs729f63dh0v4",
  "stellar_account_id": "GCIBUCGPOHWMMMFPFKDKE2...",
  "stellar_memo":       "1234567890",
  "stellar_memo_type":  "id"
}
```

These three fields are the contract for the next step. Save them — they are the only way the receiving anchor can attribute your incoming Stellar payment.

---

## Step 5 — Submit the Stellar payment

```js
const op = Operation.payment({
  destination: tx.stellar_account_id,
  asset:       new Asset(assetCode, assetIssuer),
  amount:      "1000.0000000",        // exact, as agreed
});

const stellarTx = new TransactionBuilder(sendingAnchorAccount, { fee, networkPassphrase })
  .addOperation(op)
  .addMemo(buildMemo(tx.stellar_memo_type, tx.stellar_memo))   // <-- non-negotiable
  .setTimeout(180)
  .build();

stellarTx.sign(sendingAnchorKeypair);
await horizon.submitTransaction(stellarTx);
```

**Three rules:**

1. **The memo is how the receiving anchor matches your payment to the SEP-31 transaction.** Wrong memo or wrong type → the funds land in the receiving anchor's pooled account with no owner. Most anchors will eventually refund, but you've cost the recipient hours-to-days.
2. **For firm-quote transactions, the payment MUST hit the network before `expires_at`.** Build with `setTimeout(180)` minimum, and account for ledger close time (~5–10s). If your treasury queue is slow, request a longer quote.
3. **Amount must match exactly.** SEP-31 doesn't carry the ±10% tolerance SEP-24 anchors sometimes accept.

---

## Step 6 — Poll for status

```http
GET {DIRECT_PAYMENT_SERVER}/transactions/{id}
Authorization: Bearer <JWT>
```

### The SEP-31 status state machine

```
pending_sender                       (anchor waiting for your Stellar payment)
   |
   v
pending_stellar                      (anchor sees your tx, awaiting ledger close)
   |
   v
pending_receiver                     (receiving anchor processing internally)
   |
   v
pending_external                     (off-chain payout in flight to the recipient)
   |
   v
completed                            (terminal)
```

These are the **SEP-31-specific** status strings (per SEP-0031: `pending_sender`, `pending_stellar`, `pending_receiver`, `pending_external`, plus the branches below). They are deliberately different from the generic vocabulary in SKILL.md gotcha #8 (`incomplete → pending_user_transfer_start → pending_anchor/pending_external → completed`), which describes the SEP-6/24 anchor path — don't reuse those names here.

Branches:

| Status | Meaning | Your action |
|---|---|---|
| `pending_customer_info_update` | KYC needs updating (often: sender exceeded a tier limit, anchor wants more docs). The transaction object lists which fields. | Re-PUT `/customer` (SEP-12) for the indicated side; transaction resumes. |
| `pending_transaction_info_update` | **Deprecated approach** — the spec recommends KYC updates over per-transaction patches. If you see it, the response includes `required_info_updates`; PATCH `/transactions/{id}` with the fields. New anchors should not move into this state. | PATCH `/transactions/{id}` with the fields named in `required_info_updates`; transaction resumes. |
| `refunded` | Receiving anchor refunded; check `refunds` for amount and payment IDs. | Reconcile `refunds.payments[].id` against Horizon; close out the transaction. |
| `expired` | Quote expired before your Stellar payment confirmed, or per anchor policy. Funds were not moved (or were refunded). | Re-quote (SEP-38) and start a new transaction; confirm any refund landed. |
| `error` | Catch-all; surface `message`. | Surface `message` to the operator and stop polling. |

### PUT /transactions/:id/callback — push instead of poll

```http
PUT {DIRECT_PAYMENT_SERVER}/transactions/{id}/callback
Authorization: Bearer <JWT>

url=https://sending-anchor.example.com/sep31/callback
```

Same signed-callback scheme as SEP-12 and SEP-24 — verify with `SIGNING_KEY` from the receiving anchor's `stellar.toml`. Run polling AND callbacks; never one or the other alone.

---

## Refunds

When the receiving anchor refunds (KYC reject after the fact, unable to deliver, recipient declined), the transaction object's `refunds` object is populated:

```json
{
  "refunds": {
    "amount_refunded": "1000",
    "amount_fee":      "5",
    "payments": [
      { "id": "<stellar tx hash>", "amount": "1000", "fee": "5" }
    ]
  }
}
```

The refund is delivered via a Stellar payment to your **`refund_memo`** (if you passed one) or the same `account` you sent from. Reconcile by matching `payments[].id` to your Horizon stream — don't trust the SEP-31 response alone for treasury accounting.

---

## A minimal SEP-31 send (TypeScript-ish)

```ts
// 1. /info
const info = await fetch(`${dps}/info`).then(r => r.json());
const ass = info.receive.USDC;
if (!ass?.enabled) throw new Error("USDC corridor disabled");

// 2. KYC both sides (omitted: the SEP-12 PUT loop until ACCEPTED)
const senderId   = await putCustomer(kycServer, jwt, "sep31-large-sender", SENDER_DATA);
const receiverId = await putCustomer(kycServer, jwt, "sep31-receiver",      RECEIVER_DATA);

// 3. Quote, if /info demands
let quoteId: string | undefined;
if (ass.quotes_required) {
  const quote = await postQuote(quoteServer, jwt, {
    context: "sep31", sell_asset: "stellar:USDC:GA5Z...", buy_asset: "iso4217:MXN", sell_amount: "1000",
  });
  quoteId = quote.id;
}

// 4. /transactions
// POST /transactions returns the tx fields at top level (not wrapped)
const tx = await fetch(`${dps}/transactions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    amount: "1000", asset_code: "USDC", asset_issuer: USDC_ISSUER,
    destination_asset: "iso4217:MXN", quote_id: quoteId,
    sender_id: senderId, receiver_id: receiverId,
    funding_method: "bank_account",
  }),
}).then(r => r.json());

// 5. Stellar payment with the exact memo
await submitStellarPayment({
  destination: tx.stellar_account_id,
  amount: "1000.0000000",
  asset: new Asset("USDC", USDC_ISSUER),
  memo: buildMemo(tx.stellar_memo_type, tx.stellar_memo),
});

// 6. Poll
for (;;) {
  // GET /transactions/{id} wraps the tx in { transaction: {...} }
  const { transaction: t } = await fetch(`${dps}/transactions/${tx.id}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  }).then(r => r.json());
  if (t.status === "completed" || t.status === "refunded" || t.status === "error") return t;
  if (t.status === "pending_customer_info_update") {
    // pending_customer_info_update surfaces required fields via the SEP-12 customer
    // record, NOT on the transaction — see references/client/sep12-kyc.md.
    await reKyc(senderId, receiverId);
  }
  if (t.status === "pending_transaction_info_update") {
    // pending_transaction_info_update surfaces required_info_updates ON the transaction.
    await patchTransaction(tx.id, t.required_info_updates);
  }
  await sleep(5000);
}
```

---

## SEP-31 footguns checklist

- **`fields` in POST is deprecated.** Use SEP-12 for all per-customer data. New anchors expect this.
- **`sender_id` and `receiver_id` are separate SEP-12 customers** — different `type`s, different `id`s, both pre-ACCEPTED.
- **Quote `context=sep31`** when requesting. A `sep24` quote is not redeemable in a SEP-31 transaction.
- **Memo type matters.** The spec uses `stellar_memo_type` in the response, not `memo_type`; the SDK's `buildMemo(type, value)` call is the same as the SEP-24 / SEP-6 path.
- **Pay before `expires_at` from the quote.** Receiving anchors will reject (or move to `error`) if the Stellar payment closes after expiry. Don't queue payments behind slow approvals when you've taken a firm quote.
- **`pending_transaction_info_update` is the legacy path** — prefer the SEP-12 KYC route. If you have to handle it, PATCH `/transactions/{id}` with the requested fields; the endpoint mirrors SEP-6.
- **Reconcile refunds with on-chain payment hashes**, not just the SEP-31 response. Your treasury ledger needs the Horizon op_id, not the anchor's transaction id.
- **There is no end-user JWT.** Your sending-anchor authenticates as *itself* via SEP-10; the user (sender) is identified only via the SEP-12 `customer_id`. Don't try to issue per-user JWTs against the receiving anchor.
