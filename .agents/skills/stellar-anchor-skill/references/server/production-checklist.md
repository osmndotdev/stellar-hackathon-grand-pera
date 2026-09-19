# Production Checklist

The pre-launch checklist for an anchor going live on mainnet. Treat this as a gate: every item is "we can prove this works" before the first real user touches the integration.

This file complements [anchor-platform-setup.md](anchor-platform-setup.md) (which gets you running) and [business-server.md](business-server.md) (which gets the domain logic right). Production adds compliance, custody, monitoring, and incident response.

---

## 1. Compliance and pre-launch gates

These are external to the code and almost always longer-lead than engineering thinks.

- **Licensing.** Money transmitter / VASP / EMI license appropriate for every jurisdiction you accept users from. The anchor IS a regulated entity — running one without the license is the kind of "move fast" that ends in injunctions.
- **AML/KYC vendor live.** Sumsub, Jumio, Persona, ComplyCube, Onfido — pick one and have it actually wired into your SEP-12 `PUT /customer` handler, not stubbed. Run 50 real-document submissions through it before launch.
- **Sanctions and PEP screening on every customer**, on every transaction over the applicable threshold, with rescreening on a schedule (most regulators require continuous monitoring, not just at onboarding). Treasury & banking partners will ask for evidence — keep the logs.
- **Travel Rule integration** if you're sending or receiving from other regulated counterparties at amounts above your jurisdiction's threshold (currently typically $1,000 USD equivalent in the US, €1,000 in the EU). Sumsub Travel, Notabene, TRP — one of them, live.
- **Privacy posture.** GDPR / CCPA / LGPD / local equivalent. Implement `DELETE /customer/{account}` (SEP-12). Document data retention. Have a path to surface and export a customer's record for subject access requests.
- **Terms of service and customer agreement.** Reviewed by counsel, surfaced before SEP-10 auth on first use.
- **Incident response plan written, tested.** "Funds stranded with wrong memo" and "key compromise" need playbooks BEFORE they happen.

---

## 2. Custody — the part that ends careers if you get it wrong

Custody is the single highest-stakes part of an anchor. Slow rate updates lose customers a percent or two; a hot-wallet drain ends the company.

### Key separation, minimum

| Role | Account | Signers | Daily limit |
|---|---|---|---|
| **SEP-10 signing** | Stellar account that signs auth challenges | One backend secret in env / HSM | N/A (signs nothing on-chain) |
| **Hot distribution** | Holds working capital for the next ~24h of payouts | Fireblocks / custody-server-owned | A small % of total reserve |
| **Warm refill** | Refills the hot account daily | Multisig (≥2 of 3), one human approver | A larger % of total reserve |
| **Cold reserve** | The bulk of the asset reserve | Multisig (≥3 of 5), offline keys, human approval | None — manual only |

The SEP-10 signing key is NOT the distribution key. Compromise of SEP-10 = users can't authenticate until rotated; compromise of the hot distribution key = drain. Different threat models, different storage.

### Custody integration choices

- **Fireblocks / Cobo / Anchorage** — managed custody, HSM-backed, audit trail, supports Stellar natively. The standard production answer.
- **Custody server with HSM** — the platform's bundled custody-server component fronted by AWS CloudHSM or an on-prem HSM. Works; more operational burden.
- **Self-custody with raw keys in env** — DO NOT do this on mainnet. Yes, even with the secret manager. The auditors will not be amused.

### Reserve sizing

- Hot account holds *at most* enough for expected payouts in the refill window (typically 24h).
- Cold reserve covers 100% of the issued asset (you're a 1:1 anchor — you owe every IOU back).
- Treasury bank account holds the fiat counterpart of every issued cent, at a real bank, named, segregated where the regulator requires it.

### Reconciliation

A daily job that proves:

```
on-chain issued supply  ==  off-chain fiat held in segregated treasury accounts
                        ==  sum(completed_deposits) - sum(completed_withdrawals)
```

If these three diverge by more than rounding, **stop accepting new deposits and find out why before resuming**. Most fraud and most software bugs first show up here.

---

## 3. Rate limiting and abuse

Anchors are attack targets — both for fund theft and for cheap denial of service.

- **SEP-10 `GET /auth`** is the cheapest target: returns a server-signed transaction with a random nonce. Rate limit per IP and per account. The spec itself notes anchors should rate-limit.
- **SEP-24 `POST /transactions/*/interactive`** is more expensive (it creates a DB row and sometimes an interactive session). Rate limit harder — per-account, per-hour, with backoff.
- **`PUT /customer` (SEP-12)** triggers your KYC vendor (which costs money per submission). Rate limit aggressively, especially on re-submissions for the same account.
- **SEP-38 `POST /quote`** reserves capacity. Per the spec, quotes hold inventory — an abuser can request thousands of quotes to deplete your hedging capacity. Rate limit AND cap concurrent open quotes per account.

Layered: CDN/WAF (Cloudflare or equivalent) catches bots; the SEP server enforces per-account limits; alerting catches anomalies (a single account opening 100 quotes in 60 seconds is suspicious whatever your nominal rate limit).

---

## 4. Monitoring and alerting

If you find out about a stuck transaction from a user support ticket, monitoring failed.

### Transaction state-machine stall alerts

Alert when any transaction spends longer than expected in a pending state:

| Status | Sane upper bound | Means |
|---|---|---|
| `incomplete` | 1 hour | User abandoned, or your business server didn't PATCH a deposit address back. |
| `pending_user_transfer_start` (withdrawal) | 30 min | User hasn't sent the Stellar payment; remind, then expire. |
| `pending_user_transfer_complete` | 5 min | Your custody layer should be paying out; alert if it doesn't. |
| `pending_external` | 1 hour (faster rails) – 1 business day (SWIFT) | Your bank integration is stuck or slow. |
| `pending_anchor` | 5 min | Your business server is stuck on a callback. |
| `pending_stellar` | 1 minute | Horizon is congested or you under-feed; check `network_base_fee`. |
| `pending_trust` | 10 min | User hasn't created a trustline; remind. |

### Other must-haves

- **Custody balance vs. expected.** Alert if hot account drops below 24h projected payouts (refill triggered).
- **SEP server p95 latency.** Spikes hide compromise attempts or under-provisioned DB.
- **Kafka consumer lag.** Your business server's event consumer must keep up; lag = stuck wallets.
- **Anchor-test compliance suite** run on a schedule against production (with a synthetic test account). A regression in production breaks compliance silently otherwise.
- **JWT minting volume.** Sudden 10× growth is either viral growth or credential stuffing — neither is harmless.
- **Failed-signature counter on SEP-10.** Steady-state should be near zero; a sustained spike is an attack.

---

## 5. Networking and TLS

- **`stellar.toml` MUST be over HTTPS** with a valid certificate, served with `Access-Control-Allow-Origin: *` and `Content-Type: text/plain`. Cloudflare-fronted is fine; verify the upstream isn't HTTP-only.
- **Every SEP endpoint MUST be over HTTPS** — TLS 1.2 minimum, prefer 1.3, modern cipher suites only.
- **Reverse proxy host header** must match what the SEP server believes its hostname is, otherwise SEP-10's `web_auth_domain` ManageData op uses the wrong value and wallets reject every JWT.
- **CORS on every SEP endpoint** (not just `stellar.toml`). Spec says `Access-Control-Allow-Origin: *`. Some setups forget this on `POST /transactions/...` and browser wallets break with opaque-response errors.

---

## 6. Secrets and key rotation

- **All secrets in a secret manager** (AWS Secrets Manager, GCP Secret Manager, Vault). Not in env files in git.
- **SEP-10 signing key rotation procedure** documented and rehearsed. Update `SECRET_SEP10_SIGNING_SEED`, update the `SIGNING_KEY` in `stellar.toml`, deploy in lockstep. Old JWTs continue to verify until expiry; this is a graceful rotation.
- **JWT signing secret rotation**: dual-key support so old tokens keep verifying for one TTL window after rotation.
- **Database credentials** rotated on a schedule.
- **Fireblocks API keys** scoped to the workspaces you actually need; rotate annually.

---

## 7. Stranded-funds runbook

The single most common ops incident: a user sent a withdrawal with the wrong memo, or sent the wrong asset, or sent to your account before completing KYC. Funds are in your custody but unattributed.

Document:

1. **How to find the orphan Stellar payment.** Horizon stream, filtered by your distribution account, no matching SEP-24/6 transaction record.
2. **Who has authority to refund** (compliance lead + treasury, both must sign off).
3. **The refund procedure.** Almost always: send the asset back to the source `account` with the original memo. If `refund_memo` was provided on the original request, honor it.
4. **The reconciliation entry.** A refund is an accounting event — make sure your books reflect it.
5. **The user comms template.** "We received a payment without the required memo. We've refunded it to <account>. Here's how to redo your withdrawal."

Test the runbook on testnet at least once. The first time you exercise it should not be in production.

---

## 8. Going-live gate

A short list — every item must be checkable as "done":

- [ ] License in hand for every jurisdiction the anchor accepts.
- [ ] `stellar-anchor-tests` passes every SEP you've enabled, against your production endpoint.
- [ ] Demo Wallet completes a real deposit and a real withdrawal end-to-end through production.
- [ ] Custody integration live (Fireblocks / custody-server), with a successful test payout.
- [ ] Daily reconciliation job running and green for 7 consecutive days.
- [ ] Alerting wired to a pager (PagerDuty / Opsgenie), tested.
- [ ] Stranded-funds runbook tested on testnet.
- [ ] KYC vendor processed 50+ real submissions and rejected at least one (proves the reject path works).
- [ ] Travel Rule integration tested against a counterparty.
- [ ] Cold reserve at 100% of issued supply.
- [ ] On-call rotation documented, with explicit business-hour vs out-of-hour escalation paths.

---

## 9. After launch

Three things to keep doing:

- **Re-run the SEP compliance suite weekly.** Spec drift breaks integrations silently.
- **Reconcile daily.** One off-by-one bug in the off-chain payout pipeline accumulates fast.
- **Re-read SEP changelogs every release.** When SEP-24 deprecated `amount_fee` in favor of `fee_details`, anchors that didn't update started failing the latest wallet integrations months before they noticed.
