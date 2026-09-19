# Stellar Anchor Skill

> Teach your AI coding agent how to integrate with — and build — Stellar anchors (fiat on/off-ramps).

[View com skills.sh](https://www.skills.sh/cheesecakelabs/stellar-anchor-skill)

A community Agent Skill for [skills.stellar.org](https://skills.stellar.org). Drop it into Claude Code (or any Agent-Skills-compatible runtime), and asks like *"build a USDC deposit flow against Circle"* or *"stand up an Anchor Platform for our remittance corridor"* route to grounded, spec-current implementation guidance instead of half-remembered SEP details.

The official [`stellar/standards`](https://github.com/stellar/stellar-dev-skill/blob/main/skills/standards/SKILL.md) skill points to **which** SEP to read. This skill tells you **how** to actually ship it.

---

## What's inside

A router (`SKILL.md`) plus on-demand reference files. The router decides what loads; nothing gets pulled into context unless the task needs it.

```
stellar-anchor-skill/
├── SKILL.md                                    # router + 13 gotchas + file map
└── references/
    ├── client/                                 # integrating with someone else's anchor
    │   ├── discovery-and-auth.md               # SEP-1 stellar.toml + SEP-10 web auth
    │   ├── sep24-interactive.md                # Hosted UI deposit/withdraw
    │   ├── sep6-programmatic.md                # API-only deposit/withdraw
    │   ├── sep12-kyc.md                        # KYC + SEP-9 field vocabulary
    │   ├── sep38-quotes.md                     # Indicative + firm quotes
    │   └── sep31-cross-border.md               # Anchor-to-anchor remittance
    ├── server/                                 # building an anchor
    │   ├── anchor-platform-setup.md            # SDF Anchor Platform on Docker
    │   ├── business-server.md                  # Callbacks, Platform API, Kafka events
    │   └── production-checklist.md             # Custody, compliance, monitoring, runbooks
    └── testing/
        └── testing-and-validation.md           # testanchor + Demo Wallet + @stellar/anchor-tests
```

---

## What makes this skill different

- **13 hard-won gotchas, every one falsifiable.** Every claim was verified against the live SEP text and `testanchor.stellar.org` behavior. Things like *"the SEP-10 challenge has sequence number 0 and must never be submitted to the network,"* *"the `home_domain` ≠ `web_auth_domain` whenever auth is on a subdomain,"* *"persisted amounts come back as strings, not numbers,"* *"the TOML `SIGNING_KEY` verifies more than just SEP-10."* All in [SKILL.md](SKILL.md).
- **An agentic validation loop.** Every reference file points at [testing-and-validation.md](references/testing/testing-and-validation.md), which prescribes the loop: implement → run `@stellar/anchor-tests` → read the failure → fix the root cause → re-run. Your code isn't done when it compiles; it's done when the SDF compliance suite is green.
- **Both sides of the integration.** Wallet/app developers (most common) and fintechs building the anchor. The router asks which side before loading files.
- **Self-tested against the empty room.** The skill has been driven by a fresh agent given nothing else — every place that agent stumbled became an edit.

---

## Installation

### Install this skill using:

```bash
npx skills add CheesecakeLabs/stellar-anchor-skill
```

### Manual

Clone into your project's `.claude/skills/` directory (or the equivalent location your runtime reads):

```bash
git clone https://github.com/CheesecakeLabs/stellar-anchor-skill.git \
  ~/.claude/skills/stellar-anchor
```

The skill activates from `SKILL.md` — no build step, no dependencies.

---

## Triggering the skill

The skill's `description:` frontmatter is tuned for natural-language triggers. You don't have to name SEP numbers; any of these will route to it:

| What you ask the agent | What loads |
|---|---|
| *"Build a USDC deposit from a bank against Vibrant"* | `discovery-and-auth.md` + `sep24-interactive.md` |
| *"Connect our wallet to Vibrant for cash-out"* | `discovery-and-auth.md` + `sep24-interactive.md` |
| *"Set up programmatic deposits against an anchor for our backend"* | `discovery-and-auth.md` + `sep6-programmatic.md` + `sep12-kyc.md` |
| *"Show me the firm-quote / RFQ pattern for non-1:1 conversions"* | `sep38-quotes.md` |
| *"We're a remittance platform sending from US to Mexico"* | `discovery-and-auth.md` + `sep31-cross-border.md` + `sep12-kyc.md` + `sep38-quotes.md` |
| *"Stand up the Anchor Platform locally"* | `anchor-platform-setup.md` + `business-server.md` |
| *"Pre-launch checklist for our new anchor"* | `production-checklist.md` |
| *"Validate our SEP-24 implementation against the compliance suite"* | `testing-and-validation.md` |

The skill itself reads the request, picks the right files, and only loads those.

---

## Usage examples

### Example 1 — A retail wallet building its first deposit flow

```
You: I'm building a Stellar wallet. We want to let users deposit USDC against
     testanchor.stellar.org so we can test against a real anchor before
     wiring up Circle for production. TypeScript, using @stellar/stellar-sdk.

Agent: [loads SKILL.md → reads the 13 gotchas → loads discovery-and-auth.md
        → loads sep24-interactive.md → writes the implementation]

       Produces a working file that:
       - Fetches stellar.toml, parses it, validates CORS + HTTPS
       - Runs the SEP-10 three-leg handshake including ALL 7 client-side
         verification checks (sequence == 0, server signature, time bounds,
         first ManageData op shape, web_auth_domain match, …)
       - Wraps every later call in a 401-retry SEP-10 re-auth
       - POSTs the deposit, opens the popup in a popup window (NOT iframe),
         registers postMessage before opening
       - Polls /transaction, handles the FULL status state machine including
         pending_trust (with concrete ChangeTrust code) and pending_user
       - Tells you to run `npx stellar-anchor-tests --home-domain
         testanchor.stellar.org --seps 1 10 24 --asset-code SRT` before
         calling the integration done
```

### Example 2 — A fintech standing up an anchor

```
You: We're getting our money-transmitter license and need to ship an anchor
     for USDC on/off-ramp in Brazil. What's the path from zero to live?

Agent: [loads SKILL.md → asks: client or server side? → user says server
        → loads anchor-platform-setup.md + business-server.md
        + production-checklist.md]

       Walks you through:
       - quick-run docker-compose to get the SDF Anchor Platform running on testnet
       - assets.yaml, clients.yaml, stellar.localhost.toml, dev.env mapping
       - The three integration surfaces (callbacks, Platform API, Kafka events)
         and what your business server owes for each
       - Custody options (Fireblocks vs custody-server vs raw keys — and why
         not the last one)
       - The going-live gate checklist: licensing, AML/KYC vendor live,
         Travel Rule, reconciliation, stranded-funds runbook, daily reserve
         vs. issued supply check
```

### Example 3 — A team auditing an existing integration

```
You: Our SEP-24 deposit flow has been intermittent for weeks. Customers
     report stuck transactions but our /transaction polling shows nothing
     wrong. What are we missing?

Agent: [loads SKILL.md → 13 gotchas section first]

       Surfaces likely causes from the gotchas section, in order:
       - Are you handling pending_trust by submitting a ChangeTrust op
         (deposit-side, easy to miss)?
       - Are you handling pending_user (user has homework, re-open the URL)?
       - Are you treating amount_in / amount_out as strings (parseFloat
         silently loses precision)?
       - Are you re-running SEP-10 transparently on 401 from /transaction
         (JWT TTL is anchor-defined and a SEP-24 session WILL outlive a
         short token)?
       - Have you run `@stellar/anchor-tests` against your endpoint lately?
         A regression in production is otherwise silent.
```

---

## Spec ground truth

The skill never asserts SEP behavior from memory. Every reference file links the live spec text:

- [SEP-1 `stellar.toml`](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
- [SEP-6 Programmatic Deposit/Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0006.md)
- [SEP-9 Standard KYC Fields](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0009.md)
- [SEP-10 Web Authentication](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md)
- [SEP-12 KYC API](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0012.md)
- [SEP-24 Hosted Deposit/Withdrawal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md)
- [SEP-31 Cross-Border Payments](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0031.md)
- [SEP-38 Anchor RFQ API](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md)

Plus:

- [Anchor Platform admin guide](https://developers.stellar.org/docs/platforms/anchor-platform/admin-guide)
- [Anchor Platform repo](https://github.com/stellar/anchor-platform)
- [`@stellar/anchor-tests` compliance suite](https://github.com/stellar/stellar-anchor-tests)
- [SDF test anchor](https://testanchor.stellar.org)
- [Stellar Demo Wallet](https://demo-wallet.stellar.org)

---

## Contributing

Spec drift is the enemy of this skill. PRs especially welcome for:

- A gotcha that turns out stale because a SEP was revised — fix it, cite the change.
- A new gotcha you hit in production that the skill didn't warn you about.
- An anchor's real-world behavior that differs from the spec text in a way wallets must handle (e.g., `claimable_balance_supported` cited but not honored).
- Spec changes upstream — any SEP, any version bump.

Open an issue with the offending file path and the contradiction; PRs welcome directly.

---

## Related skills

- [`stellar/standards`](https://github.com/stellar/stellar-dev-skill/blob/main/skills/standards/SKILL.md) — the official skill that routes to SEP specs (this skill picks up where that one leaves off).
- [`stellar/soroban`](https://github.com/stellar/stellar-dev-skill/blob/main/skills/soroban/SKILL.md) — Soroban smart contracts.
- [`stellar/dapp-frontend`](https://github.com/stellar/stellar-dev-skill/blob/main/skills/dapp/SKILL.md) — wallet/frontend integration patterns.

---

## License

Apache-2.0. See [LICENSE](LICENSE).
