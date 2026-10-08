/**
 * assets.ts
 *
 * Data-driven registry of the Stellar Asset Contracts (SACs) a job can be paid
 * in. Mirrors `frontend/src/lib/assets.ts`; the contract id is read from config
 * via `configKey`, so adding a new asset is a config entry plus a line here.
 *
 * Kept free of any `config` import so the conversion/registry logic is unit
 * testable without environment variables.
 */

export interface AssetInfo {
  symbol: string;
  /** Number of decimal places the asset uses (USDC and XLM both use 7). */
  decimals: number;
  /** Config key holding the SAC contract id. */
  configKey: "USDC_CONTRACT_ID" | "XLM_CONTRACT_ID";
}

export const ASSETS: Record<string, AssetInfo> = {
  USDC: { symbol: "USDC", decimals: 7, configKey: "USDC_CONTRACT_ID" },
  XLM: { symbol: "XLM", decimals: 7, configKey: "XLM_CONTRACT_ID" },
};

export class UnknownAssetError extends Error {
  constructor(symbol: string) {
    super(`Unknown asset: ${symbol}`);
    this.name = "UnknownAssetError";
  }
}

/** Look up an asset by symbol (case-insensitive). Throws if unknown. */
export function getAsset(symbol: string): AssetInfo {
  const key = symbol.trim().toUpperCase();
  const asset = ASSETS[key];
  if (!asset) throw new UnknownAssetError(symbol);
  return asset;
}

/** Convert a decimal amount (e.g. from Prisma) into integer base units. */
export function toBaseUnits(amount: number | string, decimals: number): bigint {
  const value = typeof amount === "number" ? amount.toFixed(decimals) : amount;
  const negative = value.trim().startsWith("-");
  const [whole = "0", frac = ""] = value.trim().replace("-", "").split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = BigInt(`${whole || "0"}${padded}`);
  return negative ? -raw : raw;
}
