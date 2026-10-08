/**
 * api.ts
 *
 * Minimal client for the backend REST API. Only the endpoints the frontend
 * needs; `VITE_API_URL` configures the base URL (default localhost:3000).
 *
 * Contributor Notes:
 * - The backend indexer is still a stub, so jobs appear here only once created
 *   through the API — that is expected for now.
 * - `totalAmountUsdc`/`escrowId` come from Prisma and may serialize as strings.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface JobListQuery {
  status?: string;
  client?: string;
  freelancer?: string;
  page?: number;
  limit?: number;
}

/** Build the `/api/jobs` query string, omitting empty filters. */
export function buildJobsQuery(query: JobListQuery = {}): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.client) params.set("client", query.client);
  if (query.freelancer) params.set("freelancer", query.freelancer);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface JobApi {
  id: string;
  /** On-chain escrow id, present only once the job has been funded on-chain. */
  escrowId: string | number | null;
  title: string;
  status: string;
  totalAmountUsdc: string | number;
  client?: { stellarAddress: string; displayName?: string | null } | null;
  freelancer?: { stellarAddress: string } | null;
}

/** Fetch a page of jobs. Throws on a non-2xx response. */
export async function fetchJobs(
  query: JobListQuery = {},
  signal?: AbortSignal,
): Promise<JobApi[]> {
  const res = await fetch(`${API_BASE_URL}/api/jobs${buildJobsQuery(query)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Could not load jobs (HTTP ${res.status})`);
  return (await res.json()) as JobApi[];
}
