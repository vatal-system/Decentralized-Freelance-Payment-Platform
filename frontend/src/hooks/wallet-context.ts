/**
 * wallet-context.ts
 *
 * Wallet context object + hook, kept separate from the provider component so
 * Fast Refresh works when editing the provider.
 *
 * Supports multiple browser-injected Stellar wallet adapters (Freighter, xBull,
 * LOBSTR Signer, and Rabet — see `lib/wallets.ts`, issue #79). No private keys
 * ever touch this code; each wallet signs in its own extension context.
 */

import { createContext, useContext } from "react";
import {
  freighter,
  type FreighterApi,
  type WalletProviderId,
} from "../lib/wallets";

export { freighter, type FreighterApi, type WalletProviderId };

export interface WalletContextValue {
  publicKey: string | null;
  connecting: boolean;
  error: string | null;
  networkMismatch: boolean;
  /** Active wallet adapter id once connected (issue #79). */
  providerId?: WalletProviderId | null;
  /** Human-readable name of the connected wallet provider (issue #79). */
  providerName?: string | null;
  /** Whether the wallet selection dialog is currently open (issue #79). */
  pickerOpen?: boolean;
  /**
   * Connect a wallet. When called with a `providerId`, connects directly with
   * that adapter; when called with no argument, opens the wallet picker and
   * resolves once a provider connects (or `null` if cancelled).
   */
  connect: (providerId?: WalletProviderId) => Promise<string | null>;
  /** Open the wallet picker modal without awaiting a connection. */
  openPicker?: () => void;
  /** Dismiss the wallet picker modal. */
  closePicker?: () => void;
  disconnect: () => void;
  sign: (xdr: string) => Promise<string>;
  /** Sign a message per SEP-53; returns the base64 signature. */
  signMessage: (message: string) => Promise<string>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
