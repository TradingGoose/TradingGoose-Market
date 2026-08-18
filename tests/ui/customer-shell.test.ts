import { describe, expect, it } from "vitest";

import { accountItems, adminItems } from "../../components/app-sidebar";

describe("Market shell navigation", () => {
  it("exposes exactly the three ordered customer destinations", () => {
    expect(accountItems.map(({ title, href }) => ({ title, href }))).toEqual([
      { title: "API Keys", href: "/account/api-keys" },
      { title: "Activity", href: "/account/activity" },
      { title: "Logs", href: "/account/logs" }
    ]);
  });

  it("keeps private key and usage tools inside the admin shell", () => {
    expect(adminItems.slice(0, 2).map(({ title, href }) => ({ title, href }))).toEqual([
      { title: "Admin API Keys", href: "/admin/api-keys" },
      { title: "Private API Usage", href: "/admin/api-usage" }
    ]);
    expect(accountItems.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });
});
