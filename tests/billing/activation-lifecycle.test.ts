import type { MarketTransaction } from "@tradinggoose/db";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  local: null as Record<string, unknown> | null,
  userCustomerId: "cus_market",
  paymentMethodId: "pm_market" as string | null,
  listResults: [] as Array<Array<{ id: string }>>,
  providers: new Map<string, Record<string, unknown>>(),
  list: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  validatePrice: vi.fn(),
  ensureCustomerState: vi.fn(),
  transaction: vi.fn(),
  transactionCount: 0,
  beforeTransaction: null as null | ((transactionNumber: number) => void),
}));

vi.mock("@/lib/db/locks", () => ({
  acquireBillingSubjectLock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => ({ transaction: state.transaction }),
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({
    billing: { enabled: true, stripePriceId: "price_market_payg" },
  }),
}));

vi.mock("@/lib/billing/customer-state", () => ({
  ensureMarketCustomerState: state.ensureCustomerState,
  ensureStripeUserCustomer: vi.fn(async () => ({ id: "cus_market" })),
  getStripeCustomerDefaultPaymentMethodId: vi.fn(() => state.paymentMethodId),
}));

vi.mock("@/lib/billing/stripe-client", () => ({
  requireEnabledStripeClient: () => stripeFixture(),
  validateMarketStripePrice: state.validatePrice,
}));

import {
  activateMarketPayg,
  PaygActivationError,
} from "../../lib/billing/activation";
import { getPaygActivationAttemptId } from "../../lib/billing/subscription";

beforeEach(() => {
  state.local = localSubscription();
  state.userCustomerId = "cus_market";
  state.paymentMethodId = "pm_market";
  state.listResults = [];
  state.providers.clear();
  state.transactionCount = 0;
  state.beforeTransaction = null;
  state.list.mockReset().mockImplementation(() => state.listResults.shift() ?? []);
  state.retrieve.mockReset().mockImplementation(async (id: string) => {
    const provider = state.providers.get(id);
    if (!provider) throw new Error(`Missing provider fixture ${id}`);
    return provider;
  });
  state.create.mockReset();
  state.validatePrice.mockReset().mockResolvedValue({ id: "price_market_payg" });
  state.ensureCustomerState.mockReset().mockResolvedValue(undefined);
  state.transaction.mockReset().mockImplementation(async (callback) => {
    state.transactionCount += 1;
    state.beforeTransaction?.(state.transactionCount);
    return callback(transactionFixture());
  });
});

describe("PAYG activation lifecycle", () => {
  it("validates the configured Price before creating or mutating activation state", async () => {
    const incompatible = new Error("Configured Market PAYG Stripe Price is incompatible");
    state.validatePrice.mockRejectedValueOnce(incompatible);

    await expect(activateMarketPayg("user_1")).rejects.toBe(incompatible);

    expect(state.validatePrice).toHaveBeenCalledWith(expect.anything());
    expect(state.ensureCustomerState).not.toHaveBeenCalled();
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it("binds one exact active provider result and removes only the attempt metadata", async () => {
    state.listResults.push([]);
    state.create.mockResolvedValue(providerSubscription());

    const result = await activateMarketPayg("user_1");

    expect(result).toEqual({
      success: true,
      status: "activated",
      stripeSubscriptionId: "sub_provider",
    });
    expect(state.local).toEqual(
      expect.objectContaining({
        stripeCustomerId: "cus_market",
        stripeSubscriptionId: "sub_provider",
        status: "active",
        metadata: { retained: "value" },
      }),
    );
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_market",
        default_payment_method: "pm_market",
        items: [{ price: "price_market_payg", quantity: 1 }],
        metadata: {
          userId: "user_1",
          subscriptionId: "sub_default_user_1",
          referenceId: "user_1",
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^payg-activate:sub_default_user_1:[0-9a-f-]+$/,
        ),
      }),
    );
  });

  it("retains the attempt when an active provider object has malformed shape", async () => {
    const malformed = providerSubscription({ omitQuantity: true });
    installInventory([malformed]);

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYG_AMBIGUOUS",
    } satisfies Partial<PaygActivationError>);

    expect(getPaygActivationAttemptId(state.local?.metadata)).toEqual(
      expect.any(String),
    );
    expect(state.local?.metadata).toEqual(
      expect.objectContaining({ retained: "value" }),
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it("clears the exact attempt before create when zero active inventory has no payment method", async () => {
    state.listResults.push([]);
    state.paymentMethodId = null;

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYMENT_METHOD_REQUIRED",
    } satisfies Partial<PaygActivationError>);

    expect(state.local?.metadata).toEqual({ retained: "value" });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("clears only after authoritative rejection and a second zero-inventory read", async () => {
    state.listResults.push([], []);
    state.create.mockRejectedValue({ type: "StripeCardError", statusCode: 402 });

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYG_PROVIDER_REJECTED",
      status: 402,
    } satisfies Partial<PaygActivationError>);

    expect(state.list).toHaveBeenCalledTimes(2);
    expect(state.local?.metadata).toEqual({ retained: "value" });
  });

  it("retains the attempt when provider rejection is followed by active ambiguity", async () => {
    const malformed = providerSubscription({ customer: "cus_other" });
    state.listResults.push([], [{ id: malformed.id }]);
    state.providers.set(malformed.id, malformed);
    state.create.mockRejectedValue({ type: "StripeCardError", statusCode: 402 });

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYG_AMBIGUOUS",
    } satisfies Partial<PaygActivationError>);

    expect(getPaygActivationAttemptId(state.local?.metadata)).toEqual(
      expect.any(String),
    );
  });

  it("retains the attempt after an uncertain provider failure", async () => {
    state.listResults.push([]);
    state.create.mockRejectedValue(new Error("provider transport timeout"));

    await expect(activateMarketPayg("user_1")).rejects.toThrow(
      "provider transport timeout",
    );

    expect(getPaygActivationAttemptId(state.local?.metadata)).toEqual(
      expect.any(String),
    );
  });

  it("retains the attempt when a resolved create returns an unusable provider object", async () => {
    state.listResults.push([]);
    state.create.mockResolvedValue(providerSubscription({ invalidPeriod: true }));

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYG_AMBIGUOUS",
    } satisfies Partial<PaygActivationError>);

    expect(getPaygActivationAttemptId(state.local?.metadata)).toEqual(
      expect.any(String),
    );
  });

  it("retains the attempt when a resolved create has a non-active outcome", async () => {
    state.listResults.push([]);
    state.create.mockResolvedValue(providerSubscription({ status: "incomplete" }));

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYG_ACTIVATION_RETRY_REQUIRED",
    } satisfies Partial<PaygActivationError>);

    expect(getPaygActivationAttemptId(state.local?.metadata)).toEqual(
      expect.any(String),
    );
  });

  it("treats a concurrent binding to the same provider ID as idempotent success", async () => {
    const provider = providerSubscription();
    installInventory([provider]);
    state.beforeTransaction = (transactionNumber) => {
      if (transactionNumber !== 2 || !state.local) return;
      Object.assign(state.local, {
        stripeCustomerId: "cus_market",
        stripeSubscriptionId: "sub_provider",
        status: "active",
        metadata: { retained: "value" },
      });
    };

    await expect(activateMarketPayg("user_1")).resolves.toMatchObject({
      status: "activated",
      stripeSubscriptionId: "sub_provider",
    });
    expect(state.create).not.toHaveBeenCalled();
  });

  it("never clears a different concurrent attempt", async () => {
    state.listResults.push([]);
    state.paymentMethodId = null;
    state.beforeTransaction = (transactionNumber) => {
      if (transactionNumber !== 2 || !state.local) return;
      state.local.metadata = {
        retained: "value",
        paygActivationAttemptId: "attempt_other",
      };
    };

    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      code: "PAYG_ACTIVATION_RETRY_REQUIRED",
    } satisfies Partial<PaygActivationError>);
    expect(getPaygActivationAttemptId(state.local?.metadata)).toBe("attempt_other");
  });
});

function transactionFixture() {
  const lockedRows = (joined: boolean) => {
    if (!state.local) return [];
    return joined
      ? [{ subscription: state.local, stripeCustomerId: state.userCustomerId }]
      : [state.local];
  };
  const selectionChain = (joined: boolean) => ({
    where: () => ({
      for: () => ({ limit: async () => lockedRows(joined) }),
    }),
  });

  return {
    select: () => ({
      from: () => ({
        where: selectionChain(false).where,
        innerJoin: () => selectionChain(true),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async (selection?: unknown) => {
            if (!state.local) return [];
            Object.assign(state.local, values);
            return selection ? [{ id: state.local.id }] : [{ ...state.local }];
          },
        }),
      }),
    }),
  } as unknown as MarketTransaction;
}

function stripeFixture() {
  return {
    subscriptions: {
      list: state.list,
      retrieve: state.retrieve,
      create: state.create,
    },
  } as unknown as Stripe;
}

function installInventory(providers: Array<Record<string, unknown>>) {
  state.listResults.push(providers.map((provider) => ({ id: String(provider.id) })));
  for (const provider of providers) state.providers.set(String(provider.id), provider);
}

function localSubscription() {
  return {
    id: "sub_default_user_1",
    plan: "payg",
    referenceType: "user",
    referenceId: "user_1",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: null,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: null,
    seats: null,
    trialStart: null,
    trialEnd: null,
    metadata: { retained: "value" },
  };
}

function providerSubscription(
  overrides: {
    customer?: string;
    omitQuantity?: boolean;
    invalidPeriod?: boolean;
    status?: string;
  } = {},
) {
  return {
    id: "sub_provider",
    customer: overrides.customer ?? "cus_market",
    status: overrides.status ?? "active",
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    metadata: {
      userId: "user_1",
      subscriptionId: "sub_default_user_1",
      referenceId: "user_1",
    },
    items: {
      data: [
        {
          price: { id: "price_market_payg" },
          ...(overrides.omitQuantity ? {} : { quantity: 1 }),
          current_period_start: overrides.invalidPeriod ? 0 : 1_787_875_200,
          current_period_end: 1_790_553_600,
        },
      ],
    },
  };
}
