import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import FreelancerDirectory from "./FreelancerDirectory";
import * as api from "../lib/api";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    fetchFreelancers: vi.fn(),
  };
});

describe("FreelancerDirectory component (#68)", () => {
  const mockFreelancers: api.FreelancerApi[] = [
    {
      id: "f-1",
      stellarAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      displayName: "Alice Stellar",
      bio: "Smart contract auditor and developer",
      createdAt: "2026-01-01T00:00:00Z",
      averageScore: 4.95,
      totalRatings: 12,
      completedJobsCount: 8,
      totalJobsCount: 10,
    },
    {
      id: "f-2",
      stellarAddress: "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B",
      displayName: "Bob Designer",
      bio: "Web3 product designer",
      createdAt: "2026-02-01T00:00:00Z",
      averageScore: 3.5,
      totalRatings: 4,
      completedJobsCount: 3,
      totalJobsCount: 4,
    },
    {
      id: "f-3",
      stellarAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      displayName: null,
      bio: null,
      createdAt: "2026-03-01T00:00:00Z",
      averageScore: 0,
      totalRatings: 0,
      completedJobsCount: 0,
      totalJobsCount: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders directory heading and lists freelancers with reputation score", async () => {
    vi.mocked(api.fetchFreelancers).mockResolvedValue({
      freelancers: mockFreelancers,
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    render(
      <BrowserRouter>
        <FreelancerDirectory />
      </BrowserRouter>,
    );

    expect(screen.getByText("Freelancer Directory")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Alice Stellar")).toBeDefined();
      expect(screen.getByText("Bob Designer")).toBeDefined();
      expect(screen.getByText("Anonymous Freelancer")).toBeDefined();
    });

    // Verify reputation scores are displayed
    expect(screen.getByText("★ 4.95 / 5")).toBeDefined();
    expect(screen.getByText("★ 3.50 / 5")).toBeDefined();
    expect(screen.getByText("No ratings yet")).toBeDefined();

    // Verify ratings count and completed jobs count
    expect(screen.getByText(/12 ratings/)).toBeDefined();
    expect(screen.getByText(/8 jobs completed/)).toBeDefined();
    expect(screen.getByText(/4 ratings/)).toBeDefined();
    expect(screen.getByText(/3 jobs completed/)).toBeDefined();
  });

  it("links each freelancer entry to their existing Profile page", async () => {
    vi.mocked(api.fetchFreelancers).mockResolvedValue({
      freelancers: mockFreelancers,
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    render(
      <BrowserRouter>
        <FreelancerDirectory />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Stellar")).toBeDefined();
    });

    const links = screen.getAllByRole("link", { name: /view profile/i });
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute("href")).toBe(
      `/profile/${mockFreelancers[0].stellarAddress}`,
    );
    expect(links[1].getAttribute("href")).toBe(
      `/profile/${mockFreelancers[1].stellarAddress}`,
    );
    expect(links[2].getAttribute("href")).toBe(
      `/profile/${mockFreelancers[2].stellarAddress}`,
    );

    const hireLinks = screen.getAllByRole("link", { name: /hire on job/i });
    expect(hireLinks).toHaveLength(3);
    expect(hireLinks[0].getAttribute("href")).toBe(
      `/post?freelancer=${mockFreelancers[0].stellarAddress}`,
    );
  });

  it("allows sorting by reputation score and completed jobs", async () => {
    vi.mocked(api.fetchFreelancers).mockResolvedValue({
      freelancers: mockFreelancers,
      total: 3,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    render(
      <BrowserRouter>
        <FreelancerDirectory />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alice Stellar")).toBeDefined();
    });

    const select = screen.getByLabelText("Sort freelancers by");

    // Change sort to lowest reputation first
    fireEvent.change(select, { target: { value: "rep_asc" } });

    await waitFor(() => {
      expect(api.fetchFreelancers).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: "reputation",
          sortOrder: "asc",
        }),
        expect.anything(),
      );
    });

    // Change sort to most completed jobs
    fireEvent.change(select, { target: { value: "jobs_desc" } });

    await waitFor(() => {
      expect(api.fetchFreelancers).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: "jobs",
          sortOrder: "desc",
        }),
        expect.anything(),
      );
    });
  });

  it("supports search by name, bio, or address", async () => {
    vi.mocked(api.fetchFreelancers).mockResolvedValue({
      freelancers: [mockFreelancers[0]],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    render(
      <BrowserRouter>
        <FreelancerDirectory />
      </BrowserRouter>,
    );

    const input = screen.getByPlaceholderText(/search name, bio, or address/i);
    const searchButton = screen.getByRole("button", { name: "Search" });

    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(api.fetchFreelancers).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "Alice",
        }),
        expect.anything(),
      );
    });
  });

  it("displays empty state when no freelancers match", async () => {
    vi.mocked(api.fetchFreelancers).mockResolvedValue({
      freelancers: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 1,
    });

    render(
      <BrowserRouter>
        <FreelancerDirectory />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no freelancers currently registered/i)).toBeDefined();
    });
  });

  it("displays error alert when fetch fails", async () => {
    vi.mocked(api.fetchFreelancers).mockRejectedValue(new Error("Network connection failed"));

    render(
      <BrowserRouter>
        <FreelancerDirectory />
      </BrowserRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText("Network connection failed")).toBeDefined();
    });
  });
});
