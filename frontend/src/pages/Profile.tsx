/**
 * Profile.tsx
 *
 * Displays a user's on-chain reputation score and completed job history.
 *
 * TODO:
 * - Call reputation.get_aggregate(address) to fetch score.
 * - List completed escrows where address was client or freelancer.
 * - Show "Leave a Rating" button for completed jobs not yet rated.
 */

import { useParams } from "react-router-dom";

export default function Profile() {
  const { address } = useParams<{ address: string }>();

  // TODO: fetch aggregate reputation
  // TODO: fetch job history

  return (
    <main>
      <h1>Profile</h1>
      <p>Address: {address}</p>
      {/* TODO: ReputationScore component */}
      {/* TODO: JobHistoryList */}
    </main>
  );
}
