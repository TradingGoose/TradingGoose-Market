import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  stats: { billingUsageNotificationsEnabled: true, emailPreferences: {} as Record<string, boolean> },
  write: vi.fn(), owner: true,
}));
function database() {
  let fields: Record<string, unknown>;
  const rows = () => !state.owner ? [] : fields && "currentPreferences" in fields
    ? [{ id: "own", currentPreferences: state.stats.emailPreferences }]
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
vi.mock("@/lib/db/locks", () => ({ withBillingSubjectLock: (_id: string, fn: (db: unknown) => unknown) => fn(database()) }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => ({ appUrl: "http://market.test", betterAuth: { secret: "secret" } }) }));
vi.mock("@/lib/auth/session", () => ({ apiRequireCustomerSession: () => ({ user: { id: "own" } }) }));
import { GET, PATCH } from "@/app/api/account/billing/notifications/route";
import { GET as preview, POST as unsubscribe } from "@/app/api/billing/notifications/unsubscribe/route";
import { notificationToken } from "@/lib/billing/notification-token";
const url = "http://market.test/api/billing/notifications/unsubscribe";
const email = "amy@example.com";
const link = () => `${url}?${new URLSearchParams({ email, token: notificationToken(email) })}`;
const json = (body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  state.owner = true; state.stats.billingUsageNotificationsEnabled = true; state.stats.emailPreferences = {};
  state.write.mockClear();
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
  const token = notificationToken(email);
  expect((await unsubscribe(json({ email: "other@example.com", token, type: "all" }))).status).toBe(400);
  expect((await unsubscribe(json({ email, token, type: "marketing" }))).status).toBe(400);
  expect(state.write).not.toHaveBeenCalled();
  expect(await (await unsubscribe(json({ email, token, type: "all" }))).json()).toMatchObject({ success: true, type: "all" });
  state.owner = false;
  expect((await unsubscribe(json({ email, token, type: "all" }))).status).toBe(400);
});
