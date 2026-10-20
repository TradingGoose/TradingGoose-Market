import type { MarketDatabase, MarketTransaction } from "@tradinggoose/db";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  record: null as null | {
    user: { id: string; name: string; email: string; stripeCustomerId: string | null };
    subscription: { stripeCustomerId: string | null; stripeSubscriptionId: string | null };
    usageOwner: { id: string };
  },
  create: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => database() }));
vi.mock("@/lib/db/locks", () => ({
  withBillingSubjectLock: async (
    _userId: string,
    callback: (tx: MarketTransaction) => Promise<unknown>,
  ) => state.transaction(callback),
}));
vi.mock("@/lib/billing/stripe-client", () => ({
  getOptionalStripeClient: () => ({
    customers: { create: state.create, retrieve: state.retrieve, update: state.update },
  }),
}));

import {
  ensureStripeUserCustomer,
  getStripeCustomerCreateIdempotencyKey,
  getStripeCustomerReplacementIdempotencyKey,
} from "../../lib/billing/customer-state";

beforeEach(() => {
  state.record = {
    user: { id: "user_1", name: "Original name", email: "original@example.com", stripeCustomerId: null },
    subscription: { stripeCustomerId: null, stripeSubscriptionId: null },
    usageOwner: { id: "owner_1" },
  };
  state.create.mockReset();
  state.retrieve.mockReset();
  state.update.mockReset().mockImplementation(async (id, parameters) => ({ id, ...parameters }));
  state.transaction.mockReset().mockImplementation(async (callback) => {
    const priorCustomerId = state.record!.user.stripeCustomerId;
    try {
      return await callback(transaction());
    } catch (error) {
      state.record!.user.stripeCustomerId = priorCustomerId;
      throw error;
    }
  });
});

describe("immutable Stripe Customer creation retries", () => {
  it.each([null, "deleted", "missing"])(
    "recovers a lost Customer create after profile edits and prior Customer status %s",
    async (replacement) => {
      if (replacement) state.record!.user.stripeCustomerId = "cus_deleted";
      const customers = new Map<string, Stripe.Customer>();
      const requests = new Map<string, { parameters: string; customer: Stripe.Customer }>();
      state.retrieve.mockImplementation(async (id) => {
        if (id === "cus_deleted") {
          if (replacement === "deleted") return { id, deleted: true };
          throw new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", code: "resource_missing", statusCode: 404 });
        }
        const customer = customers.get(id);
        if (!customer) throw new Error("No fixture Customer");
        return customer;
      });
      state.create.mockImplementation(async (parameters, options) => {
        const serialized = JSON.stringify(parameters);
        const existing = requests.get(options.idempotencyKey);
        if (existing) {
          if (existing.parameters !== serialized) throw new Error("Stripe idempotency parameter mismatch");
          return existing.customer;
        }
        const customer = { id: "cus_recovered", ...parameters } as Stripe.Customer;
        requests.set(options.idempotencyKey, { parameters: serialized, customer });
        customers.set(customer.id, customer);
        throw new Error("Customer create response lost");
      });
      state.update.mockImplementation(async (id, parameters) => {
        expect(state.record!.user.stripeCustomerId).toBe(id);
        const customer = { ...customers.get(id)!, ...parameters };
        customers.set(id, customer);
        return customer;
      });

      await expect(ensureStripeUserCustomer("user_1")).rejects.toThrow("Customer create response lost");
      Object.assign(state.record!.user, { name: "New name", email: "new@example.com" });
      await expect(ensureStripeUserCustomer("user_1")).resolves.toMatchObject({
        id: "cus_recovered", name: "New name", email: "new@example.com",
      });
      await expect(ensureStripeUserCustomer("user_1")).resolves.toMatchObject({ id: "cus_recovered" });

      expect(customers.size).toBe(1);
      expect(state.create).toHaveBeenCalledTimes(2);
      expect(state.create.mock.calls[1]).toEqual(state.create.mock.calls[0]);
      expect(state.create.mock.calls[0]).toEqual([
        { metadata: { userId: "user_1", usageOwnerId: "owner_1", customerType: "user" } },
        { idempotencyKey: replacement
          ? getStripeCustomerReplacementIdempotencyKey("user_1", "cus_deleted")
          : getStripeCustomerCreateIdempotencyKey("user_1") },
      ]);
      expect(state.update).toHaveBeenCalledTimes(1);
      expect(state.record!.user.stripeCustomerId).toBe("cus_recovered");
    },
  );

  it("commits the recovered mapping before a failed profile projection and retries only update", async () => {
    const customer = { id: "cus_created", email: null, name: null };
    state.create.mockResolvedValue(customer);
    state.retrieve.mockResolvedValue(customer);
    state.update.mockRejectedValueOnce(new Error("Customer profile update failed"));

    await expect(ensureStripeUserCustomer("user_1")).rejects.toThrow("Customer profile update failed");
    expect(state.record!.user.stripeCustomerId).toBe("cus_created");
    Object.assign(state.record!.user, { name: "Edited name", email: "edited@example.com" });
    await expect(ensureStripeUserCustomer("user_1")).resolves.toMatchObject({
      id: "cus_created", name: "Edited name", email: "edited@example.com",
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.retrieve).toHaveBeenCalledWith("cus_created");
    expect(state.update).toHaveBeenLastCalledWith("cus_created", {
      name: "Edited name", email: "edited@example.com",
    });
  });
});

function database() {
  return { transaction: state.transaction } as unknown as MarketDatabase;
}

function transaction() {
  const selection = {
    innerJoin: () => selection,
    where: () => selection,
    limit: () => selection,
    for: async () => state.record ? [state.record] : [],
  };
  return {
    select: () => ({ from: () => selection }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => Object.assign(state.record!.user, values),
      }),
    }),
  } as unknown as MarketTransaction;
}
