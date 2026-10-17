/**
 * Profile.tsx
 *
 * A public view of one address: its on-chain reputation aggregate, the jobs it
 * took part in, the individual ratings behind the aggregate (issue #69), and the
 * indexed on-chain activity for its escrows (issue #72).
 *
 * Contributor Notes:
 * - The aggregate comes from the reputation contract (`useEscrow.getReputation`),
 *   a public view. It is simulated from the read-only source, so it renders for
 *   an unconnected visitor too (issue #108); the job history, rating list and
 *   transaction history come from the backend API.
 * - Job rows are merged from the client and freelancer filters (`fetchUserJobs`)
 *   and deduplicated by job id, so an address that is both parties sees one row.
 * - The transaction history is derived from indexed events, so it is the one
 *   place a client sees a consolidated record of what happened on-chain rather
 *   than one action at a time.
 * - "No ratings yet" is only shown after the contract has actually answered: a
 *   failed read is reported as a network/configuration problem, never as an
 *   empty reputation.
 */

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import AddressField from "../components/AddressField";
import StatusBadge from "../components/StatusBadge";
import { useEscrow, type ReputationView } from "../hooks/useEscrow";
import {
  asReadError,
  describeReadFailure,
  type ContractReadError,
} from "../lib/errors";
import {
  fetchRatingsReceived,
  fetchTransactions,
  fetchUserJobs,
  type JobApi,
  type ReceivedRatingApi,
  type TransactionApi,
} from "../lib/api";
import { actionLabel } from "../lib/activity";
import { explorerTxUrl } from "../lib/stellar";
import { formatDate } from "../lib/time";

export default function Profile() {
  const { address } = useParams<{ address: string }>();
  const { getReputation } = useEscrow();
  const [reputation, setReputation] = useState<ReputationView | null>(null);
  // Typed so the page can tell a bad address from an unreachable network, and
  // never render either as "No ratings yet".
  const [readFailure, setReadFailure] = useState<ContractReadError | null>(null);
  const [reputationLoading, setReputationLoading] = useState(true);

  // `null` means "not loaded yet"; an empty array means "loaded, nothing there".
  const [jobs, setJobs] = useState<JobApi[] | null>(null);
  const [ratings, setRatings] = useState<ReceivedRatingApi[] | null>(null);
  const [transactions, setTransactions] = useState<TransactionApi[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // The read is public, so this runs before a wallet is connected (issue #108).
  useEffect(() => {
    if (!address) {
      setReputationLoading(false);
      return;
    }
    let cancelled = false;
    setReputationLoading(true);
    setReputation(null);
    setReadFailure(null);
    void getReputation(address)
      .then((r) => {
        if (cancelled) return;
        setReputation(r);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setReadFailure(asReadError(e));
      })
      .finally(() => {
        if (!cancelled) setReputationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, getReputation]);

  // The viewed address, not the viewer: a profile is public, so this runs even
  // before a wallet is connected.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setHistoryError(null);
    setJobs(null);
    setRatings(null);
    setTransactions(null);
    void Promise.all([
      fetchUserJobs(address),
      fetchRatingsReceived(address),
      fetchTransactions(address),
    ])
      .then(([jobRows, ratingRows, txRows]) => {
        if (cancelled) return;
        setJobs(jobRows);
        setRatings(ratingRows);
        setTransactions(txRows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHistoryError(err instanceof Error ? err.message : String(err));
        // Distinguish "could not load" from "nothing to show".
        setJobs([]);
        setRatings([]);
        setTransactions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Weighted average = total_score / weight; fall back to the raw count for
  // aggregates written before weighting existed.
  const average = !reputation
    ? null
    : reputation.weight > 0n
      ? Number(reputation.total_score) / Number(reputation.weight)
      : reputation.count > 0n
        ? Number(reputation.total_score) / Number(reputation.count)
        : null;

  return (
    <Layout>
      <h1>Profile</h1>
      {address && (
        <p>
          Address: <AddressField address={address} label="profile address" qr />
        </p>
      )}

      {reputationLoading && (
        <p role="status" aria-live="polite" className="muted">
          Loading reputation…
        </p>
      )}
      {!reputationLoading && readFailure && (
        <p role="alert" aria-live="assertive" className="alert alert-error">
          {/* A bad address is a dead link; anything else is our problem, not theirs. */}
          {readFailure.kind === "not-found"
            ? "That address doesn't look like a Stellar account — check the link."
            : describeReadFailure(readFailure.kind, "this reputation")}
          {readFailure.kind === "unknown" && <> ({readFailure.message})</>}
        </p>
      )}

      {!reputationLoading && reputation && (
        <p role="status" aria-live="polite">
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

      <section>
        <h2>Job history</h2>
        {historyError && (
          <p role="alert" className="alert alert-error">
            {historyError}
          </p>
        )}
        {jobs === null && <p>Loading jobs…</p>}
        {jobs !== null && jobs.length === 0 && !historyError && (
          <p className="muted">No jobs yet.</p>
        )}
        {jobs !== null && jobs.length > 0 && (
          <ul className="job-list">
            {jobs.map((job) => {
              const role =
                job.client?.stellarAddress === address ? "Client" : "Freelancer";
              return (
                <li key={job.id}>
                  <strong>{job.title}</strong> <StatusBadge status={job.status} />
                  <br />
                  <span className="muted">
                    {role} · Total: {String(job.totalAmountUsdc)} {job.asset ?? ""}
                    {job.createdAt ? ` · ${formatDate(job.createdAt)}` : ""}
                  </span>
                  <br />
                  {job.escrowId !== null && job.escrowId !== undefined ? (
                    <Link to={`/jobs/${job.escrowId}`}>
                      Open job #{String(job.escrowId)}
                    </Link>
                  ) : (
                    <span className="muted">Not funded on-chain yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Ratings received</h2>
        {ratings === null && <p>Loading ratings…</p>}
        {ratings !== null && ratings.length === 0 && !historyError && (
          <p className="muted">No ratings received yet.</p>
        )}
        {ratings !== null && ratings.length > 0 && (
          <ul className="rating-list">
            {ratings.map((rating) => (
              <li key={rating.id}>
                <strong>{rating.score} / 5</strong>{" "}
                {rating.job ? (
                  rating.job.escrowId !== null && rating.job.escrowId !== undefined ? (
                    <Link to={`/jobs/${rating.job.escrowId}`}>{rating.job.title}</Link>
                  ) : (
                    <span>{rating.job.title}</span>
                  )
                ) : (
                  <span className="muted">Unknown job</span>
                )}{" "}
                · <time dateTime={rating.createdAt}>{formatDate(rating.createdAt)}</time>
                {rating.comment && <p className="muted">“{rating.comment}”</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Transaction history</h2>
        {transactions === null && <p>Loading transactions…</p>}
        {transactions !== null && transactions.length === 0 && !historyError && (
          <p className="muted">No on-chain activity yet.</p>
        )}
        {transactions !== null && transactions.length > 0 && (
          <table className="tx-history">
            <thead>
              <tr>
                <th>Escrow</th>
                <th>Action</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>
                    <Link to={`/jobs/${tx.escrowId}`}>#{tx.escrowId}</Link>
                  </td>
                  <td>{actionLabel(tx.action)}</td>
                  <td>
                    {tx.amount === null
                      ? "—"
                      : `${tx.amount}${tx.asset ? ` ${tx.asset}` : ""}`}
                  </td>
                  <td>
                    <time dateTime={tx.createdAt}>{formatDate(tx.createdAt)}</time>
                  </td>
                  <td>
                    {tx.txHash ? (
                      <a
                        href={explorerTxUrl(tx.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        title={tx.txHash}
                      >
                        <code>{tx.txHash.slice(0, 12)}…</code>
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}

