/**
 * WalletProvider.tsx
 *
 * Provides multi-wallet connection state (Freighter, xBull, LOBSTR Signer, and
 * Rabet) plus the interactive `WalletPicker` dialog to the app (issue #79).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import WalletPicker from "../components/WalletPicker";
import { clearAuthToken } from "../lib/api";
import { networkPassphrase } from "../lib/stellar";
import {
  clearSavedWalletId,
  getSavedWalletId,
  getWalletAdapter,
  saveWalletId,
  type WalletProviderId,
} from "../lib/wallets";
import { WalletContext } from "./wallet-context";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<WalletProviderId | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [activeAttempt, setActiveAttempt] = useState<WalletProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Callers like `await connect()` in PostJob / Dashboard wait for the user to
  // pick a wallet from the modal (or cancel, which resolves `null`).
  const pendingResolversRef = useRef<Array<(key: string | null) => void>>([]);

  const settlePending = useCallback((result: string | null) => {
    const resolvers = pendingResolversRef.current.splice(0);
    for (const resolve of resolvers) {
      resolve(result);
    }
  }, []);

  const checkNetworkMatch = useCallback(async (id: WalletProviderId | null) => {
    if (!id) {
      setNetworkMismatch(false);
      return;
    }
    const adapter = getWalletAdapter(id);
    if (!adapter.getNetwork) {
      setNetworkMismatch(false);
      return;
    }

    try {
      const walletNetwork = await adapter.getNetwork();
      if (walletNetwork && walletNetwork.networkPassphrase !== networkPassphrase) {
        setNetworkMismatch(true);
      } else {
        setNetworkMismatch(false);
      }
    } catch {
      setNetworkMismatch(false);
    }
  }, []);

  const connectWithAdapter = useCallback(
    async (targetId: WalletProviderId): Promise<string | null> => {
      setConnecting(true);
      setActiveAttempt(targetId);
      setError(null);
      try {
        const adapter = getWalletAdapter(targetId);
        const key = await adapter.connect();
        setPublicKey(key);
        setProviderId(targetId);
        saveWalletId(targetId);
        await checkNetworkMatch(targetId);
        setPickerOpen(false);
        settlePending(key);
        return key;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        return null;
      } finally {
        setConnecting(false);
        setActiveAttempt(null);
      }
    },
    [checkNetworkMatch, settlePending],
  );

  const openPicker = useCallback(() => {
    setError(null);
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    settlePending(null);
  }, [settlePending]);

  const connect = useCallback(
    async (explicitId?: WalletProviderId): Promise<string | null> => {
      if (explicitId) {
        return connectWithAdapter(explicitId);
      }
      setError(null);
      setPickerOpen(true);
      return new Promise<string | null>((resolve) => {
        pendingResolversRef.current.push(resolve);
      });
    },
    [connectWithAdapter],
  );

  const disconnect = useCallback(() => {
    if (publicKey) clearAuthToken(publicKey);
    clearSavedWalletId();
    setPublicKey(null);
    setProviderId(null);
    setError(null);
    setNetworkMismatch(false);
  }, [publicKey]);

  const resolveActiveAdapter = useCallback(() => {
    const id = providerId ?? getSavedWalletId() ?? "freighter";
    return getWalletAdapter(id);
  }, [providerId]);

  const sign = useCallback(
    async (xdr: string) => {
      const adapter = resolveActiveAdapter();
      return adapter.signTransaction(xdr, {
        networkPassphrase,
        ...(publicKey ? { address: publicKey } : {}),
      });
    },
    [publicKey, resolveActiveAdapter],
  );

  const signMessage = useCallback(
    async (message: string) => {
      const adapter = resolveActiveAdapter();
      return adapter.signMessage(
        message,
        publicKey ? { address: publicKey } : undefined,
      );
    },
    [publicKey, resolveActiveAdapter],
  );

  useEffect(() => {
    if (!publicKey || !providerId) return;

    const handleFocus = () => {
      void checkNetworkMatch(providerId);
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [publicKey, providerId, checkNetworkMatch]);

  const providerName = providerId ? getWalletAdapter(providerId).name : null;

  const value = useMemo(
    () => ({
      publicKey,
      connecting,
      error,
      networkMismatch,
      providerId,
      providerName,
      pickerOpen,
      connect,
      openPicker,
      closePicker,
      disconnect,
      sign,
      signMessage,
    }),
    [
      publicKey,
      connecting,
      error,
      networkMismatch,
      providerId,
      providerName,
      pickerOpen,
      connect,
      openPicker,
      closePicker,
      disconnect,
      sign,
      signMessage,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <WalletPicker
        open={pickerOpen}
        connecting={connecting}
        activeAttempt={activeAttempt}
        error={error}
        onSelect={(selectedId) => {
          void connectWithAdapter(selectedId);
        }}
        onClose={closePicker}
      />
    </WalletContext.Provider>
  );
}
