/**
 * assets.ts
 *
 * Data-driven registry of the Stellar Asset Contracts (SACs) a job can be paid
 * in. Each entry maps a symbol to its contract id and decimal places, so adding
 * a new asset is a one-line change plus a `VITE_*_CONTRACT_ID`.
 *
 * Amounts are stored on-chain as integer "base units" (stroops for 7-decimal
 * assets); use `toBaseUnits`/`fromBaseUnits` rather than hardcoding 1e7.
 */

export interface Asset {
  symbol: string;
  /** Contract id of the SAC, injected at build time via Vite env. */
  contractId: string;
  /** Number of decimal places the asset uses (USDC and XLM both use 7). */
  decimals: number;
}

export const ASSETS: Asset[] = [
  {
    symbol: "USDC",
    contractId: import.meta.env.VITE_USDC_CONTRACT_ID ?? "",
    decimals: 7,
  },
  {
    symbol: "XLM",
    contractId: import.meta.env.VITE_XLM_CONTRACT_ID ?? "",
    decimals: 7,
  },
];

export class UnknownAssetError extends Error {
  constructor(symbol: string) {
    super(`Unknown asset: ${symbol}`);
    this.name = "UnknownAssetError";
  }
}

/** Look up an asset by symbol (case-insensitive). Throws if unknown. */
export function getAsset(symbol: string): Asset {
  const key = symbol.trim().toUpperCase();
  const asset = ASSETS.find((a) => a.symbol === key);
  if (!asset) throw new UnknownAssetError(symbol);
  return asset;
}

/** Find the registered asset for an on-chain token contract id, if any. */
export function assetForContractId(contractId: string): Asset | null {
  return ASSETS.find((a) => a.contractId && a.contractId === contractId) ?? null;
}

/** Convert a human amount (e.g. `1.5`) into integer base units. */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
  const value = typeof amount === "number" ? amount.toFixed(decimals) : amount;
  const negative = value.trim().startsWith("-");
  const [whole = "0", frac = ""] = value.trim().replace("-", "").split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = BigInt(`${whole || "0"}${padded}`);
  return negative ? -raw : raw;
}

/** Convert integer base units back to a display number. */
export function fromBaseUnits(base: bigint, decimals: number): number {
  return Number(base) / 10 ** decimals;
}
