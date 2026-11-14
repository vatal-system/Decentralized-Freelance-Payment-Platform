/**
 * wallets.test.ts
 *
 * Unit tests for Stellar browser wallet adapters (Freighter, xBull, LOBSTR
 * Signer, and Rabet) behind `WalletAdapter` (issue #79).
 */

import { Networks } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WALLET_ADAPTERS,
  clearSavedWalletId,
  freighterAdapter,
  getSavedWalletId,
  getWalletAdapter,
  lobstrAdapter,
  rabetAdapter,
  saveWalletId,
  xBullAdapter,
} from "./wallets";

const ADDR_A = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

function resetWindowWallets() {
  delete window.freighter;
  delete window.freighterApi;
  delete window.xBullSDK;
  delete window.lobstrSignerExtensionApi;
  delete window.rabet;
}

beforeEach(() => {
  resetWindowWallets();
  clearSavedWalletId();
});

afterEach(() => {
  resetWindowWallets();
  clearSavedWalletId();
});

describe("Wallet adapter registry (#79)", () => {
  it("exposes Freighter alongside xBull, LOBSTR, and Rabet", () => {
    expect(WALLET_ADAPTERS.map((w) => w.id)).toEqual([
      "freighter",
      "xbull",
      "lobstr",
      "rabet",
    ]);
    expect(getWalletAdapter("xbull")).toBe(xBullAdapter);
    expect(getWalletAdapter("lobstr")).toBe(lobstrAdapter);
  });

  it("persists and clears the chosen wallet id", () => {
    expect(getSavedWalletId()).toBeNull();
    saveWalletId("xbull");
    expect(getSavedWalletId()).toBe("xbull");
    clearSavedWalletId();
    expect(getSavedWalletId()).toBeNull();
  });
});

describe("freighterAdapter", () => {
  it("connects, signs XDR, signs SEP-53 messages, and reads network passphrase", async () => {
    window.freighterApi = {
      getPublicKey: vi.fn(async () => ADDR_A),
      signTransaction: vi.fn(async () => ({ signedTxXdr: "SIGNED_FREIGHTER_XDR" })),
      signMessage: vi.fn(async () => ({ signedMessage: "FREIGHTER_SIG_B64" })),
      getNetwork: vi.fn(async () => ({
        network: "TESTNET",
        networkPassphrase: Networks.TESTNET,
      })),
    };

    expect(freighterAdapter.isAvailable()).toBe(true);
    await expect(freighterAdapter.connect()).resolves.toBe(ADDR_A);
    await expect(
      freighterAdapter.signTransaction("UNSIGNED_XDR", {
        networkPassphrase: Networks.TESTNET,
        address: ADDR_A,
      }),
    ).resolves.toBe("SIGNED_FREIGHTER_XDR");
    await expect(
      freighterAdapter.signMessage("challenge", { address: ADDR_A }),
    ).resolves.toBe("FREIGHTER_SIG_B64");
    await expect(freighterAdapter.getNetwork?.()).resolves.toEqual({
      networkPassphrase: Networks.TESTNET,
    });
  });

  it("reports a helpful install error when Freighter is missing", async () => {
    expect(freighterAdapter.isAvailable()).toBe(false);
    await expect(freighterAdapter.connect()).rejects.toThrow(/freighter\.app/i);
  });
});

describe("xBullAdapter", () => {
  it("requests permissions, connects, signs XDR, and normalizes message signatures", async () => {
    const connectSpy = vi.fn(async () => undefined);
    const signXDRSpy = vi.fn(async () => "SIGNED_XBULL_XDR");
    window.xBullSDK = {
      connect: connectSpy,
      getPublicKey: vi.fn(async () => ADDR_A),
      signXDR: signXDRSpy,
      signMessage: vi.fn(async () => ({ signature: "XBULL_SIG_B64" })),
      getNetwork: vi.fn(async () => Networks.TESTNET),
    };

    expect(xBullAdapter.isAvailable()).toBe(true);
    await expect(xBullAdapter.connect()).resolves.toBe(ADDR_A);
    expect(connectSpy).toHaveBeenCalledWith({
      canRequestPublicKey: true,
      canRequestSign: true,
    });

    await expect(
      xBullAdapter.signTransaction("UNSIGNED_XDR", {
        networkPassphrase: Networks.TESTNET,
        address: ADDR_A,
      }),
    ).resolves.toBe("SIGNED_XBULL_XDR");
    expect(signXDRSpy).toHaveBeenCalledWith("UNSIGNED_XDR", {
      network: Networks.TESTNET,
      targetAddress: ADDR_A,
    });

    await expect(xBullAdapter.signMessage("challenge")).resolves.toBe("XBULL_SIG_B64");
    await expect(xBullAdapter.getNetwork?.()).resolves.toEqual({
      networkPassphrase: Networks.TESTNET,
    });
  });

  it("throws an actionable error when xBull extension is not installed", async () => {
    expect(xBullAdapter.isAvailable()).toBe(false);
    await expect(xBullAdapter.connect()).rejects.toThrow(/xbull\.app/i);
  });
});

describe("lobstrAdapter", () => {
  it("verifies connection state, reads public key, and signs XDR", async () => {
    window.lobstrSignerExtensionApi = {
      isConnected: vi.fn(async () => true),
      getPublicKey: vi.fn(async () => ADDR_A),
      signTransaction: vi.fn(async () => "SIGNED_LOBSTR_XDR"),
    };

    expect(lobstrAdapter.isAvailable()).toBe(true);
    await expect(lobstrAdapter.connect()).resolves.toBe(ADDR_A);
    await expect(
      lobstrAdapter.signTransaction("UNSIGNED_XDR", {
        networkPassphrase: Networks.TESTNET,
      }),
    ).resolves.toBe("SIGNED_LOBSTR_XDR");
    await expect(lobstrAdapter.signMessage("challenge")).rejects.toThrow(
      /does not support SEP-53/i,
    );
  });

  it("surfaces a clear message when LOBSTR Signer is locked", async () => {
    window.lobstrSignerExtensionApi = {
      isConnected: vi.fn(async () => false),
      getPublicKey: vi.fn(async () => ADDR_A),
      signTransaction: vi.fn(async () => ""),
    };

    await expect(lobstrAdapter.connect()).rejects.toThrow(/locked or not connected/i);
  });
});

describe("rabetAdapter", () => {
  it("maps network passphrase to Rabet network name and signs XDR", async () => {
    const signSpy = vi.fn(async () => ({ xdr: "SIGNED_RABET_XDR" }));
    window.rabet = {
      connect: vi.fn(async () => ({ publicKey: ADDR_A })),
      sign: signSpy,
      signMessage: vi.fn(async () => "RABET_SIG"),
    };

    expect(rabetAdapter.isAvailable()).toBe(true);
    await expect(rabetAdapter.connect()).resolves.toBe(ADDR_A);
    await expect(
      rabetAdapter.signTransaction("UNSIGNED_XDR", {
        networkPassphrase: Networks.PUBLIC,
      }),
    ).resolves.toBe("SIGNED_RABET_XDR");
    expect(signSpy).toHaveBeenCalledWith("UNSIGNED_XDR", "mainnet");
    await expect(rabetAdapter.signMessage("challenge")).resolves.toBe("RABET_SIG");
  });
});
