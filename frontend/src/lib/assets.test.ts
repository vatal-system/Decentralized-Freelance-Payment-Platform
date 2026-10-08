import { describe, expect, it } from "vitest";
import { fromBaseUnits, getAsset, toBaseUnits, UnknownAssetError } from "./assets";

describe("asset registry", () => {
  it("converts amounts using each asset's decimals", () => {
    expect(toBaseUnits("1.5", getAsset("USDC").decimals)).toBe(15_000_000n);
    expect(toBaseUnits("0.1", getAsset("XLM").decimals)).toBe(1_000_000n);
    expect(toBaseUnits(2, getAsset("USDC").decimals)).toBe(20_000_000n);
  });

  it("round-trips base units back to a display amount", () => {
    expect(fromBaseUnits(15_000_000n, 7)).toBeCloseTo(1.5);
  });

  it("looks up assets case-insensitively", () => {
    expect(getAsset("usdc").symbol).toBe("USDC");
  });

  it("rejects an unknown asset", () => {
    expect(() => getAsset("DOGE")).toThrow(UnknownAssetError);
  });
});
