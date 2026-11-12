import type Stripe from "stripe";
import { vi } from "vitest";

/** Persists provider side effects even when their HTTP response is lost. */
export function usageStripeFixture() {
  const invoices = new Map<string, Stripe.Invoice>();
  const hiddenInvoiceIds = new Set<string>();
  const items: Stripe.InvoiceItem[] = [];
  const charges: number[] = [];
  const requests = new Map<string, { parameters: string; result: unknown }>();
  const state = { lostResponse: "" as "" | "invoice" | "item" | "finalize" | "pay", paymentStatus: "paid" as "paid" | "open", paymentFailure: false };
  function mutate<T>(operation: string, parameters: unknown, key: string, effect: () => T): T {
    const previous = requests.get(key);
    if (previous) {
      if (previous.parameters !== JSON.stringify(parameters)) throw new Error("Stripe idempotency parameter mismatch");
      return structuredClone(previous.result) as T;
    }
    const result = effect();
    requests.set(key, { parameters: JSON.stringify(parameters), result: structuredClone(result) });
    if (state.lostResponse === operation) {
      state.lostResponse = "";
      throw new Error(`${operation} response lost`);
    }
    return structuredClone(result);
  }
  const subscriptionRetrieve = vi.fn(async () => ({
    id: "sub_provider", customer: "cus_1", default_payment_method: "pm_subscription",
  }));
  const customerRetrieve = vi.fn(async () => ({
    id: "cus_1", invoice_settings: { default_payment_method: "pm_customer" },
  }));
  const invoiceCreate = vi.fn(async (parameters: Stripe.InvoiceCreateParams, options: Stripe.RequestOptions) =>
    mutate("invoice", parameters, options.idempotencyKey!, () => {
      const invoice = { id: `in_${invoices.size + 1}`, customer: parameters.customer,
        status: "draft", total: 0, currency: "usd", metadata: parameters.metadata ?? {} } as Stripe.Invoice;
      invoices.set(invoice.id, invoice);
      return invoice;
    }));
  const invoiceItemsCreate = vi.fn(async (parameters: Stripe.InvoiceItemCreateParams, options: Stripe.RequestOptions) =>
    mutate("item", parameters, options.idempotencyKey!, () => {
      const item = { id: `ii_${items.length + 1}`, amount: parameters.amount,
        currency: parameters.currency, metadata: parameters.metadata, invoice: parameters.invoice } as unknown as Stripe.InvoiceItem;
      items.push(item);
      invoices.get(parameters.invoice!)!.total += parameters.amount!;
      return item;
    }));
  const invoiceRetrieve = vi.fn(async (id: string) => structuredClone(invoices.get(id)!));
  const finalizeInvoice = vi.fn(async (id: string, parameters: unknown, options: Stripe.RequestOptions) =>
    mutate("finalize", { id, parameters }, options.idempotencyKey!, () => {
      invoices.get(id)!.status = "open";
      return invoices.get(id)!;
    }));
  const payInvoice = vi.fn(async (id: string, parameters?: Stripe.InvoicePayParams) => {
    if (state.paymentFailure) throw new Error("Card declined");
    return mutate("pay", { id, parameters }, `pay-${requests.size}`, () => {
      const invoice = invoices.get(id)!;
      invoice.status = state.paymentStatus;
      if (invoice.status === "paid") charges.push(invoice.total);
      return invoice;
    });
  });
  const invoiceList = vi.fn(() => (async function* () {
    const values = [...invoices.values()].filter(invoice => !hiddenInvoiceIds.has(invoice.id));
    for (let page = 0; page < values.length; page += 100) {
      for (const invoice of values.slice(page, page + 100)) yield structuredClone(invoice);
    }
  })());
  const invoiceItemsList = vi.fn(({ invoice }: { invoice: string }) => (async function* () {
    for (const item of items) if ((item as unknown as { invoice: string }).invoice === invoice) yield structuredClone(item);
  })());
  const client = {
    subscriptions: { retrieve: subscriptionRetrieve }, customers: { retrieve: customerRetrieve },
    invoices: { create: invoiceCreate, retrieve: invoiceRetrieve, list: invoiceList, finalizeInvoice, pay: payInvoice },
    invoiceItems: { create: invoiceItemsCreate, list: invoiceItemsList },
  } as unknown as Stripe;
  return { client, state, invoices, hiddenInvoiceIds, items, charges, requests, subscriptionRetrieve, customerRetrieve,
    invoiceCreate, invoiceItemsCreate, invoiceRetrieve, invoiceList, finalizeInvoice, payInvoice };
}
