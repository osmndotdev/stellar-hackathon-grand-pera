# Project: Stellar Anchor Integration Skill

## What we're building

A community Agent Skill for https://skills.stellar.org/ that teaches AI coding agents how to integrate with — and build — Stellar anchors (fiat on/off-ramps). It will be submitted as a community skill alongside OpenZeppelin Contracts, DeFindex SDK, Soroswap SDK, and Trustless Work Escrow.

**Positioning:** The official `standards` skill routes developers to SEP specs. This skill is the *implementation layer* — "standards tells you which SEP; this skill tells you how to actually ship it without the failure modes."

## Key research findings (from prior exploration session)

- Skill format follows the Agent Skills standard (https://agentskills.io): YAML frontmatter (`name`, `description`, `license`, `compatibility`, `metadata`) + markdown body.
- The strongest community example to model is **Trustless Work** (`Trustless-Work/trustless-work-dev-skill`). Its winning patterns:
  - A **"Gotchas" section** of non-obvious facts agents get wrong without being told (their differentiator).
  - A router SKILL.md that maps tasks → on-demand reference files ("Load these only when the task requires them").
  - Frontmatter `description` written for *triggering*: lists user phrasings that should activate the skill, "even if they don't explicitly mention X."
  - Install via `npx skills add <org>/<repo>` and listing on skills.sh.
- The official repo (`stellar/stellar-dev-skill`) powers the site, was itself AI-generated with Claude Code, welcomes PRs/issues, and has no CONTRIBUTING.md — submission path is an issue/PR proposing the community card.
- Official skills already cover: Soroban, dApp/frontend, assets/SAC, RPC/Horizon data, agentic payments (x402+MPP), ZK proofs, SEPs/CAPs. Anchor *implementation* is uncovered — confirmed gap.

## Architecture decision (made)

Cover BOTH sides of anchor integration, client side as the front door:

- **Side A — Integrating with anchors** (wallet/app devs; larger audience): SEP-1 discovery, SEP-10 auth, SEP-24 interactive, SEP-6 programmatic, SEP-12 KYC, SEP-38 quotes, SEP-31 cross-border.
- **Side B — Building an anchor** (fintechs): SDF Anchor Platform (java-stellar-anchor-sdk) deployment, business server callbacks, custody, payment observation.

Router + on-demand reference files keeps context lean despite the broad scope.

## Planned repo structure

```
stellar-anchor-skill/
├── SKILL.md                      # Router: frontmatter, when-to-use, GOTCHAS, quick start, file map
└── references/
    ├── client/
    │   ├── discovery-and-auth.md     # SEP-1 stellar.toml parsing + SEP-10 challenge flow
    │   ├── sep24-interactive.md      # Hosted deposit/withdraw, popup handling, status polling
    │   ├── sep6-programmatic.md      # API-first flows; when to prefer over SEP-24
    │   ├── sep12-kyc.md              # SEP-9 fields, PUT /customer, customer statuses
    │   ├── sep38-quotes.md           # Firm vs indicative quotes, expiry/re-quote loop
    │   └── sep31-cross-border.md     # Sending/receiving anchors, corridors
    ├── server/
    │   ├── anchor-platform-setup.md  # Docker compose, config, testnet vs mainnet
    │   ├── business-server.md        # Callbacks, RFQ integration, custody, payment observation
    │   └── production-checklist.md   # Custody, rate limits, compliance touchpoints
    └── testing/
        └── testing-and-validation.md # testanchor.stellar.org, Demo Wallet, @stellar/anchor-tests
```

## Seed gotchas (VERIFY each against current specs/behavior before shipping)

1. SEP-10 challenge transaction has sequence number 0 and must NEVER be submitted to the network — sign it and POST it back to the auth endpoint only.
2. `home_domain` ≠ `web_auth_domain` — most common SEP-10 failure when auth is served from a different subdomain; JWT validation breaks silently if conflated.
3. SEP-24 interactive URL must open in popup/webview, NOT iframe (anchors send X-Frame-Options: DENY); completion signal arrives via postMessage.
4. Withdrawals to shared custodial anchor accounts require exact `memo`/`memo_type` from the withdraw response — omitting it strands funds.
5. User needs a trustline before the anchor can send a deposit, unless `claimable_balance_supported: true`.
6. All amounts are strings; `asset_code` alone is ambiguous — always pair with `asset_issuer`.
7. Transaction status is a state machine, not a boolean: `incomplete` → `pending_user_transfer_start` → `pending_external` → `completed`, with branches like `pending_customer_info_update` requiring KYC re-engagement. Map every status to a required app action.
8. SEP-38 firm quotes expire; expired `quote_id` in SEP-6/31 requests fails — implement a re-quote loop.
9. `stellar.toml` must be served over HTTPS at `/.well-known/stellar.toml` with CORS enabled.
10. SEP-10 JWTs are short-lived; long KYC sessions need mid-flow re-authentication handling.

## Differentiator: agentic validation loop

No existing community skill includes one. The testing reference file should instruct the agent to self-verify:
- SDF demo anchor: `testanchor.stellar.org`
- Stellar Demo Wallet for manual flow exercise: `demo-wallet.stellar.org`
- Automated compliance: `@stellar/anchor-tests` CLI, e.g. `stellar-anchor-tests --home-domain <domain> --seps 1 10 24` — implement, run, fix failures.

## Launch plan

1. Build repo per structure above; description frontmatter must include trigger phrases: "fiat on-ramp", "off-ramp", "deposit/withdrawal", "cash-in/cash-out", "Circle integration", "anchor", not just SEP numbers.
2. Make installable: `npx skills add <org>/stellar-anchor-skill` + Claude Code plugin marketplace pattern.
3. Self-test: fresh Claude Code session + this skill → build a SEP-24 deposit flow against testanchor from scratch; every stumble = missing gotcha.
4. Submit: issue/PR to `stellar/stellar-dev-skill` proposing the community card; propose cross-links with the official `standards` skill in both directions; post in Stellar Developers Discord; list on skills.sh.

## Key references

- Skill directory: https://skills.stellar.org/
- Official skill repo: https://github.com/stellar/stellar-dev-skill
- Model community skill: https://github.com/Trustless-Work/trustless-work-dev-skill
- Anchor Platform docs: https://developers.stellar.org/docs/category/anchor-platform
- Anchor fundamentals: https://developers.stellar.org/docs/learn/fundamentals/anchors
- SEPs: https://github.com/stellar/stellar-protocol/tree/master/ecosystem (0001, 0006, 0009, 0010, 0012, 0024, 0031, 0038)
- Anchor test suite: https://github.com/stellar/stellar-anchor-tests

## Immediate next steps

1. Scaffold the repo (folders + SKILL.md frontmatter and router skeleton).
2. Draft `references/client/sep24-interactive.md` first (highest-traffic flow), grounded in the current SEP-24 spec — fetch it, don't rely on memory.
3. Verify each seed gotcha against current specs and testanchor behavior; expand the list while drafting.
4. Draft `discovery-and-auth.md` (SEP-1 + SEP-10), then the testing file, then remaining client files, then server side.

## Working agreements

- Ground every reference file in the current spec text (fetch SEPs from the stellar-protocol repo) — specs change; never assert status from memory.
- Gotchas must be concrete and falsifiable, in the Trustless Work style ("X is a string, not a number"), not generic advice.
- Each reference file is self-contained; the router decides what gets loaded.