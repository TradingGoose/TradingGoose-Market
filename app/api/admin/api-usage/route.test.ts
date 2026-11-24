import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getActivity: vi.fn(),
  getLogs: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  apiRequireSystemAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/usage/queries", () => ({
  getAdminActivity: mocks.getActivity,
  getAdminLogs: mocks.getLogs,
}));

import { GET } from "./route";

describe("admin usage route view contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ user: { id: "admin-user" } });
  });

  it("returns a discriminated activity envelope", async () => {
    mocks.getActivity.mockResolvedValue({ totalRequests: 7 });
    const response = await GET(new Request(
      "https://market.example/api/admin/api-usage?view=activity&range=7d&granularity=day",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      view: "activity",
      data: { totalRequests: 7 },
    });
    expect(mocks.getActivity).toHaveBeenCalledWith(expect.objectContaining({
      range: "7d",
      granularity: "day",
    }));
    expect(mocks.getLogs).not.toHaveBeenCalled();
  });

  it("returns a discriminated logs envelope", async () => {
    mocks.getLogs.mockResolvedValue({ rows: [], nextCursor: null });
    const response = await GET(new Request(
      "https://market.example/api/admin/api-usage?view=logs&range=7d&limit=50",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      view: "logs",
      data: { rows: [], nextCursor: null },
    });
    expect(mocks.getLogs).toHaveBeenCalledWith(expect.objectContaining({
      range: "7d",
      limit: 50,
    }));
    expect(mocks.getActivity).not.toHaveBeenCalled();
  });

  it.each([
    "view=activity&limit=50",
    "view=logs&granularity=day",
  ])("rejects parameters owned by the other view: %s", async (query) => {
    const response = await GET(new Request(
      `https://market.example/api/admin/api-usage?${query}`,
    ));

    expect(response.status).toBe(400);
    expect(mocks.getActivity).not.toHaveBeenCalled();
    expect(mocks.getLogs).not.toHaveBeenCalled();
  });
});
