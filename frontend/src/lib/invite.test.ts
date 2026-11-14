/**
 * invite.test.ts
 *
 * Unit tests for freelancer job invite URL builders and query parsing (#80).
 */

import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  buildJobInvitePath,
  buildJobInviteUrl,
  isValidStellarAccount,
  parseJobInviteSearch,
} from "./invite";

const VALID_FREELANCER = Keypair.random().publicKey();

describe("job invite link helpers (#80)", () => {
  it("validates Stellar Ed25519 G-addresses and rejects malformed strings", () => {
    expect(isValidStellarAccount(VALID_FREELANCER)).toBe(true);
    expect(isValidStellarAccount(`  ${VALID_FREELANCER}  `)).toBe(true);
    expect(isValidStellarAccount("")).toBe(false);
    expect(isValidStellarAccount("GNOTVALID123")).toBe(false);
  });

  it("builds relative paths and absolute invite URLs with encoded parameters", () => {
    const path = buildJobInvitePath({
      freelancer: VALID_FREELANCER,
      title: "Audit Soroban Vault",
      asset: "usdc",
    });
    expect(path).toBe(
      `/post?freelancer=${VALID_FREELANCER}&title=Audit+Soroban+Vault&asset=USDC`,
    );

    const url = buildJobInviteUrl(
      { freelancer: VALID_FREELANCER },
      "https://stellar-freelance.example/",
    );
    expect(url).toBe(
      `https://stellar-freelance.example/post?freelancer=${VALID_FREELANCER}`,
    );
  });

  it("parses valid freelancer invite query strings and flags invalid addresses", () => {
    const valid = parseJobInviteSearch(
      `?freelancer=${VALID_FREELANCER}&title=Landing+Page&asset=xlm`,
    );
    expect(valid).toEqual({
      freelancer: VALID_FREELANCER,
      invalidFreelancer: null,
      title: "Landing Page",
      asset: "XLM",
      inviteRequest: false,
    });

    const invalid = parseJobInviteSearch("?freelancer=BAD_ADDR&invite=1");
    expect(invalid.freelancer).toBeNull();
    expect(invalid.invalidFreelancer).toBe("BAD_ADDR");
    expect(invalid.inviteRequest).toBe(true);
  });
});
