# Security Policy

## Supported versions

The project is **pre-1.0 and unaudited**. Only the `main` branch is supported.

## Scope

The contracts are **testnet-only**. They have not been audited and must not be
deployed to mainnet or used to hold real funds. Reports about the following are
in scope:

- `contracts/escrow`, `contracts/dispute`, `contracts/reputation`,
  `contracts/interface`
- Authorization, fund-distribution, or state-machine flaws
- Storage/TTL issues that could strand funds or state
- The frontend transaction pipeline (`frontend/src/lib/stellar.ts`,
  `frontend/src/hooks`)
- The backend API (`backend/src`)

Out of scope:

- Issues that require mainnet deployment or real funds
- Third-party dependencies (please report upstream)
- Denial of service via expensive-but-authorized calls on testnet

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report privately through GitHub's
[security advisories](https://github.com/vatal-system/Decentralized-Freelance-Payment-Platform/security/advisories/new)
or by contacting the maintainers directly.

Please include:

- A description of the issue and its impact
- Steps to reproduce (a failing test is ideal)
- Any suggested fix

We will acknowledge the report and work on a fix before public disclosure. Please
give us reasonable time before disclosing publicly.

## Known limitations (not vulnerabilities to report)

These are documented, intentional gaps tracked as issues:

- A single trusted arbitrator, set at initialization; no multi-arbitrator panel.
- A `Disputed` escrow has no timeout escape — only the arbitrator can resolve it.
- The backend event indexer is a stub; the database does not sync from chain.
- USDC is not yet configured on testnet (the demo uses the XLM SAC).
