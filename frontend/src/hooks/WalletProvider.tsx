/**
 * WalletProvider.tsx
 *
 * Provides the Freighter wallet state to the app. See `wallet-context.ts` for
 * the context object and the `useWallet` hook.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { networkPassphrase } from "../lib/stellar";
import { WalletContext, freighter } from "./wallet-context";

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

  const sign = useCallback(async (xdr: string) => {
    const api = freighter();
    if (!api) throw new Error("Freighter wallet not found");
    return api.signTransaction(xdr, { networkPassphrase });
  }, []);

  const value = useMemo(
    () => ({ publicKey, connecting, error, connect, disconnect, sign }),
    [publicKey, connecting, error, connect, disconnect, sign],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
