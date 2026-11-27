import { afterEach, expect, it, vi } from "vitest";
import { marketApiRequest, MarketApiError } from "@/hooks/use-market-resource";

afterEach(() => vi.unstubAllGlobals());
it("preserves the transport message and status alongside the explicit machine code", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Set up a payment method", code: "PAYMENT_METHOD_REQUIRED" }, { status: 409 })));
  const error = await marketApiRequest("/api/account/billing/payg/activate").catch(error => error);
  expect(error).toBeInstanceOf(MarketApiError);
  expect(error).toMatchObject({ code: "Set up a payment method", message: "Set up a payment method", status: 409, responseCode: "PAYMENT_METHOD_REQUIRED" });
});
