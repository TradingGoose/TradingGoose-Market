import { beforeEach, describe, expect, it, vi } from "vitest";
import * as health from "../../app/api/health/route";
import { requireDatabase } from "@/lib/db/runtime";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: vi.fn(() => ({ execute })),
}));

beforeEach(() => vi.clearAllMocks());

describe("Market health", () => {
  it.each(["GET", "HEAD"] as const)("probes again on the next %s after a query failure", async (method) => {
    execute.mockRejectedValueOnce(new Error("sensitive database failure")).mockResolvedValueOnce([]);
    const url = "https://market.example.com/api/health";
    const failed = await health[method](new Request(url, { method }));
    const recovered = await health[method](new Request(url, { method }));

    expect(execute).toHaveBeenCalledTimes(2);
    expect(failed.status).toBe(503);
    expect(recovered.status).toBe(200);
    for (const response of [failed, recovered]) {
      expect(response.headers.get("x-market-api")).toBe("next");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    if (method === "HEAD") {
      expect(await failed.text()).toBe("");
      expect(await recovered.text()).toBe("");
    } else {
      expect(await failed.json()).toEqual({ status: "unavailable" });
      expect(await recovered.json()).toEqual({
        status: "ok", service: "tradinggoose-market", runtime: "nodejs",
      });
    }
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const)(
    "rejects %s before database access",
    (method) => {
      const response = health[method]();
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
      expect(requireDatabase).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
