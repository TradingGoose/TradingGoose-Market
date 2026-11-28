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
  paymentIntents: { retrieve: vi.fn() },
  charges: { retrieve: vi.fn() },
};
const otherCard = { card: { last4: "9999" } };
const invoice = { id: "in_1", amount_due: 1234, customer: { id: "cus_1", invoice_settings: { default_payment_method: otherCard } },
  default_payment_method: otherCard, hosted_invoice_url: "https://invoice.stripe.com/payment" };
const failedCharge = { status: "failed", failure_message: "Card expired", payment_method_details: { card: { last4: "4321" } } };
const payments = (type: "payment_intent" | "charge", ref: unknown) => ({ payments: { data: [{ is_default: true, payment: { type, [type]: ref } }] } });
const send = (changes = {}) => sendMarketPaymentFailureEmail(provider as unknown as Stripe, "user", { ...invoice, ...changes } as Stripe.Invoice);
beforeEach(() => {
  vi.clearAllMocks();
  state.recipients.mockResolvedValue([{ name: "Amy", email: "amy@example.com", billingUsageNotificationsEnabled: false,
    emailPreferences: { unsubscribeAll: true, unsubscribeNotifications: true } }]);
  state.send.mockResolvedValue({ data: { id: "sent" } });
});
it("reports the failed attempt's card despite conflicting defaults and all usage opt-outs", async () => {
  await send({ last_finalization_error: { message: "Payment refused" }, ...payments("payment_intent", {
    payment_method: otherCard, last_payment_error: { message: "Declined", payment_method: { card: { last4: "1234" } } },
  }) });
  const [mail] = state.send.mock.calls[0];
  expect(mail.subject).toBe("TradingGoose Market payment failed - action required");
  expect(mail.headers).toBeUndefined();
  for (const text of ["Amy", "$12.34", "1234", "Payment refused", invoice.hosted_invoice_url]) expect(mail.html).toContain(text);
  expect(mail.html).toMatch(/<a[^>]*href="https:\/\/invoice\.stripe\.com\/payment"[^>]*>.*?Pay Invoice.*?<\/a>/s);
  for (const body of [mail.html.replaceAll("<!-- -->", ""), mail.text]) {
    expect(body).toContain("To restore access, please pay all outstanding usage invoices.");
    expect(body).toContain("**** 1234");
    expect(body).not.toContain("9999");
    expect(body).not.toMatch(/immediately|automatically retry|update payment method/i);
  }
  expect(mail.text).toContain(`Pay Invoice ${invoice.hosted_invoice_url}`);
  expect(mail.text).not.toMatch(/unsubscribe/i);
  expect(provider.paymentIntents.retrieve).not.toHaveBeenCalled();
});
it("retrieves the specific failed charge from the invoice PaymentIntent even when the latest charge differs", async () => {
  provider.paymentIntents.retrieve.mockResolvedValueOnce({ payment_method: otherCard, latest_charge: "ch_other",
    last_payment_error: { message: "Declined", charge: "ch_failed" } });
  provider.charges.retrieve.mockResolvedValueOnce(failedCharge);
  await send(payments("payment_intent", "pi_invoice"));
  expect(provider.paymentIntents.retrieve).toHaveBeenCalledWith("pi_invoice");
  expect(provider.charges.retrieve.mock.calls).toEqual([["ch_failed"]]);
  expect(state.send.mock.calls[0][0].text).toContain("**** 4321");
  expect(state.send.mock.calls[0][0].text).toContain("Declined");
});
it.each([payments("charge", "ch_failed"), payments("charge", failedCharge),
  payments("payment_intent", { latest_charge: failedCharge })])("uses a failed Charge snapshot from the invoice payment", async link => {
  provider.charges.retrieve.mockResolvedValue(failedCharge);
  await send(link);
  expect(state.send.mock.calls[0][0].text).toContain("**** 4321");
  expect(state.send.mock.calls[0][0].text).toContain("Card expired");
});
it.each([{}, payments("payment_intent", { payment_method: otherCard, last_payment_error: { message: "Declined" } }),
  payments("payment_intent", { last_payment_error: { payment_method: { type: "us_bank_account" } }, latest_charge: failedCharge }),
  payments("charge", { ...failedCharge, payment_method_details: { card: { last4: null } } }),
  payments("charge", { ...failedCharge, status: "succeeded" }),
  { payments: { data: [1, 2].map(() => ({ is_default: false, payment: { type: "charge", charge: failedCharge } })) } },
])("omits card digits without a failed card attributable to this invoice attempt", async link => {
  await send(link);
  expect(state.send.mock.calls[0][0].text).not.toMatch(/Payment method:|9999|4321/);
});
it("sends the hosted link and known failure reason when the charge lookup is unavailable", async () => {
  provider.charges.retrieve.mockRejectedValueOnce(new Error("Charge unavailable"));
  await send({ last_finalization_error: { message: "Payment refused" }, ...payments("charge", "ch_failed") });
  const body = state.send.mock.calls[0][0].text;
  expect(body).toContain(invoice.hosted_invoice_url);
  expect(body).toContain("Payment refused");
  expect(body).not.toContain("****");
});
it("skips missing recipients or payment links", async () => {
  await send({ hosted_invoice_url: null });
  state.recipients.mockResolvedValue([]);
  await send();
  expect(state.send).not.toHaveBeenCalled();
});
