/**
 * PostJob.tsx
 *
 * Client form to create a new escrow job with a milestone breakdown.
 *
 * Flow:
 *   1. Enter freelancer address + milestone amounts + expiry.
 *   2. `createAndFund` runs escrow.create() then escrow.fund().
 *   3. Redirect to /jobs/:newId on success.
 *
 * Requires VITE_USDC_CONTRACT_ID to be set (the token paid to the freelancer).
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { useEscrow, type CreateAndFundResult } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";
import { CONTRACT_ADDRESSES, explorerTxUrl, toStroops } from "../lib/stellar";

interface MilestoneRow {
  amount: string;
}

export default function PostJob() {
  const { createAndFund, isPending, error } = useEscrow();
  const { publicKey, connect, connecting } = useWallet();

  const [freelancer, setFreelancer] = useState("");
  const [expiryDays, setExpiryDays] = useState("30");
  const [rows, setRows] = useState<MilestoneRow[]>([{ amount: "" }]);
  const [created, setCreated] = useState<CreateAndFundResult | null>(null);

  const updateRow = (i: number, amount: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { amount } : row)));

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) {
      await connect();
      return;
    }
    if (rows.some((r) => !(Number(r.amount) > 0))) return;

    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(expiryDays) * 86400);
    const result = await createAndFund(
      freelancer.trim(),
      rows.map((r) => ({ amount: toStroops(Number(r.amount)), deadline: 0n })),
      expiry,
    );
    if (result) setCreated(result);
  }

  return (
    <Layout>
      <h1>Post a Job</h1>

      {!CONTRACT_ADDRESSES.escrow && (
        <p role="alert" className="alert alert-error">
          No escrow contract configured. Run <code>scripts/deploy_testnet.sh</code> or
          set <code>VITE_ESCROW_CONTRACT_ID</code> in <code>.env</code>.
        </p>
      )}
      {!CONTRACT_ADDRESSES.usdc && (
        <p role="alert" className="alert alert-error">
          No token configured. Set <code>VITE_USDC_CONTRACT_ID</code> in{" "}
          <code>.env</code>.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <p>
          <label>
            Freelancer Stellar address
            <br />
            <input
              value={freelancer}
              onChange={(e) => setFreelancer(e.target.value)}
              placeholder="G..."
              size={60}
              required
            />
          </label>
        </p>

        <fieldset>
          <legend>Milestones</legend>
          {rows.map((row, i) => (
            <p key={i}>
              <label>
                Amount #{i + 1}{" "}
                <input
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={row.amount}
                  onChange={(e) => updateRow(i, e.target.value)}
                  required
                />
              </label>{" "}
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((r) => r.filter((_, x) => x !== i))}>
                  Remove
                </button>
              )}
            </p>
          ))}
          <button type="button" onClick={() => setRows((r) => [...r, { amount: "" }])}>
            Add milestone
          </button>
          <p>
            Total: <strong>{total}</strong> (token units)
          </p>
        </fieldset>

        <p>
          <label>
            Expiry (days from now){" "}
            <input
              type="number"
              min="1"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </label>
        </p>

        <button
          type="submit"
          className="btn-primary"
          disabled={isPending("create") || connecting}
        >
          {isPending("create")
            ? "Submitting…"
            : publicKey
              ? "Create & Fund Escrow"
              : "Connect & Continue"}
        </button>
      </form>

      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}

      {created && (
        <p className="alert">
          Escrow #{created.id.toString()} created and funded. Transaction{" "}
          <a
            href={explorerTxUrl(created.hash)}
            target="_blank"
            rel="noreferrer"
            title={created.hash}
          >
            <code>{created.hash.slice(0, 12)}…</code>
          </a>{" "}
          <Link to={`/jobs/${created.id}`}>Open job →</Link>
        </p>
      )}
    </Layout>
  );
}
