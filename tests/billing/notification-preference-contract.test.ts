import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  stats: { billingUsageNotificationsEnabled: true, emailPreferences: {} as Record<string, boolean> },
  write: vi.fn(), beforeLock: vi.fn(), ownerId: "own" as string | null,
}));
function database() {
  let fields: Record<string, unknown>;
  const rows = () => !state.ownerId ? [] : fields && "currentPreferences" in fields
    ? [{ id: state.ownerId, currentPreferences: state.stats.emailPreferences }]
    : [{ billingUsageNotificationsEnabled: state.stats.billingUsageNotificationsEnabled }];
  const read = { innerJoin: () => read, where: () => read, limit: () => read, from: () => read,
    for: () => read, then: (resolve: (v: unknown) => unknown) => resolve(rows()) };
  return {
    select: (selection: Record<string, unknown>) => { fields = selection; return read; },
    update: () => ({ set: (values: object) => ({ where: () => {
      state.write(values); Object.assign(state.stats, values);
      return { returning: () => rows() };
    } }) }),
  };
}
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => database() }));
vi.mock("@/lib/db/locks", () => ({ withBillingSubjectLock: (id: string, fn: (db: unknown) => unknown) => {
  state.beforeLock(id);
  return fn(database());
} }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => ({ appUrl: "http://market.test", betterAuth: { secret: "secret" } }) }));
vi.mock("@/lib/auth/session", () => ({ apiRequireCustomerSession: () => ({ user: { id: "own" } }) }));
import { GET, PATCH } from "@/app/api/account/billing/notifications/route";
import { GET as preview, POST as unsubscribe } from "@/app/api/billing/notifications/unsubscribe/route";
import { notificationToken } from "@/lib/billing/notification-token";
const url = "http://market.test/api/billing/notifications/unsubscribe";
const email = "amy@example.com";
const link = (token = notificationToken("own", email)) => `${url}?${new URLSearchParams({ email, token })}`;
const json = (body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  state.ownerId = "own"; state.stats.billingUsageNotificationsEnabled = true; state.stats.emailPreferences = {};
  state.write.mockClear(); state.beforeLock.mockReset();
});
it("persists the own-session switch independently of unsubscribe flags", async () => {
  state.stats.emailPreferences = { unsubscribeAll: true };
  expect(await (await GET(new Request(url))).json()).toEqual({ billingUsageNotificationsEnabled: true });
  for (let i = 0; i < 2; i++) {
    expect(await (await PATCH(json({ billingUsageNotificationsEnabled: false }))).json()).toEqual({ billingUsageNotificationsEnabled: false });
    expect(state.write).toHaveBeenLastCalledWith({ billingUsageNotificationsEnabled: false, updatedAt: expect.any(Date) });
  }
  expect((await PATCH(json({ userId: "other", billingUsageNotificationsEnabled: true }))).status).toBe(400);
  expect((await PATCH(json({ billingUsageNotificationsEnabled: "false" }))).status).toBe(400);
});
it("GET previews JSON or redirects an HTML navigation without writing", async () => {
  expect(await (await preview(new Request(link(), { headers: { accept: "application/json" } }))).json()).toMatchObject({ success: true, currentPreferences: {} });
  expect((await preview(new Request(link(), { headers: { accept: "text/html" } }))).headers.get("location")).toContain("http://market.test/unsubscribe?");
  expect((await preview(new Request(url))).status).toBe(400);
  expect(state.write).not.toHaveBeenCalled();
});
it.each(["form", "multipart"])("accepts signed %s one-click and replay without cookies", async encoding => {
  state.stats.emailPreferences = { unsubscribeAll: true };
  for (let i = 0; i < 2; i++) {
    const body = encoding === "form" ? new URLSearchParams() : new FormData();
    body.set("List-Unsubscribe", "One-Click");
    const result = await unsubscribe(new Request(link(), { method: "POST", body }));
    expect(result.status).toBe(200); expect(result.headers.has("location")).toBe(false); expect(await result.text()).toBe("");
  }
  expect(state.stats).toMatchObject({ billingUsageNotificationsEnabled: true, emailPreferences: { unsubscribeAll: true, unsubscribeNotifications: true } });
});
it("validates JSON confirmation and rejects token substitution or missing state", async () => {
  const token = notificationToken("own", email);
  expect((await unsubscribe(json({ email: "other@example.com", token, type: "all" }))).status).toBe(400);
  expect((await unsubscribe(json({ email, token, type: "marketing" }))).status).toBe(400);
  expect(state.write).not.toHaveBeenCalled();
  expect(await (await unsubscribe(json({ email, token, type: "all" }))).json()).toMatchObject({ success: true, type: "all" });
  state.ownerId = null;
  expect((await unsubscribe(json({ email, token, type: "all" }))).status).toBe(400);
});
it("restricts previews, confirmation and one-click to the account that received the link", async () => {
  const token = notificationToken("own", email);
  state.ownerId = "new-owner";
  const responses = [
    await preview(new Request(link(token))),
    await preview(new Request(link(token), { headers: { accept: "text/html" } })),
    await unsubscribe(json({ email, token, type: "all" })),
    await unsubscribe(new Request(link(token), { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) })),
  ];
  for (const response of responses) {
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: "invalid-link" });
  }
  expect(state.beforeLock).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
  const currentToken = notificationToken(state.ownerId, email);
  expect((await preview(new Request(link(currentToken)))).status).toBe(200);
  expect((await unsubscribe(json({ email, token: currentToken, type: "notifications" }))).status).toBe(200);
  expect(state.stats.emailPreferences).toEqual({ unsubscribeNotifications: true });
});
it("rechecks address ownership under the billing lock before a preference write", async () => {
  const token = notificationToken("own", email);
  state.beforeLock.mockImplementationOnce(() => { state.ownerId = "new-owner"; });
  expect((await unsubscribe(json({ email, token, type: "notifications" }))).status).toBe(400);
  expect(state.beforeLock).toHaveBeenCalledWith("own");
  expect(state.write).not.toHaveBeenCalled();
});
