/**
 * App.tsx
 *
 * Root component. Defines top-level routes.
 *
 * Routes:
 *   /              → Dashboard (active jobs overview)
 *   /post          → PostJob (client creates a new escrow)
 *   /jobs/:id      → JobDetail (milestone tracker, dispute button)
 *   /profile/:addr → Profile (reputation score, job history)
 */

import { BrowserRouter, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import PostJob from "./pages/PostJob";
import JobDetail from "./pages/JobDetail";
import Profile from "./pages/Profile";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/post" element={<PostJob />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/profile/:address" element={<Profile />} />
      </Routes>
    </BrowserRouter>
  );
}
