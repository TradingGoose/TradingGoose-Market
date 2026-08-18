import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearMarketRuntimeConfigCacheForTests } from "../../lib/environment";
import {
  projectVerifiedEmailToAudience,
  sendMarketAuthEmail,
} from "../../lib/auth/mailer";

const original = new Map<string, string | undefined>();
const environment = {
  DATABASE_URL: "postgres://market:market@localhost:5432/market_test",
  NEXT_PUBLIC_APP_URL: "https://market.example.com",
  BETTER_AUTH_URL: "https://market.example.com",
  BETTER_AUTH_SECRET: "test-secret",
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
  RESEND_AUDIENCE_ID: "audience_1",
  REGISTRATION_MODE: "open",
  BILLING_ENABLED: "false",
  PAYG_USD_PER_1000_READS: "1",
  UNKEY_API_ID: "api_1",
  UNKEY_KEY_MANAGEMENT_ROOT_KEY: "manage_1",
  UNKEY_KEY_VERIFY_ROOT_KEY: "verify_1",
} as const;

beforeEach(() => {
  for (const [key, value] of Object.entries(environment)) {
    original.set(key, process.env[key]);
    process.env[key] = value;
  }
  clearMarketRuntimeConfigCacheForTests();
});

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  original.clear();
  clearMarketRuntimeConfigCacheForTests();
  vi.restoreAllMocks();
});

function client(send: ReturnType<typeof vi.fn>, create = vi.fn()) {
  return { emails: { send }, contacts: { create } } as unknown as Parameters<typeof sendMarketAuthEmail>[1];
}

describe("direct Resend authentication email", () => {
  it("renders and sends the branded OTP through Resend", async () => {
    const send = vi.fn(async () => ({ data: { id: "email_1" }, error: null }));
    await sendMarketAuthEmail(
      { kind: "sign-in-otp", to: "customer@example.com", otp: "012345" },
      client(send),
    );
    expect(send).toHaveBeenCalledOnce();
    const [message] = send.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(message).toEqual(expect.objectContaining({
      from: "TradingGoose Market <market@example.com>",
      to: "customer@example.com",
      subject: "Your TradingGoose Market verification code",
      html: expect.stringContaining("012345"),
      text: expect.stringContaining("012345"),
    }));
  });

  it.each([
    [{ data: null, error: { statusCode: 503, message: "provider detail" } }],
    [{ data: null, error: null }],
  ])("treats returned provider failure as delivery failure %#", async (result) => {
    const send = vi.fn(async () => result);
    await expect(sendMarketAuthEmail(
      { kind: "password-reset", to: "customer@example.com", url: "https://market.example.com/reset?token=opaque" },
      client(send),
    )).rejects.toMatchObject({ name: "AuthEmailDeliveryError", kind: "response" });
  });

  it("redacts thrown provider details", async () => {
    const send = vi.fn(async () => { throw new Error("recipient and secret upstream"); });
    await expect(sendMarketAuthEmail(
      { kind: "email-change-verification", to: "new@example.com", url: "https://market.example.com/verify?token=opaque" },
      client(send),
    )).rejects.toEqual(expect.objectContaining({
      message: "Authentication email delivery failed.",
      kind: "transport",
      status: null,
    }));
  });

  it("projects a normalized verified address and tolerates an existing contact", async () => {
    const create = vi.fn(async () => ({ data: null, error: { statusCode: 409, message: "already exists" } }));
    await projectVerifiedEmailToAudience(
      " ADA@EXAMPLE.COM ",
      { emails: { send: vi.fn() }, contacts: { create } } as unknown as Parameters<typeof projectVerifiedEmailToAudience>[1],
    );
    expect(create).toHaveBeenCalledWith({ audienceId: "audience_1", email: "ada@example.com", unsubscribed: false });
  });
});
