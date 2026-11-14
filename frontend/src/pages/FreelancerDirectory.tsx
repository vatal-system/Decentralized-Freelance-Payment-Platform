/**
 * FreelancerDirectory.tsx
 *
 * Public directory of freelancers with on-chain reputation and stats (#68).
 * Supports search by name, bio, or Stellar address, and sorting by reputation,
 * completed jobs, or join date. Each freelancer entry links to the Profile page.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import AddressField from "../components/AddressField";
import { fetchFreelancers, type FreelancerApi } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { buildJobInvitePath, buildJobInviteUrl } from "../lib/invite";

const PAGE_SIZE = 10;

export default function FreelancerDirectory() {
  const [freelancers, setFreelancers] = useState<FreelancerApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedInviteFor, setCopiedInviteFor] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [sortOption, setSortOption] = useState<"rep_desc" | "rep_asc" | "jobs_desc" | "recent_desc">(
    "rep_desc",
  );
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const loadFreelancers = useCallback(
    async (pageToLoad: number, append: boolean, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);

      let sortBy: "reputation" | "jobs" | "recent" = "reputation";
      let sortOrder: "asc" | "desc" = "desc";

      if (sortOption === "rep_asc") {
        sortBy = "reputation";
        sortOrder = "asc";
      } else if (sortOption === "jobs_desc") {
        sortBy = "jobs";
        sortOrder = "desc";
      } else if (sortOption === "recent_desc") {
        sortBy = "recent";
        sortOrder = "desc";
      }

      try {
        const data = await fetchFreelancers(
          {
            search: activeSearch || undefined,
            sortBy,
            sortOrder,
            page: pageToLoad,
            limit: PAGE_SIZE,
          },
          signal,
        );

        setFreelancers((prev) => (append ? [...prev, ...data.freelancers] : data.freelancers));
        setTotal(data.total);
        setHasMore(data.freelancers.length === PAGE_SIZE && pageToLoad < data.totalPages);
        setPage(pageToLoad);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [activeSearch, sortOption],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadFreelancers(1, false, controller.signal);
    return () => controller.abort();
  }, [loadFreelancers]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchInput.trim());
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setActiveSearch("");
  };

  return (
    <Layout>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1>Freelancer Directory</h1>
        <p className="muted">
          Browse verified freelancers with on-chain reputation scores and completed escrow jobs.
        </p>
      </header>

      {/* Search and Sort Controls */}
      <div
        className="card"
        style={{
          marginBottom: "1.5rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <form
          onSubmit={handleSearchSubmit}
          style={{ display: "flex", gap: "0.5rem", flex: "1 1 300px", alignItems: "center" }}
        >
          <input
            type="search"
            aria-label="Search freelancers"
            placeholder="Search name, bio, or address…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit">Search</button>
          {activeSearch && (
            <button type="button" onClick={handleClearSearch} title="Clear search">
              Clear
            </button>
          )}
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="sort-select" style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
            Sort by:
          </label>
          <select
            id="sort-select"
            aria-label="Sort freelancers by"
            value={sortOption}
            onChange={(e) =>
              setSortOption(
                e.target.value as "rep_desc" | "rep_asc" | "jobs_desc" | "recent_desc",
              )
            }
          >
            <option value="rep_desc">Reputation: Highest first</option>
            <option value="rep_asc">Reputation: Lowest first</option>
            <option value="jobs_desc">Most Completed Jobs</option>
            <option value="recent_desc">Recently Joined</option>
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}

      {loading && freelancers.length === 0 && <p>Loading freelancers…</p>}

      {!loading && !error && freelancers.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            {activeSearch
              ? `No freelancers found matching "${activeSearch}".`
              : "No freelancers currently registered."}
          </p>
        </div>
      )}

      {freelancers.length > 0 && (
        <div>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
            Showing {freelancers.length} of {total} {total === 1 ? "freelancer" : "freelancers"}
          </p>

          <ul
            className="job-list"
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {freelancers.map((freelancer) => (
              <li
                key={freelancer.id}
                className="card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  padding: "1.2rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <div>
                    <h2 style={{ fontSize: "1.2rem", margin: 0, fontWeight: 600 }}>
                      {freelancer.displayName || "Anonymous Freelancer"}
                    </h2>
                    <div style={{ marginTop: "0.25rem" }}>
                      <AddressField address={freelancer.stellarAddress} truncate qr />
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontSize: "1.1rem",
                        fontWeight: 700,
                        color: freelancer.totalRatings > 0 ? "#b45309" : "var(--muted)",
                      }}
                    >
                      {freelancer.totalRatings > 0 ? (
                        <>★ {freelancer.averageScore.toFixed(2)} / 5</>
                      ) : (
                        <span style={{ fontSize: "0.9rem", fontWeight: 400 }}>No ratings yet</span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {freelancer.totalRatings > 0 && (
                        <span>
                          {freelancer.totalRatings}{" "}
                          {freelancer.totalRatings === 1 ? "rating" : "ratings"} ·{" "}
                        </span>
                      )}
                      <span>
                        {freelancer.completedJobsCount}{" "}
                        {freelancer.completedJobsCount === 1 ? "job completed" : "jobs completed"}
                      </span>
                    </div>
                  </div>
                </div>

                {freelancer.bio && (
                  <p style={{ margin: "0.5rem 0", color: "var(--text)" }}>{freelancer.bio}</p>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                    borderTop: "1px solid var(--border)",
                    paddingTop: "0.5rem",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      const url = buildJobInviteUrl({
                        freelancer: freelancer.stellarAddress,
                      });
                      void copyText(url).then((ok) => {
                        if (ok) setCopiedInviteFor(freelancer.stellarAddress);
                      });
                    }}
                  >
                    {copiedInviteFor === freelancer.stellarAddress
                      ? "Invite Link Copied!"
                      : "Copy Invite Link"}
                  </button>
                  <Link
                    to={buildJobInvitePath({ freelancer: freelancer.stellarAddress })}
                    style={{
                      textDecoration: "none",
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.9rem",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Hire on Job →
                  </Link>
                  <Link
                    to={`/profile/${freelancer.stellarAddress}`}
                    className="btn-primary"
                    style={{
                      textDecoration: "none",
                      padding: "0.35rem 0.75rem",
                      fontSize: "0.9rem",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    View Profile →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasMore && (
        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <button disabled={loading} onClick={() => void loadFreelancers(page + 1, true)}>
            {loading ? "Loading…" : "Load more freelancers"}
          </button>
        </div>
      )}
    </Layout>
  );
}
