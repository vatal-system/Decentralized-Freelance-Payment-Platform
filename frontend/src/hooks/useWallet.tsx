/**
 * useWallet.tsx
 *
 * Minimal Freighter wallet context.
 *
 * Freighter injects an API object into the page. Depending on the version this
 * is either `window.freighterApi` (current) or `window.freighter` (legacy); we
 * support both so the app works without pinning a specific extension build.
 *
 * Contributor Notes:
 * - No private keys ever touch this code; Freighter signs in its own context.
 * - `sign` returns the signed transaction XDR.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { networkPassphrase } from "../lib/stellar";

interface FreighterApi {
  getPublicKey(): Promise<string>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<string>;
}

declare global {
  interface Window {
    freighter?: FreighterApi;
    freighterApi?: FreighterApi;
  }
}

function freighter(): FreighterApi | undefined {
  if (typeof window === "undefined") return undefined;
  return window.freighterApi ?? window.freighter;
}

interface WalletContextValue {
  publicKey: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<string | null>;
  disconnect: () => void;
  sign: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const api = freighter();
      if (!api) throw new Error("Freighter wallet not found. Install it from freighter.app");
      const key = await api.getPublicKey();
      setPublicKey(key);
      return key;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setPublicKey(null), []);

  const sign = useCallback(
    async (xdr: string) => {
      const api = freighter();
      if (!api) throw new Error("Freighter wallet not found");
      return api.signTransaction(xdr, { networkPassphrase });
    },
    [],
  );

  const value = useMemo(
    () => ({ publicKey, connecting, error, connect, disconnect, sign }),
    [publicKey, connecting, error, connect, disconnect, sign],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
