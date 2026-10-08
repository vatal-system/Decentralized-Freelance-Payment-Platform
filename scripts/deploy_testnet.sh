#!/usr/bin/env bash
#
# Deploy the three Soroban contracts to Stellar testnet and initialize them.
#
# Usage:
#   scripts/deploy_testnet.sh
#
# Environment variables (all optional):
#   NETWORK   – stellar network name (default: testnet)
#   IDENTITY  – stellar-cli identity/secret name (default: deployer)
#   USDC_CONTRACT_ID
#             – Stellar Asset Contract id for USDC on the target network.
#               If unset, deployment still runs but the frontend .env will not
#               get a USDC address. See docs/TESTNET.md for how to obtain it.
#
# Requirements:
#   - stellar-cli v25.2.0+  (v28 is current)
#   - a funded testnet identity:  stellar keys generate deployer --network testnet --fund
#
# This script never handles real funds and only targets testnet by default.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
WASM_DIR="$CONTRACTS_DIR/target/wasm32v1-none/release"
DEPLOYMENTS_DIR="$REPO_ROOT/deployments"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-deployer}"
USDC_CONTRACT_ID="${USDC_CONTRACT_ID:-}"

command -v stellar >/dev/null || {
  echo "error: stellar-cli not found. Install v25.2.0+ from https://github.com/stellar/stellar-cli/releases" >&2
  exit 1
}

echo "==> Building contracts"
(cd "$CONTRACTS_DIR" && stellar contract build)

ADMIN="$(stellar keys address "$IDENTITY")"
echo "==> Deployer/admin address: $ADMIN"
echo "==> Network: $NETWORK"

# Extract the contract id (C...) from stellar-cli output.
deploy() {
  local wasm="$1"
  local out
  out="$(stellar contract deploy --wasm "$wasm" --source "$IDENTITY" --network "$NETWORK")"
  echo "$out" | grep -oE 'C[A-Z2-7]{55}' | tail -1
}

echo "==> Deploying escrow"
ESCROW_CONTRACT_ID="$(deploy "$WASM_DIR/escrow.wasm")"
echo "    escrow:     $ESCROW_CONTRACT_ID"

echo "==> Deploying dispute"
DISPUTE_CONTRACT_ID="$(deploy "$WASM_DIR/dispute.wasm")"
echo "    dispute:    $DISPUTE_CONTRACT_ID"

echo "==> Deploying reputation"
REPUTATION_CONTRACT_ID="$(deploy "$WASM_DIR/reputation.wasm")"
echo "    reputation: $REPUTATION_CONTRACT_ID"

invoke() {
  local id="$1"; shift
  stellar contract invoke --id "$id" --source "$IDENTITY" --network "$NETWORK" -- "$@"
}

echo "==> Initializing contracts"
# escrow is told which dispute contract is allowed to call resolve().
invoke "$ESCROW_CONTRACT_ID" init --admin "$ADMIN" --dispute_contract "$DISPUTE_CONTRACT_ID"
# dispute knows its arbitrator panel and M-of-N threshold.
invoke "$DISPUTE_CONTRACT_ID" init --arbitrators "[\"$ADMIN\"]" --threshold 1
# reputation verifies completions against the escrow contract.
invoke "$REPUTATION_CONTRACT_ID" init --admin "$ADMIN" --escrow_contract "$ESCROW_CONTRACT_ID"

mkdir -p "$DEPLOYMENTS_DIR"
cat > "$DEPLOYMENTS_DIR/testnet.json" <<JSON
{
  "network": "$NETWORK",
  "admin": "$ADMIN",
  "escrow_contract_id": "$ESCROW_CONTRACT_ID",
  "dispute_contract_id": "$DISPUTE_CONTRACT_ID",
  "reputation_contract_id": "$REPUTATION_CONTRACT_ID",
  "usdc_contract_id": "$USDC_CONTRACT_ID"
}
JSON

echo "==> Wrote $DEPLOYMENTS_DIR/testnet.json"

# Best-effort: write the frontend env file if it does not exist yet.
FE_ENV="$REPO_ROOT/frontend/.env"
if [ ! -f "$FE_ENV" ]; then
  cat > "$FE_ENV" <<ENV
VITE_NETWORK=$NETWORK
VITE_ESCROW_CONTRACT_ID=$ESCROW_CONTRACT_ID
VITE_DISPUTE_CONTRACT_ID=$DISPUTE_CONTRACT_ID
VITE_REPUTATION_CONTRACT_ID=$REPUTATION_CONTRACT_ID
VITE_USDC_CONTRACT_ID=$USDC_CONTRACT_ID
ENV
  echo "==> Wrote $FE_ENV"
else
  echo "==> $FE_ENV already exists, leaving it untouched"
fi

echo "==> Done."
