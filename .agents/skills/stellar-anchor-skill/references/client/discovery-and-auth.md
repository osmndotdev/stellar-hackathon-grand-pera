# Discovery and Authentication — SEP-1 + SEP-10

Every anchor flow begins here. SEP-1 tells you where the anchor's endpoints live and which keys to trust. SEP-10 turns the user's Stellar keypair into a Bearer JWT you carry on every later API call.

These two SEPs are always done in this exact order: SEP-1 first to find `WEB_AUTH_ENDPOINT`, then SEP-10 to obtain a JWT. Don't split them across separate code paths — they share state (the anchor's `SIGNING_KEY`, the home domain) and bugs love the seam.

Spec ground truth:
- SEP-1: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
- SEP-10: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md

---

## SEP-1 — Discovery via stellar.toml

The anchor advertises every endpoint, key, and supported asset in a single TOML file at a well-known path.

### Fetch

```http
GET https://{HOME_DOMAIN}/.well-known/stellar.toml
```

Requirements you should *verify* on the response, not assume:

- **Path** is exactly `/.well-known/stellar.toml` — not `/stellar.toml`, not a subdirectory.
- **`Access-Control-Allow-Origin: *`** is required *of the anchor* — the server must send it. In a browser, you can't read or check this header from JS: a missing/incorrect CORS header surfaces as a thrown `fetch` (or an opaque response you can't read the body of), not as a readable header. Catch the `fetch` rejection and surface it as a likely anchor CORS misconfiguration rather than a TOML parse error.
- **`Content-Type: text/plain`** is recommended by the spec but not enforced; tolerate `application/toml` and missing types.
- **Size cap is 100 KB** per spec. If the file is larger, treat it as malformed.
- **HTTPS** — SEP-1 doesn't literally mandate HTTPS for the TOML file itself, but every endpoint listed *inside* it must be `https://`, and every modern wallet refuses HTTP. Treat HTTPS as mandatory and reject anything that comes back without it.

### Parse

Use a strict TOML parser (`@iarna/toml` in Node, `toml` in Python). A trailing comma or duplicated key fails the whole file silently in some parsers — fail loudly instead.

### Fields you actually need

```toml
VERSION = "2.0.0"
NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015"
SIGNING_KEY = "GCHL...233PR"                       # Multi-purpose: see "The SIGNING_KEY is multi-purpose"

WEB_AUTH_ENDPOINT          = "https://anchor.example.com/auth"
TRANSFER_SERVER            = "https://anchor.example.com/sep6"      # SEP-6 only
TRANSFER_SERVER_SEP0024    = "https://anchor.example.com/sep24"     # SEP-24 only
KYC_SERVER                 = "https://anchor.example.com/sep12"
ANCHOR_QUOTE_SERVER        = "https://anchor.example.com/sep38"
DIRECT_PAYMENT_SERVER      = "https://anchor.example.com/sep31"     # SEP-31

[[CURRENCIES]]
code   = "USDC"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
```

A common mistake: reading `TRANSFER_SERVER` and using it for SEP-24. They are **different fields** with different endpoint trees. SEP-6 lives at `TRANSFER_SERVER`; SEP-24 lives at `TRANSFER_SERVER_SEP0024`. The names are confusing — read the field you actually need.

### Network passphrase

Sign every later Stellar transaction with the `NETWORK_PASSPHRASE` from the TOML, not with a hard-coded constant. Mainnet anchors use `"Public Global Stellar Network ; September 2015"`; testnet uses `"Test SDF Network ; September 2015"`. If you cross-wire them, signatures look valid in your library but Horizon rejects them.

### Assets are code + issuer, always paired

Each `[[CURRENCIES]]` block has both `code` and `issuer` (for Stellar assets; contract-based tokens use `contract` instead). When passing assets to any SEP API, send both. `USDC` from Circle and `USDC` from another issuer are different assets and `/info` does not always disambiguate.

### The `SIGNING_KEY` is multi-purpose

This is the gotcha most people miss. The same Ed25519 public key in `SIGNING_KEY` is used to verify:

1. The **SEP-10 challenge transaction** — the server signs it, you verify the signature here.
2. The optional **SEP-24 / SEP-6 URL callback signature** (`Signature: t=<ts>, s=<base64>`).
3. **SEP-12 callback signatures** when the anchor pushes KYC status updates to your callback URL.

Resolve `SIGNING_KEY` once from `stellar.toml`, cache it on the anchor record, and reuse it for every signature verification path. Wallets that re-fetch the TOML in three different code paths get hard-to-debug drift when an anchor rotates the key.

---

## SEP-10 — Web Authentication

SEP-10 issues a JWT bound to a Stellar account. It is a **three-leg handshake**: GET a server-signed challenge, sign it client-side, POST it back.

### Leg 1 — GET the challenge

```http
GET {WEB_AUTH_ENDPOINT}?account=<G...|M...>
                       &home_domain=<anchor home domain>
                       &client_domain=<your wallet domain>   # optional, see below
                       &memo=<numeric id>                    # optional, only with G..., id-type memo
```

- `account` — the user's Stellar public key (`G...`) or a muxed account (`M...`). Required.
- `memo` — only valid with `G...` and only for `id`-type memos. Used when your wallet shares one Stellar account across many users via memos.
- `home_domain` — pass it when the anchor hosts auth for multiple home domains from one endpoint. If you don't pass it, the server picks its default home domain.
- `client_domain` — pass it if you're a non-custodial wallet that wants the JWT to carry a verified `client_domain` claim. See [Client domain attestation](#client-domain-attestation-non-custodial-wallets) below.

### The challenge transaction

The response body is a JSON envelope around a signed Stellar transaction XDR:

```json
{
  "transaction":        "<base64 XDR — the signed challenge>",
  "network_passphrase": "Test SDF Network ; September 2015"
}
```

`network_passphrase` echoes the network the challenge is bound to — use it (or fall back to the TOML's `NETWORK_PASSPHRASE`) when reconstructing the transaction. Mismatching network = signatures look valid in your library and the auth POST rejects with a non-obvious error.

The transaction inside has this structure (per spec):

```
source account:   <Server Account>
sequence number:  0                     # invalid — cannot be submitted
time bounds:      {min: now, max: now + 900}   # 15 minutes
memo:             <as requested>

operations:
  1. manage_data
       source: <Client Account>
       key:    "<home_domain> auth"     # literal space + word "auth"
       value:  base64(48-byte nonce)    # 64 bytes after encoding
  2. manage_data
       source: <Server Account>
       key:    "web_auth_domain"
       value:  <server's domain>        # the host of WEB_AUTH_ENDPOINT
  3. (optional, only if client_domain was requested)
     manage_data
       source: <Client Domain Account>  # from your wallet's stellar.toml SIGNING_KEY
       key:    "client_domain"
       value:  <client_domain>
  4. (reserved) zero or more manage_data ops with source = Server Account
```

### Leg 2 — Verify, then sign

**You MUST verify before signing.** Skipping any of these is how attackers persuade users to sign things they shouldn't:

1. **Sequence number is 0.** Anything else is invalid — the challenge would be runnable on the network. Reject.
2. **Server signature is by `SIGNING_KEY`** from `stellar.toml`. Re-resolve the TOML if you don't have the key cached.
3. **Time bounds.** `min ≤ now ≤ max`. The window is 15 minutes; an old challenge is a replay candidate.
4. **First op is `manage_data`**, source = the account you asked for, key = `"<home_domain> auth"` (exact, including the space), value is 64-character base64.
5. **`web_auth_domain` op present** (when the auth endpoint host differs from the home domain) with source = Server Account, value = the host of `WEB_AUTH_ENDPOINT`. **This is the most-failed check** — `home_domain` ≠ `web_auth_domain` whenever auth lives on a sub- or sibling domain (`anchor.example.com` for the TOML, `auth.example.com` for the endpoint). If you skip this, you produce a JWT that validates locally but is rejected by the anchor with cryptic errors downstream. **Type note when verifying with `@stellar/stellar-sdk`:** `op.value` on a parsed `ManageData` operation is a `Buffer`, not a string. Compare via `op.value.toString("utf8") === new URL(webAuth).host` — comparing the Buffer directly against a string silently fails.
6. **`client_domain` op (if present)** has source = your wallet's Client Domain Account.
7. **All other ops** are `manage_data` with source = Server Account.

Then sign with the user's key (and for `client_domain` attestation, add a second signature from the Client Domain Account — see below).

**Do not submit the signed transaction to the network.** Its sequence number is 0; Horizon would reject it, but more importantly the only purpose of the signature is to prove ownership to the auth endpoint. Submitting wastes XLM and looks like an auth bug. Sign and POST back, nothing else.

### Leg 3 — POST it back

```http
POST {WEB_AUTH_ENDPOINT}
Content-Type: application/json

{ "transaction": "<base64 signed XDR>" }
```

Also accepts `application/x-www-form-urlencoded` with `transaction=<url-encoded base64 XDR>`.

Response:

```json
{ "token": "eyJhbGc..." }
```

### The JWT — what's in it

| Claim | Format |
|---|---|
| `iss` | The auth endpoint URI, e.g. `https://anchor.example.com/auth` |
| `sub` | `G...` (account only), `G...:<memo>` (shared account with id memo), or `M...` (muxed) |
| `iat` | Unix timestamp of issuance |
| `exp` | Unix timestamp of expiry — **anchor-chosen, spec says no fixed TTL** |
| `client_domain` | Present iff the challenge had a `client_domain` op |

The shape of `sub` is the anchor's user identifier downstream — pass the whole string (with the memo) to SEP-12, SEP-6, SEP-24 calls that take a user identifier. Stripping the memo silently moves you to a different user as far as the anchor is concerned.

### JWT lifetime and mid-flow re-auth

The spec only says: "Servers should select an expiration time for the JWT that is appropriate for the assumptions and risk of the interactions." Live anchors range from ~15 minutes to a day. A long KYC or SEP-24 interactive session WILL outlive the token at some anchors.

Wrap every authenticated call:

```ts
async function withFreshJwt<T>(call: (jwt: string) => Promise<Response>): Promise<T> {
  let res = await call(currentJwt);
  if (res.status === 401) {
    currentJwt = await runSep10();           // transparent re-auth, no user prompt
    res = await call(currentJwt);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

Never bounce the user back to "log in again" because a JWT lapsed — the user does not own the lifecycle of the JWT, your code does.

---

## Client domain attestation (non-custodial wallets)

If you're building a non-custodial wallet, anchors increasingly want to know *which wallet* a user came from, independent of the user's account. SEP-10's `client_domain` flow provides this.

Setup, one time per wallet:

1. Host your own `stellar.toml` at `https://your-wallet-domain/.well-known/stellar.toml` with a `SIGNING_KEY` line pointing at your Client Domain Account.
2. Keep the Client Domain Account's secret key on your backend (never ship it to the user).

Per auth request:

1. Pass `client_domain=your-wallet-domain` on the SEP-10 GET.
2. The server adds a third `manage_data` op with `key="client_domain"`, source = your Client Domain Account.
3. After the user signs, your backend adds a second signature from the Client Domain Account.
4. The server returns a JWT containing a verified `"client_domain"` claim.

This is the only way for an anchor to trust "this user came from Wallet X" without trusting Wallet X's word for it.

---

## A minimal end-to-end SEP-1 + SEP-10 (TypeScript-ish)

```ts
import { parse as parseToml } from "@iarna/toml";
import {
  TransactionBuilder, Keypair, Networks, Transaction,
} from "@stellar/stellar-sdk";

async function discoverAndAuth(homeDomain: string, userKeypair: Keypair) {
  // ----- SEP-1 -----
  const tomlText = await fetch(`https://${homeDomain}/.well-known/stellar.toml`).then(r => {
    if (!r.ok) throw new Error(`stellar.toml: ${r.status}`);
    if (Number(r.headers.get("content-length") ?? 0) > 100_000) throw new Error("TOML over 100KB");
    return r.text();
  });
  const toml = parseToml(tomlText) as any;

  const webAuth = toml.WEB_AUTH_ENDPOINT as string;
  const signingKey = toml.SIGNING_KEY as string;
  const passphrase = toml.NETWORK_PASSPHRASE as string;
  if (!webAuth || !signingKey || !passphrase) throw new Error("incomplete stellar.toml");

  // ----- SEP-10 leg 1: GET challenge -----
  const challengeUrl = new URL(webAuth);
  challengeUrl.searchParams.set("account", userKeypair.publicKey());
  challengeUrl.searchParams.set("home_domain", homeDomain);
  const { transaction: challengeXDR, network_passphrase } =
    await fetch(challengeUrl).then(r => r.json());

  // ----- SEP-10 leg 2: verify, then sign -----
  const tx = TransactionBuilder.fromXDR(challengeXDR, network_passphrase ?? passphrase) as Transaction;

  if (tx.sequence !== "0") throw new Error("challenge seq != 0");
  if (!tx.signatures.length || !Keypair.fromPublicKey(signingKey).verify(tx.hash(), tx.signatures[0].signature()))
    throw new Error("challenge not signed by SIGNING_KEY");
  const now = Math.floor(Date.now() / 1000);
  if (Number(tx.timeBounds!.minTime) > now || Number(tx.timeBounds!.maxTime) < now)
    throw new Error("challenge outside time bounds");

  const [first, ...rest] = tx.operations;
  if (first.type !== "manageData" || first.source !== userKeypair.publicKey())
    throw new Error("first op must be manage_data sourced by user account");
  if (first.name !== `${homeDomain} auth`)
    throw new Error(`expected key "${homeDomain} auth", got "${first.name}"`);

  let webAuthDomainOk = false;
  for (const op of rest) {
    if (op.type !== "manageData") throw new Error("non manage_data op");
    if (op.name === "web_auth_domain") {
      const expected = new URL(webAuth).host;
      if (op.value?.toString("utf8") !== expected)
        throw new Error(`web_auth_domain mismatch: ${op.value?.toString("utf8")} vs ${expected}`);
      webAuthDomainOk = true;
    }
    // client_domain op handled in the client_domain flow
  }
  if (new URL(webAuth).host !== homeDomain && !webAuthDomainOk)
    throw new Error("missing/invalid web_auth_domain op");

  tx.sign(userKeypair);

  // ----- SEP-10 leg 3: POST signed -----
  const { token } = await fetch(webAuth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: tx.toXDR() }),
  }).then(r => r.json());

  return { jwt: token, toml };
}
```

Skipped here for length but still required in production: the `client_domain` second-signature path, retries with backoff on 5xx, and the `withFreshJwt` wrapper for downstream calls.

---

## Footguns checklist (specific to SEP-1 + SEP-10)

- **Don't submit the challenge to Horizon.** Sequence number 0 — Horizon rejects it. The signature is for the auth endpoint only.
- **Don't conflate `home_domain` and `web_auth_domain`.** They are different by design when auth is on a separate subdomain. Verify the `web_auth_domain` ManageData op explicitly.
- **Don't trust the challenge without verifying the server signature.** An attacker who can intercept the GET response can substitute their own challenge and harvest the user's signature. The signature check against `SIGNING_KEY` is non-optional.
- **The first ManageData key contains a literal space.** `"example.com auth"`, not `"example.com_auth"` or `"example.com-auth"`. Off-by-one in this string fails the whole flow.
- **Cache the JWT per `(anchor, account)` pair, not globally.** A user with two anchors gets two JWTs; mixing them yields 401s on every call.
- **Don't strip the memo from `sub`.** `G...:1234567` and `G...` are different users to the anchor.
- **Use the TOML's `NETWORK_PASSPHRASE` for signing, not a hard-coded constant.** Cross-wiring testnet and mainnet passphrases is a top reason "the SDK rejects my signature but it looks right."
- **Wrap every authenticated call with transparent re-auth.** JWT expiry is anchor-defined; long sessions will hit it.
- **The anchor must send `Access-Control-Allow-Origin: *`; you can't validate it from browser JS.** A missing/incorrect CORS header surfaces as a thrown `fetch` or an opaque response — not a readable header. Catch the `fetch` rejection and surface it as a likely anchor CORS misconfiguration, not a TOML parsing bug.

Once you have a JWT in hand, hand off to [sep24-interactive.md](sep24-interactive.md) (hosted UI), [sep6-programmatic.md](sep6-programmatic.md) (API only), [sep12-kyc.md](sep12-kyc.md) (KYC), [sep38-quotes.md](sep38-quotes.md) (pricing), or [sep31-cross-border.md](sep31-cross-border.md) (remittance).
