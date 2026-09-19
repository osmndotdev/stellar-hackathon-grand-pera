# SEP-38 Quotes / RFQ

SEP-38 is the pricing layer underneath every non-1:1 anchor flow. Whenever you're moving between assets that aren't the same thing on both sides (USD → USDC, BRL → USDC, USDC → MXN), the anchor's `quote_id` from SEP-38 is what locks the rate.

Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md

**Prerequisites:** SEP-1 done (`ANCHOR_QUOTE_SERVER` resolved), SEP-10 JWT for the firm-quote endpoints. The informational endpoints (`/info`, `/prices`, `/price`) typically don't require auth but anchors may require it for personalization.

---

## Indicative vs firm — the only distinction that matters

| | Indicative | Firm |
|---|---|---|
| Endpoint | `GET /prices`, `GET /price` | `POST /quote` |
| Authenticated | No (sometimes) | **Yes** (SEP-10 JWT required) |
| Reserved capacity | No — the anchor may move | **Yes** — anchor holds the rate |
| `expires_at` | Not returned | Returned, MUST honor before |
| Use for | Showing the user a rate before they commit | The actual transaction the wallet will execute |

The wallet pattern is: **indicative for display, firm for transact**. Show a `GET /price` result on the user's screen ("you'll get ≈ 100 USDC for 100 USD"); once they confirm, `POST /quote` to lock the rate; pass the resulting `quote_id` to SEP-6 `/deposit-exchange` / SEP-24 `/transactions/deposit/interactive` / SEP-31 `POST /transactions`.

---

## Asset identifier format

Every asset throughout SEP-38 is identified by a `<scheme>:<identifier>` string:

- **On-chain Stellar asset:** `stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
- **On-chain native XLM:** `stellar:native`
- **Off-chain fiat (ISO 4217):** `iso4217:USD`, `iso4217:BRL`, `iso4217:NGN`

Never use bare `USDC` or `USD` in SEP-38 calls — pass the full `<scheme>:<identifier>`. This is also how `amount_in_asset` and `amount_out_asset` come back on SEP-6 / SEP-24 transaction objects for non-equivalent flows.

---

## GET /info — which pairs and delivery methods

```http
GET {ANCHOR_QUOTE_SERVER}/info
```

```json
{
  "assets": [
    {
      "asset": "iso4217:USD",
      "country_codes": ["USA"],
      "sell_delivery_methods": [
        { "name": "ACH",   "description": "ACH transfer" },
        { "name": "SWIFT", "description": "International wire" }
      ],
      "buy_delivery_methods": [
        { "name": "ACH" }
      ]
    },
    {
      "asset": "stellar:USDC:GA5Z...",
      "sell_delivery_methods": [],
      "buy_delivery_methods": []
    }
  ]
}
```

Two things to read:

1. **`country_codes`** — anchors restrict which fiat corridors they support. If the user's country isn't listed, you cannot get a quote, period.
2. **`sell_delivery_methods` / `buy_delivery_methods`** — for fiat assets, these tell you which rails the anchor accepts (ACH, SWIFT, SEPA, cash, mobile-money). Stellar assets have empty arrays because the rail is "Stellar." When you eventually call `POST /quote`, you must pass the right delivery method name from this list.

---

## GET /prices — what can I sell?

When the user hasn't picked the buy side yet:

```http
GET {ANCHOR_QUOTE_SERVER}/prices
    ?sell_asset=iso4217:USD
    &sell_amount=100
    &sell_delivery_method=ACH
    &country_code=USA
```

Response:

```json
{
  "buy_assets": [
    {
      "asset":      "stellar:USDC:GA5Z...",
      "price":      "1.02",
      "decimals":   7
    },
    {
      "asset":      "stellar:USDT:GBQH...",
      "price":      "1.02",
      "decimals":   7
    }
  ]
}
```

`price` is `(units of sell_asset) per (unit of buy_asset)` — i.e. the user pays `price × buy_amount` units of `sell_asset`. Read it carefully; many wallets invert it and confuse users by ~10%.

---

## GET /price — what's the rate for this exact pair?

```http
GET {ANCHOR_QUOTE_SERVER}/price
    ?sell_asset=iso4217:USD
    &buy_asset=stellar:USDC:GA5Z...
    &sell_amount=100                  # OR buy_amount, never both
    &sell_delivery_method=ACH
    &context=sep24                     # sep6 | sep24 | sep31
```

Response:

```json
{
  "total_price": "1.05",     // sell_amount / buy_amount before fee
  "price":       "1.02",     // exchange rate alone
  "sell_amount": "100.00",
  "buy_amount":  "95.24",
  "fee": {
    "total": "3.00",
    "asset": "iso4217:USD",
    "details": [
      { "name": "Service fee",          "amount": "2.00" },
      { "name": "Country tax",          "amount": "1.00", "description": "Required by local regulation" }
    ]
  }
}
```

**Pass `context`** so the anchor knows which SEP-6 / SEP-24 / SEP-31 fee tier and corridor applies. Same pair can quote differently across flows.

`total_price` × `buy_amount` = `sell_amount` (including fees). `price` alone is the pre-fee rate. Display whichever your UX uses; many wallets show `total_price` to avoid surprise fees at confirmation. Note that `price`, `total_price`, `sell_amount`, `buy_amount`, and every fee amount come back as STRINGS with 7-decimal precision — do all this rate math with a decimal library (never `parseFloat`) and compare/round as decimals, per the skill's amount-precision gotcha (#6).

---

## POST /quote — lock the rate

```http
POST {ANCHOR_QUOTE_SERVER}/quote
Authorization: Bearer <SEP-10 JWT>
Content-Type: application/json

{
  "sell_asset":           "iso4217:USD",
  "buy_asset":            "stellar:USDC:GA5Z...",
  "sell_amount":          "100",
  "sell_delivery_method": "ACH",
  "context":              "sep24",
  "expire_after":         "2026-06-15T14:30:00Z"
}
```

- One of `sell_amount` or `buy_amount` — never both.
- `expire_after` is optional; anchors set their own default and may cap how far out you can request.
- `context` is required and must match the SEP you'll redeem the quote in.

Response `201 Created`:

```json
{
  "id":          "de762cda-a193-4961-861e-57b31fed6eb3",
  "expires_at":  "2026-06-15T14:32:30Z",
  "total_price": "1.05",
  "price":       "1.02",
  "sell_asset":  "iso4217:USD",
  "sell_amount": "100.00",
  "buy_asset":   "stellar:USDC:GA5Z...",
  "buy_amount":  "95.24",
  "fee":         { /* as in GET /price */ }
}
```

Store `id` and `expires_at`. The anchor MUST honor the rate as long as you complete the transfer before `expires_at`.

---

## GET /quote/{id} — fetch later

Returns the same shape as the POST response. Per spec, it's available **even after expiration** so downstream SEPs (SEP-6 transactions, SEP-24 transactions) can still reference the original quote for audit.

---

## How quote_id flows into the other SEPs

| SEP | Where `quote_id` goes |
|---|---|
| SEP-6 | `quote_id` parameter on `GET /deposit-exchange` / `GET /withdraw-exchange` |
| SEP-24 | `quote_id` field in the POST body of `/transactions/deposit/interactive` / `/transactions/withdraw/interactive` |
| SEP-31 | `quote_id` field in the POST body of `/transactions` |

If you pass a `quote_id`, the anchor MUST respect it. **If the `asset_code` / `amount` / `source_asset` in your downstream call disagree with the quote**, the anchor returns 400. Always derive these from the quote response, not from the pre-quote user input.

---

## The re-quote loop

SEP-38 does not formally define what happens when you redeem an expired `quote_id` downstream — but anchors do, in practice, reject. Plan for it.

```ts
async function startFlowWithFreshQuote() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const quote = await postQuote(/* … */);

    try {
      return await startSep24Deposit({ ...buildParams(quote), quote_id: quote.id });
    } catch (e) {
      if (isQuoteExpired(e)) continue;        // re-quote, retry
      throw e;
    }
  }
  throw new Error("Could not lock a quote — anchor pricing churning too fast.");
}
```

Practical hardening:

- **Do not show the user the rate from a stale quote.** When you re-quote, refresh the UI; don't pretend the rate didn't move.
- **Don't surface "quote expired" verbatim.** The user can't act on it. Re-quote silently or show "refreshing rate."
- **If three re-quotes fail, surface a UX-level error.** That's the anchor having a bad day; bouncing the user is the right outcome.

---

## A minimal end-to-end SEP-38 + SEP-24 quote-then-deposit (TypeScript-ish)

```ts
async function quoteAndDeposit(transferServer: string, quoteServer: string, jwt: string) {
  // 1. Lock a firm rate
  const quoteRes = await fetch(`${quoteServer}/quote`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sell_asset:           "iso4217:USD",
      buy_asset:            "stellar:USDC:GA5Z...",
      sell_amount:          "100",
      sell_delivery_method: "ACH",
      context:              "sep24",
    }),
  });
  if (!quoteRes.ok) throw new Error(await quoteRes.text());
  const quote = await quoteRes.json();

  // 2. Pass the quote_id into SEP-24
  const start = await fetch(`${transferServer}/transactions/deposit/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      asset_code:   "USDC",
      asset_issuer: "GA5Z...",
      source_asset: quote.sell_asset,
      amount:       quote.sell_amount,
      quote_id:     quote.id,
    }),
  }).then(r => r.json());

  return start;
}
```

If `start` comes back with an error mentioning the quote, catch it, re-`POST /quote`, retry.

---

## SEP-38 footguns checklist

- **Indicative ≠ firm.** Never charge a user against an indicative price; you have no anchor commitment behind it.
- **`context` is required on `/price` and `POST /quote`.** Same pair quotes differently across SEPs.
- **Asset identifiers always use the `<scheme>:<id>` form** — never bare codes.
- **`price` is `sell per buy`, not `buy per sell`.** Inverting it is a top reason wallets show wrong amounts.
- **`price`, `total_price`, `sell_amount`, `buy_amount`, and every fee amount are STRINGS with 7-decimal precision.** Do all rate math with a decimal library — never `parseFloat` — and compare/round as decimals, per the skill's amount-precision gotcha (#6).
- **Pass the exact `delivery_method` name from `/info`**, case-sensitive. Anchors do not fuzzy-match `"ach"` vs `"ACH"`.
- **Re-quote on expiry silently** — never bounce "quote expired" to the user.
- **`GET /quote/:id` survives expiration** — use it for audit / reconciliation; don't try to redeem it after `expires_at`.
- **Match the `quote_id` downstream call exactly.** Diverging `amount` or `asset_code` from the quote returns 400.
