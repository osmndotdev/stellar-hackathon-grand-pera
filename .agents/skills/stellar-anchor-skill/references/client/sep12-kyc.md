# SEP-12 KYC

SEP-12 is the **KYC API**. It is the only file in this skill that gets called by every flow: SEP-6 uses it to pre-load customer data, SEP-24 uses it when the hosted UI is bypassed for known customers, and SEP-31 uses it to register both the sender and the receiver of a remittance.

Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md
Field vocabulary: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0009.md

**Prerequisites:** SEP-1 done, SEP-10 JWT in hand, endpoint resolved from `KYC_SERVER`.

---

## The five endpoints

| Endpoint | Purpose |
|---|---|
| `GET  /customer` | Check current KYC status and what fields are still required. |
| `PUT  /customer` | Submit (or resubmit) customer fields. Idempotent. |
| `DELETE /customer/{account}` | Right-to-be-forgotten. Anchor erases the customer record. |
| `PUT  /customer/callback` | Register a URL the anchor POSTs to on status changes. |
| `PUT  /customer/verification` | Deprecated alias for submitting OTP codes — use `PUT /customer` with `*_verification` fields instead. |

All require `Authorization: Bearer <SEP-10 JWT>`.

---

## SEP-9 — the field vocabulary

You don't invent field names. SEP-9 defines the canonical set: `first_name`, `last_name`, `email_address`, `mobile_number`, `id_type`, `id_number`, `id_issuing_country`, `photo_id_front`, `photo_id_back`, `proof_of_income`, `ip_address`, `tax_id`, `bank_account_number`, `bank_routing_number`, and many more for natural persons and organizations.

The anchor picks the subset it requires; the SEP-9 spec names them. Don't ship a wallet that hard-codes which fields to collect — read them from the anchor's `fields` response and render accordingly.

---

## The customer state machine

The customer record (per anchor, per `type`) is always in one of four states:

| Status | What you do |
|---|---|
| `ACCEPTED` | KYC complete for this `type`. Continue with the SEP-6/24/31 flow. |
| `PROCESSING` | Anchor is reviewing async (often manual review). Poll later; do not re-PUT the same data. |
| `NEEDS_INFO` | Anchor needs more fields. Read `fields` from the response, collect them, re-PUT. |
| `REJECTED` | Terminal failure. `message` explains why. Do not retry. |

A subtlety: a customer can be `ACCEPTED` for `type=sep31-sender` and simultaneously `NEEDS_INFO` for `type=sep24` — KYC requirements differ per flow. **Always pass the `type` you intend to transact with**, or you'll get a status that doesn't match the call you're about to make.

---

## GET /customer — what does the anchor still need?

```http
GET {KYC_SERVER}/customer?type=sep24
Authorization: Bearer <JWT>
```

(`account` and `memo` are deprecated as query params — the JWT `sub` carries them.)

Response:

```json
{
  "id": "391fb415-c223-4608-b2f5-dd1e91e3a986",
  "status": "NEEDS_INFO",
  "fields": {
    "first_name":       { "type": "string", "description": "Given name" },
    "last_name":        { "type": "string", "description": "Family name" },
    "email_address":    { "type": "string", "description": "Email" },
    "mobile_number":    { "type": "string", "description": "Mobile phone, E.164" },
    "id_type":          { "type": "string", "choices": ["passport", "drivers_license", "national_id"] },
    "photo_id_front":   { "type": "binary", "description": "Front of ID" }
  },
  "provided_fields": {
    "first_name":  { "type": "string", "status": "ACCEPTED" },
    "last_name":   { "type": "string", "status": "ACCEPTED" },
    "email_address": { "type": "string", "status": "VERIFICATION_REQUIRED" }
  },
  "message": "Please verify your email and complete ID verification."
}
```

Two objects, two purposes:

- **`fields`** — what the anchor needs from you. Render a form from this; don't guess.
- **`provided_fields`** — what you've already sent and where it stands. Includes per-field `status` (`ACCEPTED`, `PROCESSING`, `REJECTED`, `VERIFICATION_REQUIRED`) and an `error` string for rejections. Show the user what was accepted before re-asking for more.

---

## PUT /customer — submit fields

```http
PUT {KYC_SERVER}/customer
Authorization: Bearer <JWT>
Content-Type: multipart/form-data            # whenever binary fields are present
                                              # otherwise application/json or x-www-form-urlencoded

type=sep24
first_name=Alice
last_name=Doe
email_address=alice@example.com
mobile_number=+15551234567
id_type=passport
photo_id_front=@./id-front.jpg
```

Response:

```json
{ "id": "391fb415-c223-4608-b2f5-dd1e91e3a986" }
```

Save the `id`. **Pass it as `customer_id` to your SEP-6 / SEP-31 / SEP-24 calls** so the anchor knows which customer record this transaction belongs to.

Three submission rules that bite:

1. **Binary fields go last** in multipart/form-data. The spec says SHOULD; in practice many anchors fail if file fields precede text fields.
2. **PUT is idempotent.** Re-PUTting the same data after a `NEEDS_INFO` response is safe; the anchor merges fields into the existing record.
3. **Use `multipart/form-data` only when sending files.** For text-only submissions, prefer JSON — it's easier to debug and avoids the binary-last ordering trap.

---

## The verification loop (OTP / SMS / email)

When the anchor needs to prove the user controls a phone or email, it sets the field's `provided_fields` status to `VERIFICATION_REQUIRED` and sends the user a code out-of-band.

```
1. PUT /customer with mobile_number=+1...                → status: VERIFICATION_REQUIRED
2. Anchor SMS-es a 6-digit code to that number
3. Prompt the user for the code
4. PUT /customer with mobile_number_verification=123456  → status: ACCEPTED or PROCESSING
```

**The verification value is sent as `<field_name>_verification`**, alongside (or instead of) the field itself, in a regular `PUT /customer` call. The dedicated `PUT /customer/verification` endpoint exists but is deprecated — use `PUT /customer`.

---

## Customer types — the value of `type`

SEP-12 itself doesn't enumerate `type` values; each composing SEP defines its own. The common ones you'll see:

| `type` | Used by |
|---|---|
| `sep6` | SEP-6 deposit/withdraw KYC |
| `sep24` | SEP-24 hosted-flow customers (when bypassing the popup KYC) |
| `sep31-sender` | The organization or person *sending* a SEP-31 remittance |
| `sep31-receiver` | The recipient on the other side of a SEP-31 remittance |
| `counterparty_organization` | An anchor or fintech acting as a counterparty |

If you omit `type`, the anchor either uses its default or returns `NEEDS_INFO` complaining that `type` is required. Always specify.

---

## PUT /customer/callback — status push instead of poll

Registering a callback URL means the anchor will POST status changes to you instead of you polling `GET /customer`.

```http
PUT {KYC_SERVER}/customer/callback
Authorization: Bearer <JWT>

id=391fb415-...
url=https://wallet.example.com/sep12/callback
```

Each callback POST includes the same body shape as `GET /customer` and a signed `Signature` header:

```
Signature: t=<unix_ts>, s=<base64_ed25519_sig>
```

Same scheme as SEP-24 callbacks. Payload to verify is `<timestamp>.<your_host>.<body>`, signature checked against `SIGNING_KEY` from the anchor's `stellar.toml`. Reject timestamps more than ~1–2 minutes old.

**Polling and callbacks aren't mutually exclusive.** Run both — callbacks are best-effort and a missed one strands the user.

---

## DELETE /customer/{account} — right to be forgotten

```http
DELETE {KYC_SERVER}/customer/{account}
Authorization: Bearer <JWT>
```

Anchor erases the customer record. Required for GDPR / CCPA compliance flows. For shared custodial accounts, include `memo` as a query parameter — it must match the JWT `sub` memo.

After DELETE, subsequent `GET /customer` returns 404 until a new `PUT /customer` re-creates the record.

---

## A minimal end-to-end KYC loop (TypeScript-ish)

```ts
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// `reauth` re-runs SEP-10 and returns a fresh JWT — see discovery-and-auth.md
// ("JWT lifetime and mid-flow re-auth"). Transparent: never bounces the user.
async function ensureKycAccepted(
  kycServer: string,
  jwt: string,
  type: string,
  getMissing: (fields: any) => Promise<Record<string,any>>,
  reauth: () => Promise<string>,
) {
  const MAX_ATTEMPTS = 20;            // bound the loop: a persistent NEEDS_INFO must not spin forever
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let r = await fetch(`${kycServer}/customer?type=${type}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (r.status === 401) {           // SEP-10 JWT expired mid-flow — re-auth and retry once
      jwt = await reauth();
      r = await fetch(`${kycServer}/customer?type=${type}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
    }
    if (!r.ok) throw new Error(`GET /customer failed (${r.status}): ${await r.text()}`);
    const status = await r.json();

    if (status.status === "ACCEPTED")  return status.id;
    if (status.status === "REJECTED")  throw new Error(`KYC rejected: ${status.message}`);
    if (status.status === "PROCESSING") { await sleep(5000); continue; }

    // NEEDS_INFO — collect, then PUT
    const missing = await getMissing(status.fields);

    // Detect binaries from the actual collected values, not the field descriptors.
    const hasBinary = Object.values(missing).some(v => v instanceof Blob);
    let body: BodyInit;
    let headers: Record<string,string> = { Authorization: `Bearer ${jwt}` };

    if (hasBinary) {
      const form = new FormData();
      for (const [k, v] of Object.entries(missing)) if (!(v instanceof Blob)) form.append(k, String(v));
      for (const [k, v] of Object.entries(missing)) if (v instanceof Blob)    form.append(k, v);  // binary last
      form.append("type", type);
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ type, ...missing });
    }

    let put = await fetch(`${kycServer}/customer`, { method: "PUT", headers, body });
    if (put.status === 401) {         // token may have lapsed between GET and PUT
      jwt = await reauth();
      headers.Authorization = `Bearer ${jwt}`;
      put = await fetch(`${kycServer}/customer`, { method: "PUT", headers, body });
    }
    if (!put.ok) throw new Error(`PUT /customer failed (${put.status}): ${await put.text()}`);
  }
  throw new Error(`KYC did not reach ACCEPTED within ${MAX_ATTEMPTS} attempts`);
}
```

---

## SEP-12 footguns checklist

- **Always pass `type`.** Without it the anchor either guesses (badly) or returns `NEEDS_INFO` demanding `type` itself.
- **Render the form from `fields`, not from a hard-coded list.** Different anchors require different SEP-9 fields; some require organization fields that natural-person KYC doesn't touch.
- **Status is per `type`.** Don't cache "this customer is ACCEPTED" across flows — they may need extra fields for the next flow.
- **Binary fields go last in multipart/form-data.** SHOULD per spec; in practice some anchors fail otherwise.
- **OTP verification uses `<field>_verification` in `PUT /customer`**, not the deprecated `/customer/verification` endpoint.
- **Verify callback signatures with the TOML's `SIGNING_KEY`.** Same key as SEP-10 challenge verification; see [discovery-and-auth.md](discovery-and-auth.md#the-signing_key-is-multi-purpose).
- **Run both polling and callbacks.** A missed callback means the user is stuck in a state your code can't escape.
- **Persist `customer_id`** across sessions — passing the same `id` on a future `PUT` continues the same record rather than starting a new one.
