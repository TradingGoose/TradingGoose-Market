import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createAndSettleUsageInvoice } from "../../lib/billing/threshold-billing";
import { usageStripeFixture } from "./stripe-usage-fixture";

describe("usage settlement subscription retrieval", () => {
  it("propagates exact-current retrieval failure before Customer or invoice work", async () => {
    const unavailable = new Error("subscription retrieval unavailable");
    const stripe = usageStripeFixture();
    stripe.subscriptionRetrieve.mockRejectedValueOnce(unavailable);

    await expect(
      createAndSettleUsageInvoice(stripe.client, settlementInput()),
    ).rejects.toBe(unavailable);

    expect(stripe.customerRetrieve).not.toHaveBeenCalled();
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
  });

  it("uses only the signed deleted snapshot for final-deletion fallback", async () => {
    const stripe = usageStripeFixture();
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
    ).resolves.toEqual({ fromUsd: "0", throughUsd: "1", requestQuantity: "1000" });

    expect(stripe.subscriptionRetrieve).not.toHaveBeenCalled();
    expect(stripe.customerRetrieve).toHaveBeenCalledWith("cus_1");
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
  });

  it("requires the payment response to be definitively paid", async () => {
    const stripe = usageStripeFixture();
    stripe.state.paymentStatus = "open";

    await expect(
      createAndSettleUsageInvoice(stripe.client, settlementInput()),
    ).rejects.toThrow("payment did not complete");
  });

  it("retries the existing open invoice with a repaired payment method", async () => {
    const stripe = usageStripeFixture();
    stripe.state.paymentFailure = true;
    await expect(createAndSettleUsageInvoice(stripe.client, settlementInput())).rejects.toThrow("Card declined");
    stripe.state.paymentFailure = false;
    stripe.subscriptionRetrieve.mockResolvedValue({
      id: "sub_provider", customer: "cus_1", default_payment_method: "pm_repaired",
    });
    await createAndSettleUsageInvoice(stripe.client, settlementInput());
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledOnce();
    expect(stripe.payInvoice).toHaveBeenLastCalledWith("in_1", { payment_method: "pm_repaired" });
    expect(stripe.charges).toEqual([100]);
  });

  it("uses the current paid invoice instead of replaying a cached draft response", async () => {
    const stripe = usageStripeFixture();
    await createAndSettleUsageInvoice(stripe.client, settlementInput());
    stripe.finalizeInvoice.mockClear();
    stripe.payInvoice.mockClear();
    stripe.invoiceItemsCreate.mockClear();

    await expect(
      createAndSettleUsageInvoice(stripe.client, settlementInput()),
    ).resolves.toEqual({ fromUsd: "0", throughUsd: "1", requestQuantity: "1000" });

    expect(stripe.finalizeInvoice).not.toHaveBeenCalled();
    expect(stripe.payInvoice).not.toHaveBeenCalled();
    expect(stripe.invoiceItemsCreate).not.toHaveBeenCalled();
  });

  it.each(["invoice", "item", "finalize", "pay"] as const)("recovers a lost %s response with the original frozen cycle amount", async point => {
    const stripe = usageStripeFixture();
    stripe.state.lostResponse = point;
    await expect(createAndSettleUsageInvoice(stripe.client, settlementInput())).rejects.toThrow(`${point} response lost`);
    const covered = await createAndSettleUsageInvoice(stripe.client, {
      ...settlementInput(), amountCents: 101,
      snapshot: { fromUsd: "0", throughUsd: "1.01", requestQuantity: "1010" },
    });
    expect(covered).toEqual({ fromUsd: "0", throughUsd: "1", requestQuantity: "1000" });
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledOnce();
    expect(stripe.charges).toEqual([100]);
  });

  it("recovers a paid invoice beyond the first page after idempotency-key expiry", async () => {
    const stripe = usageStripeFixture();
    for (let i = 0; i < 105; i++) stripe.invoices.set(`foreign_${i}`, { id: `foreign_${i}`, customer: "cus_1", metadata: { type: "foreign" } } as unknown as Stripe.Invoice);
    await createAndSettleUsageInvoice(stripe.client, settlementInput());
    stripe.requests.clear();
    await createAndSettleUsageInvoice(stripe.client, settlementInput());
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledOnce();
    expect(stripe.payInvoice).toHaveBeenCalledOnce();
    expect(stripe.charges).toEqual([100]);
  });

  it.each([
    ["overage_threshold_billing", "overage_billing"],
    ["overage_threshold_billing", "final_overage_billing"],
    ["overage_billing", "final_overage_billing"],
  ])("shares creation identity while an invisible %s invoice is retried by %s", async (firstType, nextType) => {
    const stripe = usageStripeFixture();
    stripe.state.lostResponse = "invoice";
    await expect(createAndSettleUsageInvoice(stripe.client, {
      ...settlementInput(), metadata: { ...settlementInput().metadata, type: firstType },
    })).rejects.toThrow("invoice response lost");
    stripe.hiddenInvoiceIds.add("in_1");
    const changed = { ...settlementInput(), amountCents: 101,
      metadata: { ...settlementInput().metadata, type: nextType },
      snapshot: { fromUsd: "0", throughUsd: "1.01", requestQuantity: "1010" } };
    await expect(createAndSettleUsageInvoice(stripe.client, changed)).rejects.toThrow("idempotency parameter mismatch");
    expect(stripe.invoiceCreate.mock.calls[0][1].idempotencyKey)
      .toBe(stripe.invoiceCreate.mock.calls[1][1].idempotencyKey);
    expect(stripe.invoices.size).toBe(1);
    stripe.hiddenInvoiceIds.clear();
    expect(await createAndSettleUsageInvoice(stripe.client, changed))
      .toEqual({ fromUsd: "0", throughUsd: "1", requestQuantity: "1000" });
    expect(stripe.charges).toEqual([100]);
  });
});

function settlementInput() {
  return {
    customerId: "cus_1",
    stripeSubscriptionId: "sub_provider",
    amountCents: 100,
    description: "Usage",
    itemDescription: "Usage item",
    metadata: { type: "overage_billing", subscriptionId: "sub_provider", usagePeriodEnd: "2026-08-31T00:00:00.000Z" },
    snapshot: { fromUsd: "0", throughUsd: "1", requestQuantity: "1000" },
  };
}
