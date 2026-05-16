import { describe, it, expect } from "vitest";

// Pure unit tests that don't require DB or env vars.
// Integration tests requiring a live DB belong in a separate test suite
// run against a real environment (see CONTRIBUTING.md).

describe("milestone amount validation", () => {
  it("rejects zero amounts", () => {
    const isValid = (amount: number) => amount > 0;
    expect(isValid(0)).toBe(false);
    expect(isValid(-1)).toBe(false);
    expect(isValid(100)).toBe(true);
  });
});

describe("stellar address format", () => {
  it("identifies valid G... addresses", () => {
    const isValidAddress = (addr: string) =>
      /^G[A-Z2-7]{54}$/.test(addr);
    expect(isValidAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")).toBe(true);
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("")).toBe(false);
  });
});
