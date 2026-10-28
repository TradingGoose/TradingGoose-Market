import { describe, expect, it } from "vitest";

import { accountItems, adminApiItems, adminDataItems } from "../../components/app-sidebar";

describe("Market shell navigation", () => {
  it("exposes exactly the three ordered customer destinations", () => {
    expect(accountItems.map(({ title, href }) => ({ title, href }))).toEqual([
      { title: "API Keys", href: "/account/api-keys" },
      { title: "Activity", href: "/account/activity" },
      { title: "Logs", href: "/account/logs" }
    ]);
  });

  it("separates private API access from data management without changing customer navigation", () => {
    expect(adminApiItems.map(({ title, href }) => ({ title, href }))).toEqual([
      { title: "API Keys", href: "/admin/api-keys" },
      { title: "Activity", href: "/admin/activity" },
      { title: "Logs", href: "/admin/logs" }
    ]);
    expect(adminDataItems).toHaveLength(10);
    expect(adminDataItems.every((item) => !adminApiItems.some((apiItem) => apiItem.href === item.href))).toBe(true);
    expect(accountItems.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });
});
