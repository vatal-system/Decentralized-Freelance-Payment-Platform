/**
 * PostJob.tsx
 *
 * Client form to create a new escrow job with milestone breakdown.
 *
 * Flow:
 *   1. Enter freelancer address, job title, milestones (amount + deadline each).
 *   2. Approve USDC spending allowance (SAC `approve` call).
 *   3. Call escrow.create() → escrow.fund() in sequence.
 *   4. Redirect to /jobs/:newId on success.
 *
 * TODO:
 * - Add form validation (milestone amounts > 0, deadlines in future).
 * - Show estimated Stellar network fee before signing.
 * - Handle USDC allowance check before prompting approval.
 */

import { useState } from "react";
import { useEscrow } from "../hooks/useEscrow";

export default function PostJob() {
  const { createEscrow, loading, error } = useEscrow();
  const [freelancer, setFreelancer] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: collect milestones from dynamic form fields
    await createEscrow(freelancer, [], BigInt(0));
  }

  return (
    <main>
      <h1>Post a Job</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Freelancer Stellar Address
          <input
            value={freelancer}
            onChange={(e) => setFreelancer(e.target.value)}
            placeholder="G..."
            required
          />
        </label>
        {/* TODO: dynamic milestone fields */}
        <button type="submit" disabled={loading}>
          {loading ? "Submitting…" : "Create Escrow"}
        </button>
      </form>
      {error && <p role="alert" style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
