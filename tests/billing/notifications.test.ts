import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ after: vi.fn<(task: () => Promise<void>) => void>(), recipients: vi.fn(), send: vi.fn(), enabled: true }));
vi.mock("next/server", () => ({ after: state.after }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => ({ billing: { enabled: state.enabled }, appUrl: "https://market.test",
  betterAuth: { secret: "test" }, resend: { apiKey: "test", fromEmail: "sender@example.com" } }) }));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => {
  const query = { from: () => query, innerJoin: () => query, where: () => query, limit: state.recipients };
  return { select: () => query };
} }));
vi.mock("resend", () => ({ Resend: class { emails = { send: state.send }; } }));
import { scheduleUsageThresholdEmail } from "@/lib/billing/notifications";
import { notificationToken, validNotificationToken } from "@/lib/billing/notification-token";

const recipient = { name: "Amy", email: "amy@example.com", enabled: true, preferences: {} };
beforeEach(() => {
  state.enabled = true;
  state.after.mockReset();
  state.send.mockReset().mockResolvedValue({ data: { id: "sent" } });
  state.recipients.mockReset().mockResolvedValue([recipient]);
});
it.each([[79, 80, 1], [89, 90, 1], [79, 95, 2], [80, 89, 0], [90, 99, 0]])("sends on crossing %s to %s", async (before, after, count) => {
  scheduleUsageThresholdEmail("user", BigInt(before) * 1_000_000_000n, BigInt(after) * 1_000_000_000n, 100_000_000_000n);
  expect(state.after).toHaveBeenCalledTimes(count ? 1 : 0);
  expect(state.recipients).not.toHaveBeenCalled();
  if (count) await state.after.mock.calls[0][0]();
  expect(state.send).toHaveBeenCalledTimes(count);
  if (before < 90 && after >= 90) {
    expect(state.send.mock.calls.map(([mail]) => mail.subject)).toContain("You're nearing your spending limit on TradingGoose Market");
  }
  for (const [mail] of state.send.mock.calls) {
    expect(mail.text).toContain("Unsubscribe");
    if (mail.subject === "You're nearing your monthly budget on TradingGoose Market") {
      expect(mail.html).toContain(`TradingGoose Market: You&#x27;re at ${after}% of your PAYG monthly budget`);
    } else {
      expect(mail.subject).toBe("You're nearing your spending limit on TradingGoose Market");
      expect(mail.html).toContain(`TradingGoose Market: You&#x27;re at ${after}% of your spending limit`);
      for (const body of [mail.text, mail.html.replaceAll("<!-- -->", "")]) {
        expect(body).toContain(`$${after}.00 of your $100.00 spending limit (${after}%)`);
        expect(body).toContain("Review limits");
        expect(body).toContain("We send this once when your usage reaches 90% of your spending limit.");
        expect(body).toContain("/account/api-keys?billing=upgrade");
        expect(body).not.toMatch(/included|billing tiers|upgrade threshold/i);
      }
    }
    expect(mail.html).toContain("/account/api-keys?billing=");
    const url = new URL(mail.headers["List-Unsubscribe"].slice(1, -1));
    expect(url.pathname).toBe("/api/billing/notifications/unsubscribe");
    expect([...url.searchParams.keys()]).toEqual(["email", "token"]);
    expect(url.searchParams.get("email")).toBe(recipient.email);
    expect(validNotificationToken("user", recipient.email, url.searchParams.get("token")!)).toBe(true);
    expect(mail.text).toContain(`/unsubscribe?${url.searchParams}`);
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  }
});
it.each([[], [{ ...recipient, enabled: false }], [{ ...recipient, preferences: { unsubscribeNotifications: true } }],
  [{ ...recipient, preferences: { unsubscribeAll: true } }]])("honors recipient preferences", async (...rows) => {
  scheduleUsageThresholdEmail("user", 0n, 99n, 100n);
  state.recipients.mockResolvedValue(rows);
  await state.after.mock.calls[0][0]();
  expect(state.send).not.toHaveBeenCalled();
});
it("skips disabled and zero limits before scheduling delivery", () => {
  scheduleUsageThresholdEmail("user", 0n, 99n, 0n);
  state.enabled = false;
  scheduleUsageThresholdEmail("user", 0n, 99n, 100n);
  expect(state.after).not.toHaveBeenCalled();
  expect(state.recipients).not.toHaveBeenCalled();
});
it("binds the three-part notification token to the account and email", () => {
  const token = notificationToken("user", recipient.email);
  expect(token).toMatch(/^[a-f0-9]{32}:[a-f0-9]{64}:notifications$/);
  expect(validNotificationToken("user", recipient.email, token)).toBe(true);
  expect(validNotificationToken("other", recipient.email, token)).toBe(false);
  expect(validNotificationToken("user", "other@example.com", token)).toBe(false);
  const emailOnlyToken = "00000000000000000000000000000000:f924372ccf916b7184b256658951ec55982fa191b6bfde9f8c5391b1ebede9e3:notifications";
  for (const bad of [emailOnlyToken, token.slice(1), token + ":more", token.replace(":notifications", ""), token.replace("notifications", "all")])
    expect(validNotificationToken("user", recipient.email, bad)).toBe(false);
});
