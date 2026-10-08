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
  /** Asset symbol the job pays in (see lib/assets.ts). */
  asset?: string;
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

// ---------------------------------------------------------------------------
// Authenticated writes
// ---------------------------------------------------------------------------

export interface CreateJobMilestoneInput {
  description?: string;
  amountUsdc: number;
  deadline?: string;
}

export interface CreateJobInput {
  title: string;
  description: string;
  /** Asset symbol the job pays in; the backend stores it on the job. */
  asset: string;
  milestones: CreateJobMilestoneInput[];
  expiresAt?: string;
}

/**
 * Complete the wallet challenge-response flow and return a bearer token.
 * `signMessage` signs the challenge nonce per SEP-53 (see Freighter).
 */
export async function authenticate(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<string> {
  const challengeRes = await fetch(
    `${API_BASE_URL}/api/users/challenge?address=${encodeURIComponent(address)}`,
  );
  if (!challengeRes.ok) {
    throw new Error(`Could not get an auth challenge (HTTP ${challengeRes.status})`);
  }
  const { nonce } = (await challengeRes.json()) as { nonce: string };

  const signature = await signMessage(nonce);
  const authRes = await fetch(`${API_BASE_URL}/api/users/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, signature, nonce }),
  });
  if (!authRes.ok) throw new Error(`Authentication failed (HTTP ${authRes.status})`);
  const { token } = (await authRes.json()) as { token: string };
  return token;
}

/** Create the off-chain job record (requires a token from `authenticate`). */
export async function createJob(input: CreateJobInput, token: string): Promise<JobApi> {
  const res = await fetch(`${API_BASE_URL}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Could not save the job (HTTP ${res.status})`);
  return (await res.json()) as JobApi;
}

/** Attach the on-chain escrow id to an existing job record. */
export async function linkEscrowId(
  jobId: string,
  escrowId: number,
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/escrow/sync/${jobId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ escrowId }),
  });
  if (!res.ok) throw new Error(`Could not link the escrow (HTTP ${res.status})`);
}
