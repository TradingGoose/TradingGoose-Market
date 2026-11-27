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
  scheduleUsageThresholdEmail("user", BigInt(before), BigInt(after), 100n);
  expect(state.after).toHaveBeenCalledTimes(count ? 1 : 0);
  expect(state.recipients).not.toHaveBeenCalled();
  if (count) await state.after.mock.calls[0][0]();
  expect(state.send).toHaveBeenCalledTimes(count);
  for (const [mail] of state.send.mock.calls) {
    expect(mail.text).toContain("Unsubscribe");
    if (mail.subject.startsWith("You're nearing")) {
      expect(mail.html).toContain(`TradingGoose Market: You&#x27;re at ${after}% of your PAYG monthly budget`);
    } else {
      expect(mail.html).toContain("TradingGoose Market: PAYG is nearing its included usage");
    }
    expect(mail.html).toContain("/account/api-keys?billing=");
    const url = new URL(mail.headers["List-Unsubscribe"].slice(1, -1));
    expect(url.pathname).toBe("/api/billing/notifications/unsubscribe");
    expect(validNotificationToken(recipient.email, url.searchParams.get("token")!)).toBe(true);
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
it("binds the three-part token to the email and category", () => {
  const token = notificationToken(recipient.email);
  expect(validNotificationToken("other@example.com", token)).toBe(false);
  for (const bad of [token.slice(1), token + ":more", token.replace(":notifications", ""), token.replace("notifications", "all")])
    expect(validNotificationToken(recipient.email, bad)).toBe(false);
});
