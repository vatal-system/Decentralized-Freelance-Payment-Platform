/**
 * WalletPicker.test.tsx
 *
 * Integration tests for `WalletProvider` + `WalletPicker` (issue #79):
 * opening the picker when `connect()` is invoked, connecting through non-Freighter
 * providers (xBull / LOBSTR), resolving callers awaiting `connect()`, cancelling
 * with Escape or Close, surfacing extension errors, and disconnecting.
 */

import { Networks } from "@stellar/stellar-sdk";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletProvider } from "../hooks/WalletProvider";
import { useWallet } from "../hooks/wallet-context";
import { clearSavedWalletId } from "../lib/wallets";

const XBULL_KEY = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

function Harness() {
  const {
    publicKey,
    providerId,
    providerName,
    networkMismatch,
    connect,
    disconnect,
    sign,
  } = useWallet();
  const [resolvedKey, setResolvedKey] = useState<string>("pending");
  const [signedXdr, setSignedXdr] = useState<string>("");

  return (
    <div>
      <span data-testid="pubkey">{publicKey ?? "none"}</span>
      <span data-testid="provider">{providerId ?? "none"}</span>
      <span data-testid="provider-name">{providerName ?? "none"}</span>
      <span data-testid="mismatch">{networkMismatch ? "yes" : "no"}</span>
      <span data-testid="resolved">{resolvedKey}</span>
      <span data-testid="signed">{signedXdr}</span>

      <button
        type="button"
        onClick={() => {
          void connect().then((k) => setResolvedKey(k ?? "cancelled"));
        }}
      >
        Open Wallet Picker
      </button>

      <button
        type="button"
        onClick={() => {
          void sign("RAW_TX_XDR").then(setSignedXdr);
        }}
      >
        Sign Sample XDR
      </button>

      <button type="button" onClick={disconnect}>
        Disconnect Wallet
      </button>
    </div>
  );
}

function resetExtensions() {
  delete window.freighter;
  delete window.freighterApi;
  delete window.xBullSDK;
  delete window.lobstrSignerExtensionApi;
  delete window.rabet;
}

beforeEach(() => {
  resetExtensions();
  clearSavedWalletId();
});

afterEach(() => {
  cleanup();
  resetExtensions();
  clearSavedWalletId();
});

describe("WalletPicker & WalletProvider (#79)", () => {
  it("opens the picker when connect() is called, connects xBull, and delegates signing", async () => {
    window.xBullSDK = {
      connect: vi.fn(async () => undefined),
      getPublicKey: vi.fn(async () => XBULL_KEY),
      signXDR: vi.fn(async () => "XBULL_SIGNED_TX"),
      getNetwork: vi.fn(async () => Networks.TESTNET),
    };

    render(
      <WalletProvider>
        <Harness />
      </WalletProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Wallet Picker" }));

    const dialog = screen.getByRole("dialog", { name: /Connect a Stellar Wallet/i });
    expect(dialog).toBeTruthy();

    // Freighter is not installed, while xBull is detected.
    expect(screen.getAllByText("Not detected").length).toBe(3);
    expect(screen.getByText("Detected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect xBull" }));

    await waitFor(() => {
      expect(screen.getByTestId("pubkey").textContent).toBe(XBULL_KEY);
    });
    expect(screen.getByTestId("provider").textContent).toBe("xbull");
    expect(screen.getByTestId("provider-name").textContent).toBe("xBull");
    expect(screen.getByTestId("resolved").textContent).toBe(XBULL_KEY);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Signing routes through xBull, not Freighter.
    fireEvent.click(screen.getByRole("button", { name: "Sign Sample XDR" }));
    await waitFor(() => {
      expect(screen.getByTestId("signed").textContent).toBe("XBULL_SIGNED_TX");
    });

    // Disconnect clears both publicKey and providerId.
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Wallet" }));
    expect(screen.getByTestId("pubkey").textContent).toBe("none");
    expect(screen.getByTestId("provider").textContent).toBe("none");
  });

  it("resolves awaiting connect() callers with null when dismissed via Escape", async () => {
    render(
      <WalletProvider>
        <Harness />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Wallet Picker" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId("resolved").textContent).toBe("cancelled");
    });
  });

  it("keeps the picker open and announces an alert when the selected wallet is missing", async () => {
    render(
      <WalletProvider>
        <Harness />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Wallet Picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect LOBSTR" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/signer\.lobstr\.co/i);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("flags networkMismatch when the selected wallet reports Mainnet while app uses Testnet", async () => {
    window.xBullSDK = {
      connect: vi.fn(async () => undefined),
      getPublicKey: vi.fn(async () => XBULL_KEY),
      signXDR: vi.fn(async () => "SIGNED"),
      getNetwork: vi.fn(async () => Networks.PUBLIC),
    };

    render(
      <WalletProvider>
        <Harness />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Wallet Picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect xBull" }));

    await waitFor(() => {
      expect(screen.getByTestId("mismatch").textContent).toBe("yes");
    });
  });
});
