import type Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ recipients: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => ({ resend: { apiKey: "test", fromEmail: "sender@example.com" } }) }));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => {
  const query = { from: () => query, where: () => query, limit: state.recipients };
  return { select: () => query };
} }));
vi.mock("resend", () => ({ Resend: class { emails = { send: state.send }; } }));
import { sendMarketPaymentFailureEmail } from "@/lib/billing/notifications";

const provider = {
  paymentMethods: { retrieve: vi.fn(async () => ({ card: { last4: "1234" } })) },
  customers: { retrieve: vi.fn(async () => ({ invoice_settings: { default_payment_method: "pm_customer" } })) },
  paymentIntents: { retrieve: vi.fn(async () => ({ last_payment_error: { message: "Declined" } })) },
  charges: { retrieve: vi.fn(async () => ({ failure_message: "Card expired" })) },
};
const invoice = { id: "in_1", amount_due: 1234, customer: "cus_1", hosted_invoice_url: "https://invoice.stripe.com/payment" };
const send = (changes = {}) => sendMarketPaymentFailureEmail(provider as unknown as Stripe, "user", { ...invoice, ...changes } as Stripe.Invoice);
beforeEach(() => {
  vi.clearAllMocks();
  state.recipients.mockResolvedValue([{ name: "Amy", email: "amy@example.com", billingUsageNotificationsEnabled: false,
    emailPreferences: { unsubscribeAll: true, unsubscribeNotifications: true } }]);
  state.send.mockResolvedValue({ data: { id: "sent" } });
});
it("includes amount, hosted URL, invoice card and finalization error despite all usage opt-outs", async () => {
  await send({ default_payment_method: "pm_invoice", last_finalization_error: { message: "Payment refused" } });
  const [mail] = state.send.mock.calls[0];
  expect(mail.subject).toBe("TradingGoose Market payment failed - action required");
  expect(mail.headers).toBeUndefined();
  for (const text of ["Amy", "$12.34", "1234", "Payment refused", invoice.hosted_invoice_url]) expect(mail.html).toContain(text);
  expect(mail.text).not.toMatch(/unsubscribe/i);
  expect(provider.customers.retrieve).not.toHaveBeenCalled();
});
it.each([["charge", "Card expired"], ["payment_intent", "Declined"]])("uses customer card and %s failure detail", async (type, reason) => {
  await send({ payments: { data: [{ is_default: true, payment: { type, [type]: "id" } }] } });
  expect(provider.paymentMethods.retrieve).toHaveBeenCalledWith("pm_customer");
  expect(state.send.mock.calls[0][0].text).toContain(reason);
});
it("omits optional details and skips missing recipients or payment links", async () => {
  await send({ customer: null });
  expect(state.send.mock.calls[0][0].text).not.toContain("****");
  await send({ hosted_invoice_url: null });
  state.recipients.mockResolvedValue([]);
  await send();
  expect(state.send).toHaveBeenCalledTimes(1);
});
