/**
 * Dashboard.tsx
 *
 * Shows the connected wallet's active jobs (as client and as freelancer).
 *
 * TODO:
 * - Connect Freighter wallet on mount, read public key.
 * - Query Horizon event stream for EscrowCreated events filtered by user address.
 * - Render job cards with status badges.
 */

export default function Dashboard() {
  return (
    <main>
      <h1>My Jobs</h1>
      {/* TODO: WalletConnect button */}
      {/* TODO: JobCard list */}
      <p>Connect your Freighter wallet to see your jobs.</p>
    </main>
  );
}
