import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createAndSettleUsageInvoice } from "../../lib/billing/threshold-billing";

describe("usage settlement subscription retrieval", () => {
  it("propagates exact-current retrieval failure before Customer or invoice work", async () => {
    const unavailable = new Error("subscription retrieval unavailable");
    const stripe = settlementStripe({ subscriptionError: unavailable });

    await expect(
      createAndSettleUsageInvoice(stripe.client, settlementInput()),
    ).rejects.toBe(unavailable);

    expect(stripe.customerRetrieve).not.toHaveBeenCalled();
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
  });

  it("uses only the signed deleted snapshot for final-deletion fallback", async () => {
    const stripe = settlementStripe({
      subscriptionError: new Error("deleted subscription is no longer retrievable"),
    });
    const deletedSnapshot = {
      id: "sub_provider",
      customer: "cus_1",
      status: "canceled",
      default_payment_method: null,
    } as Stripe.Subscription;

    await expect(
      createAndSettleUsageInvoice(stripe.client, {
        ...settlementInput(),
        deletedSubscriptionSnapshot: deletedSnapshot,
      }),
    ).resolves.toBe("in_draft");

    expect(stripe.subscriptionRetrieve).not.toHaveBeenCalled();
    expect(stripe.customerRetrieve).toHaveBeenCalledWith("cus_1");
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
  });

  it("requires the payment response to be definitively paid", async () => {
    const stripe = settlementStripe({ paymentStatus: "open" });

    await expect(
      createAndSettleUsageInvoice(stripe.client, settlementInput()),
    ).rejects.toThrow("payment did not complete");
  });

  it("uses the current paid invoice instead of replaying a cached draft response", async () => {
    const stripe = settlementStripe({ currentStatus: "paid" });

    await expect(
      createAndSettleUsageInvoice(stripe.client, settlementInput()),
    ).resolves.toBe("in_draft");

    expect(stripe.finalizeInvoice).not.toHaveBeenCalled();
    expect(stripe.payInvoice).not.toHaveBeenCalled();
  });
});

function settlementInput() {
  return {
    customerId: "cus_1",
    stripeSubscriptionId: "sub_provider",
    amountCents: 100,
    itemIdempotencyKey: "item_once",
    invoiceIdempotencyKey: "invoice_once",
    description: "Usage",
    itemDescription: "Usage item",
    metadata: { type: "usage" },
  };
}

function settlementStripe(input: {
  subscriptionError?: Error;
  currentStatus?: "draft" | "paid";
  paymentStatus?: "open" | "paid";
} = {}) {
  const subscriptionRetrieve = vi.fn(async () => {
    if (input.subscriptionError) throw input.subscriptionError;
    return {
      id: "sub_provider",
      customer: "cus_1",
      default_payment_method: "pm_subscription",
    };
  });
  const customerRetrieve = vi.fn(async () => ({
    id: "cus_1",
    invoice_settings: { default_payment_method: "pm_customer" },
  }));
  const invoiceCreate = vi.fn(async () => ({ id: "in_draft", status: "draft" }));
  let retrievedAfterFinalize = false;
  const invoiceRetrieve = vi.fn(async () => ({
    id: "in_draft",
    status:
      input.currentStatus ?? (retrievedAfterFinalize ? "open" : "draft"),
  }));
  const finalizeInvoice = vi.fn(async () => {
    retrievedAfterFinalize = true;
    return { id: "in_draft", status: "open" };
  });
  const payInvoice = vi.fn(async () => ({
    id: "in_draft",
    status: input.paymentStatus ?? "paid",
  }));
  const client = {
    subscriptions: { retrieve: subscriptionRetrieve },
    customers: { retrieve: customerRetrieve },
    invoices: {
      create: invoiceCreate,
      retrieve: invoiceRetrieve,
      finalizeInvoice,
      pay: payInvoice,
    },
    invoiceItems: { create: vi.fn(async () => ({ id: "ii_1" })) },
  } as unknown as Stripe;
  return {
    client,
    subscriptionRetrieve,
    customerRetrieve,
    invoiceCreate,
    finalizeInvoice,
    payInvoice,
  };
}
