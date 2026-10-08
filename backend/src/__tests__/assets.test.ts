import { describe, it, expect } from "vitest";
import { getAsset, toBaseUnits, UnknownAssetError } from "../lib/assets";

describe("asset registry", () => {
  it("converts amounts using each asset's decimals", () => {
    expect(toBaseUnits("1.5", getAsset("USDC").decimals)).toBe(15_000_000n);
    expect(toBaseUnits("0.1", getAsset("XLM").decimals)).toBe(1_000_000n);
    // Trailing precision is padded to the asset's scale.
    expect(toBaseUnits(2, getAsset("USDC").decimals)).toBe(20_000_000n);
  });

  it("looks up assets case-insensitively", () => {
    expect(getAsset("usdc").symbol).toBe("USDC");
    expect(getAsset(" Xlm ").symbol).toBe("XLM");
  });

  it("rejects an unknown asset", () => {
    expect(() => getAsset("DOGE")).toThrow(UnknownAssetError);
  });
});
