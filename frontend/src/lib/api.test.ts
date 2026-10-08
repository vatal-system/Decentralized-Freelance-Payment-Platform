import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticate, buildJobsQuery, createJob } from "./api";

describe("buildJobsQuery", () => {
  it("omits empty filters", () => {
    expect(buildJobsQuery()).toBe("");
    expect(buildJobsQuery({ status: "", client: "", freelancer: "" })).toBe("");
  });

  it("encodes the status filter", () => {
    expect(buildJobsQuery({ status: "ACTIVE" })).toBe("?status=ACTIVE");
  });

  it("encodes pagination and all filters together", () => {
    const qs = buildJobsQuery({
      status: "COMPLETED",
      client: "GABCD",
      freelancer: "GEFGH",
      page: 2,
      limit: 10,
    });
    const params = new URLSearchParams(qs);
    expect(params.get("status")).toBe("COMPLETED");
    expect(params.get("client")).toBe("GABCD");
    expect(params.get("freelancer")).toBe("GEFGH");
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe("10");
    expect(qs.startsWith("?")).toBe(true);
  });
});

describe("authenticate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs the challenge nonce and returns the token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "nonce-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "jwt-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => "sig-base64");

    const token = await authenticate("GCLIENT", signMessage);

    expect(token).toBe("jwt-1");
    expect(signMessage).toHaveBeenCalledWith("nonce-1");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/users/challenge?address=GCLIENT");
    const authBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(authBody).toEqual({
      address: "GCLIENT",
      signature: "sig-base64",
      nonce: "nonce-1",
    });
  });
});

describe("createJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the job with the chosen asset and a bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "job-1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const job = await createJob(
      {
        title: "Redesign",
        description: "A longer description",
        asset: "XLM",
        milestones: [{ amountUsdc: 1.5 }],
      },
      "jwt-1",
    );

    expect(job.id).toBe("job-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/jobs");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(init.body as string).asset).toBe("XLM");
  });
});
