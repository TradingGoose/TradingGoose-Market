// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Unsubscribe } from "@/components/billing/unsubscribe";
import { billingSettingsKeys } from "@/hooks/queries/billing-settings";
import { account, billingFixture, billingPath, deferred, editLimit, limitPath, prefPath, release, renderSettings, reopen } from "../helpers/billing-ui";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const toggle = () => screen.getByRole("switch", { name: "Usage notifications" });
it.each([true, false])("keeps the preview across unmount, rejects another toggle and settles (success=%s)", async success => {
  const f = billingFixture();
  renderSettings(f.client);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  const gate = f.hold("PATCH", prefPath);
  act(() => { fireEvent.click(toggle()); fireEvent.click(toggle()); });
  await screen.findByText("Saving usage notification preference…");
  await reopen();
  expect(f.client.isMutating({ mutationKey: billingSettingsKeys.settings(account.id) })).toBe(1);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(toggle().hasAttribute("disabled")).toBe(true);
  fireEvent.click(toggle());
  expect(f.count("PATCH", prefPath)).toBe(1);
  expect(screen.getByRole("button", { name: "Edit limit" }).hasAttribute("disabled")).toBe(false);
  await release(gate, success);
  await waitFor(() => expect(toggle().hasAttribute("disabled")).toBe(false));
  expect(toggle().getAttribute("aria-checked")).toBe(String(!success));
  fireEvent.click(toggle());
  await waitFor(() => expect(f.count("PATCH", prefPath)).toBe(2));
  await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe(String(success)));
});
it("rolls back only the preference on failure and gives retry feedback", async () => {
  const f = billingFixture(), gate = f.hold("PATCH", prefPath);
  renderSettings(f.client);
  fireEvent.click(toggle());
  await screen.findByText("Saving usage notification preference…");
  await release(gate, false);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Couldn’t update usage notifications. Try the switch again.");
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("$25")).toBeTruthy();
});
it.each([true, false])("reconciles a committed PATCH whose response is lost (mounted=%s)", async mounted => {
  const f = billingFixture(), gate = f.hold("PATCH", prefPath);
  const view = renderSettings(f.client);
  const transport = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementationOnce(async (url, init) => {
    await transport(url, init);
    throw new TypeError("Response lost");
  });
  fireEvent.click(toggle());
  await screen.findByText("Saving usage notification preference…");
  if (!mounted) view.unmount();
  await release(gate);
  await waitFor(() => expect(f.client.isMutating()).toBe(0));
  expect(f.server.preference).toBe(false);
  if (!mounted) {
    expect(f.count("GET", prefPath)).toBe(0);
    renderSettings(f.client);
  }
  await waitFor(() => {
    expect(f.count("GET", prefPath)).toBe(1);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  expect([f.count("PATCH", prefPath), f.count("GET", billingPath), f.count("GET", limitPath)]).toEqual([1, 0, 0]);
});
it("keeps both controls busy across a real reopen and restores each independently", async () => {
  const f = billingFixture(), limit = f.hold("PUT", limitPath), pref = f.hold("PATCH", prefPath);
  renderSettings(f.client);
  editLimit("50"); fireEvent.click(toggle());
  await screen.findByText("Saving usage notification preference…");
  await reopen();
  expect(f.client.isMutating()).toBe(2);
  expect(screen.getByRole("button", { name: "Saving limit" }).hasAttribute("disabled")).toBe(true);
  expect(toggle().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("$50")).toBeTruthy();
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  await release(limit, false);
  await screen.findByText("$25");
  expect(toggle().hasAttribute("disabled")).toBe(true);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  await release(pref);
  await waitFor(() => expect(toggle().hasAttribute("disabled")).toBe(false));
  expect([f.count("PUT", limitPath), f.count("PATCH", prefPath)]).toEqual([1, 1]);
});
it("confirms signed optional-mail choices and renders pending, success and invalid links", async () => {
  const post = deferred<Response>();
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? post.promise : Response.json({ currentPreferences: {} }));
  vi.stubGlobal("fetch", fetcher);
  const first = render(<Unsubscribe email={account.email} token="test-token" />);
  const choice = await screen.findByRole("button", { name: "Unsubscribe from Notifications" });
  expect(screen.getByRole("button", { name: "Unsubscribe from All Marketing Emails" })).toBeTruthy();
  fireEvent.click(choice);
  expect(choice.hasAttribute("disabled")).toBe(true);
  expect(choice.getAttribute("aria-busy")).toBe("true");
  expect(choice.textContent).toBe("Unsubscribe from Notifications");
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({ email: account.email, token: "test-token", type: "notifications" });
  await act(async () => { post.resolve(Response.json({ success: true })); });
  expect(await screen.findByText("Successfully Unsubscribed")).toBeTruthy();
  first.unmount();
  fetcher.mockResolvedValueOnce(Response.json({}, { status: 400 }));
  render(<Unsubscribe email={account.email} token="invalid" />);
  expect(await screen.findByText("Invalid Unsubscribe Link")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
it.each([true, false])("keeps signed unsubscribe choices available after a failed POST (notifications already off=%s)", async alreadyOff => {
  const retry = deferred<Response>();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ currentPreferences: { unsubscribeNotifications: alreadyOff } }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockReturnValueOnce(retry.promise);
  vi.stubGlobal("fetch", fetcher);
  render(<Unsubscribe email={account.email} token="signed" />);
  const all = await screen.findByRole("button", { name: "Unsubscribe from All Marketing Emails" });
  const notifications = screen.getByRole("button", { name: /from Notifications/ });
  fireEvent.click(alreadyOff ? all : notifications);
  expect((await screen.findByRole("alert")).textContent).toBe("Failed to process unsubscribe request");
  expect(all.hasAttribute("disabled")).toBe(false);
  expect(notifications.hasAttribute("disabled")).toBe(alreadyOff);
  fireEvent.click(all);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(all.hasAttribute("disabled") && notifications.hasAttribute("disabled")).toBe(true);
  expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toEqual({ email: account.email, token: "signed", type: "all" });
  await act(async () => { retry.resolve(Response.json({ success: true })); });
  await screen.findByText("Successfully Unsubscribed");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
