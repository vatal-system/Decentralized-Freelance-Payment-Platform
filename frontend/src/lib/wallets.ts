/**
 * wallets.ts
 *
 * Browser-injected Stellar wallet adapters (issue #79).
 *
 * Supports Freighter (`window.freighterApi` / `window.freighter`), xBull
 * (`window.xBullSDK`), Lobstr Signer (`window.lobstrSignerExtensionApi`), and
 * Rabet (`window.rabet`) behind a uniform `WalletAdapter` contract. No private
 * keys ever touch application code — signing stays inside each wallet extension.
 */

import { Networks } from "@stellar/stellar-sdk";

export type WalletProviderId = "freighter" | "xbull" | "lobstr" | "rabet";

export interface FreighterApi {
  getPublicKey?(): Promise<string>;
  getAddress?(): Promise<{ address: string; error?: string }>;
  requestAccess?(): Promise<{ address: string; error?: string } | string>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<string | { signedTxXdr: string; error?: string }>;
  /** SEP-53 message signing. Newer versions return an object, older a string. */
  signMessage?(
    message: string,
    opts?: { address?: string },
  ): Promise<{ signedMessage?: string; signature?: string; error?: string } | string>;
  /** Get the network details from Freighter. */
  getNetwork?(): Promise<{ network: string; networkPassphrase: string }>;
}

export interface XBullApi {
  connect(permissions?: {
    canRequestPublicKey?: boolean;
    canRequestSign?: boolean;
  }): Promise<void>;
  getPublicKey(): Promise<string>;
  signXDR(
    xdr: string,
    opts?: { network?: string; targetAddress?: string },
  ): Promise<string>;
  signMessage?(message: string): Promise<string | { signature: string }>;
  getNetwork?(): Promise<{ network?: string; networkPassphrase?: string } | string>;
}

export interface LobstrApi {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  signTransaction(xdr: string): Promise<string | { signedTxXdr?: string; xdr?: string }>;
  signMessage?(message: string): Promise<string | { signature: string }>;
}

export interface RabetApi {
  connect(): Promise<{ publicKey: string; error?: string }>;
  sign(
    xdr: string,
    network: "mainnet" | "testnet",
  ): Promise<{ xdr: string; error?: string }>;
  signMessage?(message: string): Promise<{ signature: string } | string>;
}

declare global {
  interface Window {
    freighter?: FreighterApi;
    freighterApi?: FreighterApi;
    xBullSDK?: XBullApi;
    lobstrSignerExtensionApi?: LobstrApi;
    rabet?: RabetApi;
  }
}

export interface WalletSignOptions {
  networkPassphrase: string;
  address?: string;
}

export interface WalletAdapter {
  id: WalletProviderId;
  name: string;
  description: string;
  installUrl: string;
  isAvailable(): boolean;
  connect(): Promise<string>;
  signTransaction(xdr: string, opts: WalletSignOptions): Promise<string>;
  signMessage(message: string, opts?: { address?: string }): Promise<string>;
  getNetwork?(): Promise<{ networkPassphrase: string } | null>;
}

const SELECTED_WALLET_STORAGE_KEY = "stellar_selected_wallet";

export function freighter(): FreighterApi | undefined {
  if (typeof window === "undefined") return undefined;
  return window.freighterApi ?? window.freighter;
}

function normalizeSignature(result: unknown, walletName: string): string {
  if (typeof result === "string" && result.length > 0) return result;
  if (result && typeof result === "object") {
    const record = result as {
      signature?: string;
      signedMessage?: string;
      error?: string;
    };
    if (record.error) throw new Error(record.error);
    if (typeof record.signature === "string" && record.signature.length > 0) {
      return record.signature;
    }
    if (typeof record.signedMessage === "string" && record.signedMessage.length > 0) {
      return record.signedMessage;
    }
  }
  throw new Error(`${walletName} did not return a valid message signature.`);
}

export const freighterAdapter: WalletAdapter = {
  id: "freighter",
  name: "Freighter",
  description: "Official SDF browser extension for Soroban & Stellar.",
  installUrl: "https://www.freighter.app/",
  isAvailable: () => Boolean(freighter()),
  async connect() {
    const api = freighter();
    if (!api) {
      throw new Error("Freighter wallet not found. Install it from freighter.app");
    }
    if (api.getPublicKey) {
      const key = await api.getPublicKey();
      if (!key) throw new Error("Freighter did not return a public key.");
      return key;
    }
    if (api.requestAccess) {
      const res = await api.requestAccess();
      if (typeof res === "string") return res;
      if (res.error) throw new Error(res.error);
      if (res.address) return res.address;
    }
    if (api.getAddress) {
      const res = await api.getAddress();
      if (res.error) throw new Error(res.error);
      if (res.address) return res.address;
    }
    throw new Error("Freighter wallet API does not expose a public key method.");
  },
  async signTransaction(xdr, { networkPassphrase, address }) {
    const api = freighter();
    if (!api) throw new Error("Freighter wallet not found");
    const result = await api.signTransaction(xdr, { networkPassphrase, address });
    if (typeof result === "string") return result;
    if (result.error) throw new Error(result.error);
    return result.signedTxXdr;
  },
  async signMessage(message, opts) {
    const api = freighter();
    if (!api) throw new Error("Freighter wallet not found");
    if (!api.signMessage) {
      throw new Error("This Freighter version can't sign messages; update the extension.");
    }
    const result = await api.signMessage(
      message,
      opts?.address ? { address: opts.address } : undefined,
    );
    return normalizeSignature(result, "Freighter");
  },
  async getNetwork() {
    const api = freighter();
    if (!api?.getNetwork) return null;
    const net = await api.getNetwork();
    return net?.networkPassphrase ? { networkPassphrase: net.networkPassphrase } : null;
  },
};

export const xBullAdapter: WalletAdapter = {
  id: "xbull",
  name: "xBull",
  description: "Multi-platform Stellar & Soroban smart-contract wallet.",
  installUrl: "https://xbull.app/",
  isAvailable: () => typeof window !== "undefined" && Boolean(window.xBullSDK),
  async connect() {
    const api = typeof window !== "undefined" ? window.xBullSDK : undefined;
    if (!api) {
      throw new Error("xBull wallet not found. Install the extension from xbull.app");
    }
    await api.connect({ canRequestPublicKey: true, canRequestSign: true });
    const key = await api.getPublicKey();
    if (!key) throw new Error("xBull did not return a public key.");
    return key;
  },
  async signTransaction(xdr, { networkPassphrase, address }) {
    const api = typeof window !== "undefined" ? window.xBullSDK : undefined;
    if (!api) throw new Error("xBull wallet not found");
    return api.signXDR(xdr, {
      network: networkPassphrase,
      ...(address ? { targetAddress: address } : {}),
    });
  },
  async signMessage(message) {
    const api = typeof window !== "undefined" ? window.xBullSDK : undefined;
    if (!api) throw new Error("xBull wallet not found");
    if (!api.signMessage) {
      throw new Error("This xBull build does not support SEP-53 message signing.");
    }
    const result = await api.signMessage(message);
    return normalizeSignature(result, "xBull");
  },
  async getNetwork() {
    const api = typeof window !== "undefined" ? window.xBullSDK : undefined;
    if (!api?.getNetwork) return null;
    const net = await api.getNetwork();
    if (typeof net === "string") return { networkPassphrase: net };
    return net?.networkPassphrase ? { networkPassphrase: net.networkPassphrase } : null;
  },
};

export const lobstrAdapter: WalletAdapter = {
  id: "lobstr",
  name: "LOBSTR",
  description: "LOBSTR Signer browser extension for Stellar accounts.",
  installUrl: "https://signer.lobstr.co/",
  isAvailable: () =>
    typeof window !== "undefined" && Boolean(window.lobstrSignerExtensionApi),
  async connect() {
    const api =
      typeof window !== "undefined" ? window.lobstrSignerExtensionApi : undefined;
    if (!api) {
      throw new Error(
        "LOBSTR Signer extension not found. Install it from signer.lobstr.co",
      );
    }
    const connected = await api.isConnected();
    if (!connected) {
      throw new Error("LOBSTR Signer is locked or not connected to an account.");
    }
    const key = await api.getPublicKey();
    if (!key) throw new Error("LOBSTR Signer did not return a public key.");
    return key;
  },
  async signTransaction(xdr) {
    const api =
      typeof window !== "undefined" ? window.lobstrSignerExtensionApi : undefined;
    if (!api) throw new Error("LOBSTR Signer extension not found");
    const result = await api.signTransaction(xdr);
    if (typeof result === "string") return result;
    const signed = result.signedTxXdr ?? result.xdr;
    if (!signed) throw new Error("LOBSTR Signer did not return signed XDR.");
    return signed;
  },
  async signMessage(message) {
    const api =
      typeof window !== "undefined" ? window.lobstrSignerExtensionApi : undefined;
    if (!api) throw new Error("LOBSTR Signer extension not found");
    if (!api.signMessage) {
      throw new Error(
        "LOBSTR Signer does not support SEP-53 off-chain message signing; switch to Freighter or xBull for off-chain actions.",
      );
    }
    const result = await api.signMessage(message);
    return normalizeSignature(result, "LOBSTR");
  },
};

export const rabetAdapter: WalletAdapter = {
  id: "rabet",
  name: "Rabet",
  description: "Lightweight Stellar browser wallet extension.",
  installUrl: "https://rabet.io/",
  isAvailable: () => typeof window !== "undefined" && Boolean(window.rabet),
  async connect() {
    const api = typeof window !== "undefined" ? window.rabet : undefined;
    if (!api) {
      throw new Error("Rabet wallet not found. Install the extension from rabet.io");
    }
    const res = await api.connect();
    if (res.error) throw new Error(res.error);
    if (!res.publicKey) throw new Error("Rabet did not return a public key.");
    return res.publicKey;
  },
  async signTransaction(xdr, { networkPassphrase }) {
    const api = typeof window !== "undefined" ? window.rabet : undefined;
    if (!api) throw new Error("Rabet wallet not found");
    const rabetNet = networkPassphrase === Networks.PUBLIC ? "mainnet" : "testnet";
    const res = await api.sign(xdr, rabetNet);
    if (res.error) throw new Error(res.error);
    if (!res.xdr) throw new Error("Rabet did not return signed XDR.");
    return res.xdr;
  },
  async signMessage(message) {
    const api = typeof window !== "undefined" ? window.rabet : undefined;
    if (!api) throw new Error("Rabet wallet not found");
    if (!api.signMessage) {
      throw new Error("This Rabet version does not support SEP-53 message signing.");
    }
    const result = await api.signMessage(message);
    return normalizeSignature(result, "Rabet");
  },
};

export const WALLET_ADAPTERS: readonly WalletAdapter[] = [
  freighterAdapter,
  xBullAdapter,
  lobstrAdapter,
  rabetAdapter,
];

export function getWalletAdapter(id: WalletProviderId): WalletAdapter {
  const match = WALLET_ADAPTERS.find((adapter) => adapter.id === id);
  if (!match) {
    throw new Error(`Unsupported wallet provider: ${id}`);
  }
  return match;
}

export function isWalletProviderId(value: unknown): value is WalletProviderId {
  return (
    value === "freighter" ||
    value === "xbull" ||
    value === "lobstr" ||
    value === "rabet"
  );
}

export function getSavedWalletId(): WalletProviderId | null {
  try {
    if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
      return null;
    }
    const saved = localStorage.getItem(SELECTED_WALLET_STORAGE_KEY);
    return isWalletProviderId(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveWalletId(id: WalletProviderId): void {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, id);
    }
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
}

export function clearSavedWalletId(): void {
  try {
    if (
      typeof localStorage !== "undefined" &&
      typeof localStorage.removeItem === "function"
    ) {
      localStorage.removeItem(SELECTED_WALLET_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}
