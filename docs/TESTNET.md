# Testnet Guide

This document provides quick reference information for developers working with the **Stellar Testnet** environment, covering two essential topics:

1. **Funding accounts via the Testnet Faucet**
2. **Deploying a mock USDC token contract**

---

## 1. Faucet Funding

The Stellar Testnet includes a public faucet (also known as *Friendbot*) that instantly funds any account with a modest amount of XLM. This is useful for testing escrow, dispute, and reputation flows that require a funded source account.

### How to fund an account

```bash
# Replace <PUBLIC_KEY> with the Stellar address you want to fund
curl "https://friendbot.stellar.org?addr=<PUBLIC_KEY>"
```

The response will be a JSON payload containing the transaction envelope that was submitted to the network. The account will receive **10 000 XLM** (the default amount provided by Friendbot).

### Programmatic usage (TypeScript)

```ts
import fetch from "node-fetch";

export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const resp = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Friendbot failed: ${err}`);
  }
  // The transaction is already submitted; no further action required.
}
```

> **Note**: The faucet is only available on the public testnet. When running against a private Soroban testnet, you must use the network‑specific funding mechanism provided by that deployment.

---

## 2. Mock USDC Deployment

For integration tests that require a stablecoin, a lightweight mock USDC contract is provided in the repository under `contracts/mock_usdc`. The contract implements the essential `transfer`, `balance_of`, and `allowance` entry points required by the escrow and dispute contracts.

### Deploying the mock USDC contract

```bash
# Ensure soroban-cli is installed and configured for the testnet
soroban contract deploy \
  --wasm contracts/mock_usdc/mock_usdc.wasm \
  --network testnet \
  --source <YOUR_FUNDING_ACCOUNT>
```

The command prints the newly created contract ID, e.g.:
```
Contract deployed at: CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

### Using the mock USDC in your application

Add the contract ID to your environment configuration (e.g., `.env.test`):
```
MOCK_USDC_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

In the TypeScript code you can reference it via the configuration module:
```ts
import { config } from "../config";

export const MOCK_USDC_CONTRACT_ID = config.MOCK_USDC_CONTRACT_ID;
```

The mock contract behaves like a standard ERC‑20 token, allowing you to:
- Mint an initial supply for test accounts.
- Transfer tokens between accounts.
- Approve allowances for escrow contracts.

### Example: Minting tokens for a test user

```ts
import { SorobanRpc, xdr } from "@stellar/stellar-sdk";
import { sorobanServer, networkPassphrase } from "../lib/soroban";
import { MOCK_USDC_CONTRACT_ID } from "../constants";

export async function mintMockUSDC(to: string, amount: string, sourceSecret: string) {
  const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
  const account = await sorobanServer.getAccount(sourceKeypair.publicKey());

  const op = new xdr.Operation({
    // The exact operation depends on the mock contract's interface.
    // Here we assume a `mint` entry point that takes (to, amount).
    // Adjust the arguments according to the actual contract.
    // ...
  });

  // Build, simulate, and submit the transaction using the shared helper.
  const txXdr = await buildTx(sourceKeypair.publicKey(), op);
  // Sign and submit (omitted for brevity).
}
```

---

## Summary

- Use the **Friendbot** endpoint to quickly fund any testnet account.
- Deploy the provided **mock USDC** contract for stable‑coin‑related tests, and reference its contract ID via configuration.
- Both utilities are fully typed and can be imported into your TypeScript test suites.
