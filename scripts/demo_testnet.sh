#!/usr/bin/env bash
#
# End-to-end demo on testnet: create a job, fund it, release a milestone, and
# rate the counterparty. Reproduces the flow the frontend performs.
#
# Usage:
#   scripts/deploy_testnet.sh          # once, to deploy + initialize
#   scripts/demo_testnet.sh            # then run the demo
#
# Environment variables:
#   NETWORK           – stellar network (default: testnet)
#   IDENTITY          – funded identity used as the client (default: deployer)
#   FREELANCER        – public key of the freelancer (default: a generated identity)
#   TOKEN_CONTRACT_ID – SAC to pay with. Defaults to the testnet XLM SAC so the
#                       demo runs without needing Circle testnet USDC.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYMENTS="$REPO_ROOT/deployments/testnet.json"

NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-deployer}"
FREELANCER_IDENTITY="${FREELANCER_IDENTITY:-freelancer}"

[ -f "$DEPLOYMENTS" ] || {
  echo "error: $DEPLOYMENTS not found. Run scripts/deploy_testnet.sh first." >&2
  exit 1
}

json() { grep -oE "\"$1\": *\"[^\"]*\"" "$DEPLOYMENTS" | sed -E 's/.*: *"([^"]*)"/\1/'; }

ESCROW="$(json escrow_contract_id)"
DISPUTE="$(json dispute_contract_id)"
REPUTATION="$(json reputation_contract_id)"
CONTRACT_USDC="$(json usdc_contract_id)"

CLIENT="$(stellar keys address "$IDENTITY")"

if ! stellar keys address "$FREELANCER_IDENTITY" >/dev/null 2>&1; then
  echo "==> Generating + funding freelancer identity '$FREELANCER_IDENTITY'"
  stellar keys generate "$FREELANCER_IDENTITY" --network "$NETWORK" --fund
fi
FREELANCER="$(stellar keys address "$FREELANCER_IDENTITY")"

TOKEN="${TOKEN_CONTRACT_ID:-$CONTRACT_USDC}"
if [ -z "$TOKEN" ]; then
  TOKEN="$(stellar contract id asset --asset native --network "$NETWORK")"
  echo "==> No USDC configured; using testnet XLM SAC: $TOKEN"
fi

EXPIRY=$(( $(date +%s) + 3600 ))
# 1 XLM / 0.1 XLM in stroops, as a Vec<Milestone> JSON argument.
# Amount (i128) is encoded as a string; deadline (u64) as a number.
MILESTONES='[{"amount":"10000000","deadline":0,"released":false,"released_amount":"0"},{"amount":"1000000","deadline":0,"released":false,"released_amount":"0"}]'

invoke() { stellar contract invoke --id "$1" --source "$IDENTITY" --network "$NETWORK" -- "${@:2}"; }

echo "==> create"
ESCROW_ID="$(invoke "$ESCROW" create \
  --client "$CLIENT" \
  --freelancer "$FREELANCER" \
  --token "$TOKEN" \
  --milestones "$MILESTONES" \
  --expiry "$EXPIRY" | tail -1)"
echo "    escrow id: $ESCROW_ID"

echo "==> fund"
invoke "$ESCROW" fund --escrow_id "$ESCROW_ID"

echo "==> release all milestones"
invoke "$ESCROW" release_milestone --escrow_id "$ESCROW_ID" --milestone_index 0
invoke "$ESCROW" release_milestone --escrow_id "$ESCROW_ID" --milestone_index 1

echo "==> get (expect status Completed)"
invoke "$ESCROW" get --escrow_id "$ESCROW_ID"

echo "==> rate the freelancer"
invoke "$REPUTATION" submit \
  --rater "$CLIENT" \
  --ratee "$FREELANCER" \
  --escrow_id "$ESCROW_ID" \
  --score 5

echo "==> freelancer reputation"
invoke "$REPUTATION" get_aggregate --address "$FREELANCER"

echo "==> Done. Dispute contract for reference: $DISPUTE"
