import type postgres from "postgres";
import type Stripe from "stripe";
import { expect, vi } from "vitest";

/** Exercises the real activation owner and advisory locks in the migrated fixture. */
export async function assertActivationSerialization(monitor: ReturnType<typeof postgres>) {
  const [activation, environment, stripeClient] = await Promise.all([
    import("../../lib/billing/activation"),
    import("../../lib/environment"),
    import("../../lib/billing/stripe-client"),
  ]);
  const userId = "activation_serialization_customer";
  const localSubscriptionId = `sub_default_${userId}`;
  const customerId = "cus_activation_serialization";
  const priceId = "price_activation_serialization";
  await monitor`
    insert into "user" (id, name, email, email_verified, stripe_customer_id, created_at, updated_at)
    values (${userId}, 'Activation serialization', 'activation-serialization@example.com', true, ${customerId}, now(), now())
  `;
  const baseConfig = environment.getMarketRuntimeConfig();
  const configSpy = vi.spyOn(environment, "getMarketRuntimeConfig").mockReturnValue({
    ...baseConfig,
    billing: { ...baseConfig.billing, enabled: true, stripePriceId: priceId },
  });
  const providers = new Map<string, Stripe.Subscription>();
  const idempotentCreates = new Map<string, Stripe.Subscription>();
  let nextSubscription = 0;
  const customer = (paymentMethod: string | null = "pm_current") => ({
    id: customerId,
    invoice_settings: { default_payment_method: paymentMethod },
  });
  const retrieveCustomer = vi.fn(async () => customer());
  const list = vi.fn(() => [...providers.values()].filter((entry) => entry.status === "active"));
  const retrieve = vi.fn(async (id: string) => {
    const provider = providers.get(id);
    if (!provider) throw new Error("Missing activation provider fixture");
    return provider;
  });
  const create = vi.fn(async (_parameters: unknown, options: { idempotencyKey: string }) => {
    const [{ attempt }] = await monitor<{ attempt: string | null }[]>`
      select metadata ->> 'paygActivationAttemptId' as attempt
      from subscription where id = ${localSubscriptionId}
    `;
    // A provider call cannot happen before its recovery identity has committed.
    expect(attempt).toEqual(expect.any(String));
    expect(options.idempotencyKey).toBe(`payg-activate:${localSubscriptionId}:${attempt}`);
    const existing = idempotentCreates.get(options.idempotencyKey);
    if (existing) return existing;
    const provider = {
      id: `sub_serialization_${++nextSubscription}`,
      customer: customerId,
      status: "active",
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: null,
      metadata: { userId, subscriptionId: localSubscriptionId, referenceId: userId },
      items: { data: [{
        price: { id: priceId }, quantity: 1,
        current_period_start: 1_787_875_200, current_period_end: 1_790_553_600,
      }] },
    } as unknown as Stripe.Subscription;
    providers.set(provider.id, provider);
    idempotentCreates.set(options.idempotencyKey, provider);
    return provider;
  });
  const provider = {
    customers: { retrieve: retrieveCustomer },
    subscriptions: { list, retrieve, create },
  } as unknown as Stripe;
  const enabledSpy = vi.spyOn(stripeClient, "requireEnabledStripeClient").mockReturnValue(provider);
  const optionalSpy = vi.spyOn(stripeClient, "getOptionalStripeClient").mockReturnValue(provider);
  const priceSpy = vi.spyOn(stripeClient, "validateMarketStripePrice").mockResolvedValue(null);

  async function expectWaitingActivation() {
    await vi.waitFor(async () => {
      const [{ waiting }] = await monitor<{ waiting: number }[]>`
        select count(*)::integer as waiting from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and wait_event_type = 'Lock' and query like '%pg_advisory_lock(%'
      `;
      expect(waiting).toBe(1);
    }, { timeout: 5_000 });
  }
  const outstanding: Promise<unknown>[] = [];
  const releases: Array<() => void> = [];
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    releases.push(release);
    return { promise, release };
  }
  function startActivation() {
    // Observe rejections immediately, including cleanup after a failed assertion.
    const result = activation.activateMarketPayg(userId).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    outstanding.push(result);
    return result;
  }
  async function resetBinding() {
    for (const entry of providers.values()) entry.status = "canceled";
    await monitor`
      update subscription set stripe_customer_id = null, stripe_subscription_id = null,
        status = null, period_start = null, period_end = null, metadata = null
      where id = ${localSubscriptionId}
    `;
  }

  try {
    const reading = gate();
    const finishRead = gate();
    retrieveCustomer.mockImplementationOnce(async () => {
      const staleMissingCard = customer(null);
      reading.release();
      await finishRead.promise;
      return staleMissingCard;
    });
    const missingCard = startActivation();
    await reading.promise;
    const withCard = startActivation();
    await expectWaitingActivation();
    expect(retrieveCustomer).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    finishRead.release();
    expect(await missingCard).toMatchObject({ error: { code: "PAYMENT_METHOD_REQUIRED" } });
    expect(await withCard).toMatchObject({ value: { status: "activated" } });
    expect(await startActivation()).toMatchObject({ error: { code: "SUBSCRIPTION_ALREADY_BOUND" } });
    expect(create).toHaveBeenCalledTimes(1);
    expect([...providers.values()].filter((entry) => entry.status === "active")).toHaveLength(1);

    // Inverse ordering: a missing-card contender cannot retire an in-flight
    // create. After the first binds, it must stop before reading any Customer.
    await resetBinding();
    const creating = gate();
    const finishCreate = gate();
    const createNormally = create.getMockImplementation()!;
    create.mockImplementationOnce(async (parameters, options) => {
      creating.release();
      await finishCreate.promise;
      return createNormally(parameters, options);
    });
    const creator = startActivation();
    await creating.promise;
    const customerReads = retrieveCustomer.mock.calls.length;
    retrieveCustomer.mockImplementation(async () => customer(null));
    const staleContender = startActivation();
    await expectWaitingActivation();
    expect(retrieveCustomer).toHaveBeenCalledTimes(customerReads);
    finishCreate.release();
    expect(await creator).toMatchObject({ value: { status: "activated" } });
    expect(await staleContender).toMatchObject({ error: { code: "SUBSCRIPTION_ALREADY_BOUND" } });
    expect(retrieveCustomer).toHaveBeenCalledTimes(customerReads);
    expect(create).toHaveBeenCalledTimes(2);
    expect([...providers.values()].filter((entry) => entry.status === "active")).toHaveLength(1);

    // A rollback after remote creation must retain the already committed
    // attempt so the same owner recovers it instead of creating another one.
    await resetBinding();
    retrieveCustomer.mockImplementation(async () => customer());
    retrieve.mockRejectedValueOnce(new Error("fresh provider retrieval failed"));
    expect(await startActivation()).toMatchObject({ error: { message: "fresh provider retrieval failed" } });
    const [{ attempt, binding }] = await monitor<{ attempt: string | null; binding: string | null }[]>`
      select metadata ->> 'paygActivationAttemptId' as attempt,
        stripe_subscription_id as binding from subscription where id = ${localSubscriptionId}
    `;
    expect(attempt).toEqual(expect.any(String));
    expect(binding).toBeNull();
    const createdBeforeRecovery = create.mock.calls.length;
    expect(await startActivation()).toMatchObject({ value: { status: "activated" } });
    expect(create).toHaveBeenCalledTimes(createdBeforeRecovery);
    expect([...providers.values()].filter((entry) => entry.status === "active")).toHaveLength(1);
  } finally {
    for (const release of releases) release();
    await Promise.allSettled(outstanding);
    priceSpy.mockRestore();
    optionalSpy.mockRestore();
    enabledSpy.mockRestore();
    configSpy.mockRestore();
  }
}
