# Testnet deployment

The three contracts are deployed to Stellar **testnet** and initialized. These
are testnet-only deployments; never send real funds to them.

| Contract | Contract ID | Explorer |
|----------|-------------|----------|
| escrow | `CBC4AW7IGPPIVYWASG2QKWZZXBKUSZXQXFS5ZZMAH7YN55DCHKCH65NJ` | https://lab.stellar.org/r/testnet/contract/CBC4AW7IGPPIVYWASG2QKWZZXBKUSZXQXFS5ZZMAH7YN55DCHKCH65NJ |
| dispute | `CAKXHJQHJENFY4UYWH5LAMORP4TE3T223AVHGWRN7T6K2OQUPK7E4BEW` | https://lab.stellar.org/r/testnet/contract/CAKXHJQHJENFY4UYWH5LAMORP4TE3T223AVHGWRN7T6K2OQUPK7E4BEW |
| reputation | `CCHFZMOHTD26BAYF4NQHTXEAHOW66HPK7DRXHUWQDUQBM7OFNJT7UZTP` | https://lab.stellar.org/r/testnet/contract/CCHFZMOHTD26BAYF4NQHTXEAHOW66HPK7DRXHUWQDUQBM7OFNJT7UZTP |

- **Network:** testnet (`Test SDF Network ; September 2015`)
- **Admin / arbitrator:** `GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B`
- **USDC contract:** *not configured* — the demo uses the testnet XLM SAC
  (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) so it can run
  without Circle testnet USDC. Set `USDC_CONTRACT_ID` before deploying to use a
  real USDC SAC.
- The machine-readable record lives in [`../deployments/testnet.json`](../deployments/testnet.json).

## Reproduce the deployment

Prerequisites: `stellar-cli` v25.2.0+ (v28 current) and Rust stable with the
`wasm32v1-none` target.

```bash
rustup target add wasm32v1-none
stellar keys generate deployer --network testnet --fund

# Builds, deploys, initializes all three contracts, and writes
# deployments/testnet.json + frontend/.env
scripts/deploy_testnet.sh
```

## Reproduce the end-to-end flow

```bash
scripts/demo_testnet.sh
```

The demo runs `create → fund → release all milestones → status Completed →
submit rating → get_aggregate`, printing the transaction results. It uses the
testnet XLM SAC by default; pass `TOKEN_CONTRACT_ID=<sac>` to use another asset.

## A note on builds (Soroban SDK v28+)

Soroban SDK v28+ requires:
- the **`wasm32v1-none`** target (not `wasm32-unknown-unknown`), and
- building via **`stellar contract build`** (the SDK build script refuses a
  plain `cargo build` for the wasm target).

Wasm artifacts land in `contracts/target/wasm32v1-none/release/`.
