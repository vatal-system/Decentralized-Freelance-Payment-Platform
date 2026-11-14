/**
 * WalletPicker.tsx
 *
 * Accessible modal dialog allowing the user to pick a Stellar wallet provider
 * (Freighter, xBull, LOBSTR Signer, or Rabet) when connecting (issue #79).
 */

import { useEffect, useRef } from "react";
import { WALLET_ADAPTERS, type WalletProviderId } from "../lib/wallets";

export interface WalletPickerProps {
  open: boolean;
  connecting: boolean;
  activeAttempt: WalletProviderId | null;
  error: string | null;
  onSelect: (id: WalletProviderId) => void;
  onClose: () => void;
}

export default function WalletPicker({
  open,
  connecting,
  activeAttempt,
  error,
  onSelect,
  onClose,
}: WalletPickerProps) {
  const firstActionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    firstActionRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !connecting) {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, connecting, onClose]);

  if (!open) return null;

  return (
    <div
      className="wallet-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !connecting) {
          onClose();
        }
      }}
    >
      <div
        className="wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        aria-describedby="wallet-picker-description"
      >
        <div className="wallet-modal-header">
          <h2 id="wallet-picker-title">Connect a Stellar Wallet</h2>
          <button
            type="button"
            aria-label="Close wallet picker"
            onClick={onClose}
            disabled={connecting}
          >
            Close
          </button>
        </div>

        <p id="wallet-picker-description" className="muted">
          Choose a browser wallet extension to connect and sign transactions.
        </p>

        {error && (
          <p role="alert" aria-live="assertive" className="alert alert-error">
            {error}
          </p>
        )}

        <ul className="wallet-list">
          {WALLET_ADAPTERS.map((adapter, index) => {
            const detected = adapter.isAvailable();
            const isBusy = connecting && activeAttempt === adapter.id;
            return (
              <li key={adapter.id} className="wallet-option">
                <div className="wallet-option-info">
                  <div className="wallet-option-header">
                    <strong>{adapter.name}</strong>
                    <span
                      className={
                        detected
                          ? "wallet-status wallet-status-detected"
                          : "wallet-status wallet-status-missing"
                      }
                    >
                      {detected ? "Detected" : "Not detected"}
                    </span>
                  </div>
                  <span className="muted wallet-option-desc">
                    {adapter.description}
                  </span>
                </div>

                <div className="wallet-option-actions">
                  {!detected && (
                    <a
                      href={adapter.installUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="wallet-install-link"
                    >
                      Install ↗
                    </a>
                  )}
                  <button
                    ref={index === 0 ? firstActionRef : undefined}
                    type="button"
                    className={detected ? "btn-primary" : undefined}
                    disabled={connecting}
                    aria-busy={isBusy}
                    onClick={() => onSelect(adapter.id)}
                  >
                    {isBusy ? "Connecting…" : `Connect ${adapter.name}`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
