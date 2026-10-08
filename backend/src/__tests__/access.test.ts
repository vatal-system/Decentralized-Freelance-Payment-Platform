import { describe, it, expect } from "vitest";
import { isAllowedOrigin, isListed, parseList } from "../lib/access";

const ALICE = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";
const BOB = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

describe("parseList", () => {
  it("splits, trims and de-duplicates", () => {
    expect(parseList(` ${ALICE} , ${BOB} ,${ALICE} `)).toEqual([ALICE, BOB]);
  });

  it("treats empty, null and whitespace-only values as an empty list", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   ")).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList(null)).toEqual([]);
  });

  it("drops empty entries from stray commas", () => {
    expect(parseList(`${ALICE},,${BOB},`)).toEqual([ALICE, BOB]);
  });
});

describe("isListed", () => {
  it("matches a listed value", () => {
    expect(isListed(ALICE, [ALICE, BOB])).toBe(true);
  });

  it("rejects an unlisted value", () => {
    expect(isListed("GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", [ALICE])).toBe(
      false,
    );
  });

  it("matches case-insensitively", () => {
    expect(isListed(ALICE.toLowerCase(), [ALICE])).toBe(true);
  });

  it("fails closed for a missing value or an empty list", () => {
    expect(isListed(undefined, [ALICE])).toBe(false);
    expect(isListed("", [ALICE])).toBe(false);
    expect(isListed(ALICE, [])).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("allows everything when no origins are configured", () => {
    expect(isAllowedOrigin("https://anything.example", [])).toBe(true);
  });

  it("allows everything when the list is a wildcard", () => {
    expect(isAllowedOrigin("https://anything.example", ["*"])).toBe(true);
  });

  it("allows a configured origin", () => {
    expect(isAllowedOrigin("https://app.vercel.app", ["https://app.vercel.app"])).toBe(
      true,
    );
  });

  it("blocks an unconfigured origin", () => {
    expect(isAllowedOrigin("https://evil.example", ["https://app.vercel.app"])).toBe(
      false,
    );
  });

  it("allows requests without an Origin header (same-origin / server-to-server)", () => {
    expect(isAllowedOrigin(undefined, ["https://app.vercel.app"])).toBe(true);
  });
});
