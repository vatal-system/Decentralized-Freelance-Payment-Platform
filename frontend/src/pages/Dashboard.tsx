/**
 * Dashboard.tsx
 *
 * Landing page: connect the wallet and open an existing job by its on-chain id.
 *
 * The job list itself will come from the backend indexer (see
 * docs/wave-issues/); until then this page stays deliberately simple.
 */

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWallet } from "../hooks/wallet-context";

export default function Dashboard() {
  const { publicKey, connecting, connect, error } = useWallet();
  const [jobId, setJobId] = useState("");
  const navigate = useNavigate();

  return (
    <main style={{ padding: "1rem", maxWidth: 720 }}>
      <h1>My Jobs</h1>

      {!publicKey ? (
        <p>
          <button onClick={() => void connect()} disabled={connecting}>
            {connecting ? "Connecting…" : "Connect your Freighter wallet"}
          </button>{" "}
          to post or manage jobs.
        </p>
      ) : (
        <p>
          Connected as <code>{publicKey}</code>.{" "}
          <Link to={`/profile/${publicKey}`}>View reputation</Link>
        </p>
      )}

      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (jobId.trim()) navigate(`/jobs/${jobId.trim()}`);
        }}
      >
        <label>
          Open a job by on-chain id{" "}
          <input
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="0"
          />
        </label>{" "}
        <button type="submit">Open</button>
      </form>

      <p>
        <Link to="/post">Post a new job →</Link>
      </p>
    </main>
  );
}
