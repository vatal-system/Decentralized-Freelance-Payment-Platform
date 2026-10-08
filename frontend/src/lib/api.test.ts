import { describe, expect, it } from "vitest";
import { buildJobsQuery } from "./api";

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
