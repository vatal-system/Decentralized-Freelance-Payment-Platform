/**
 * Profile.tsx
 *
 * Displays a user's on-chain reputation aggregate (total score + count).
 * Job history will come from the backend indexer (see docs/wave-issues/).
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { useEscrow, type ReputationView } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";

export default function Profile() {
  const { address } = useParams<{ address: string }>();
  const { getReputation, loading, error } = useEscrow();
  const { publicKey, connect } = useWallet();
  const [reputation, setReputation] = useState<ReputationView | null>(null);

  useEffect(() => {
    if (address) void getReputation(address).then((r) => r && setReputation(r));
  }, [address, getReputation]);

  const average =
    reputation && reputation.count > 0n
      ? Number(reputation.total_score) / Number(reputation.count)
      : null;

  return (
    <Layout>
      <h1>Profile</h1>
      <p>
        Address: <code>{address}</code>
      </p>

      {!publicKey && (
        <p>
          <button onClick={() => void connect()}>Connect Freighter</button> to load
          reputation.
        </p>
      )}

      {loading && <p>Loading…</p>}
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}

      {reputation && (
        <p>
          {average === null ? (
            <>No ratings yet.</>
          ) : (
            <>
              Rating: <strong>{average.toFixed(2)} / 5</strong> from{" "}
              {reputation.count.toString()} review(s)
            </>
          )}
        </p>
      )}
    </Layout>
  );
}
