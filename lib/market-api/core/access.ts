import {
  marketApiKeys,
  marketApiUsageEvent,
  marketUsageOwner,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { effectiveLimitNano, isFreeBinding, isPaidBinding, readPersonalBillingState } from "@/lib/billing/user-stats";
import { scheduleUsageThresholdEmail } from "@/lib/billing/notifications";
import { nanoUsdToDecimalUsd } from "@/lib/billing/money";
import {
  checkAndBillMarketThreshold,
  UsageInvoicePaymentFailedError,
} from "@/lib/billing/threshold-billing";
import { requireEnabledStripeClient } from "@/lib/billing/stripe-client";
import { projectMarketUsageInvoicePayment } from "@/lib/billing/webhooks/invoices";
import {
  acquireAdminGrantLock,
  acquireApiKeyLock,
  acquireBillingSubjectLock,
  withBoundedLockAcquisition,
} from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { databaseNow } from "@/lib/db/clock";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { createAnonymousLimiter } from "@/lib/unkey/anonymous";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";
import {
  consumeSpendLimit,
  createSpendLimitCodec,
  exactRequiredProviderUnits,
  probeSpendLimit,
  providerCostForRequest,
  type SpendLimitCodec,
} from "@/lib/unkey/spend-limit";
import { parseMarketAppAttribution } from "@/lib/usage/attribution";
import { completeUsageWithoutChangingResponse } from "@/lib/usage/completion";
import { insertMarketUsageAdmission } from "@/lib/usage/admission";
import { decimalUsdToNanoUsd } from "@/lib/billing/money";
import { createApiContext, type ApiContext } from "./context";
import type { KeyedMarketRouteDescriptor } from "./manifest";

export type MarketApiActor = {
  keyId: string;
  keyClass: "public" | "private";
  usageOwnerId: string;
  userId: string | null;
  adminGrantId: string | null;
};

type MarketHandler = (
  context: ApiContext,
  actor: MarketApiActor | null,
) => Promise<Response>;

class AccessResponseError extends Error {
  constructor(readonly response: Response) {
    super(`Market access denied with ${response.status}`);
  }
}

let anonymousLimiterSignature: string | null = null;
let anonymousLimiter: ReturnType<typeof createAnonymousLimiter> | null = null;
const MAX_PRIVATE_REQUEST_BODY_BYTES = 64 * 1024;
const PRIVATE_REQUEST_BODY_TIMEOUT_MS = 10_000;

export async function handleKeyedMarketRoute(
  request: Request,
  descriptor: KeyedMarketRouteDescriptor,
  handler: MarketHandler,
): Promise<Response> {
  const hasApiKey = request.headers.has("x-api-key");
  if (!hasApiKey) {
    if (descriptor.access !== "public-read") {
      return jsonError("API key is required", 401, "API_KEY_REQUIRED");
    }
    let anonymousGuard: Awaited<ReturnType<typeof enforceAnonymousPolicy>>;
    try {
      anonymousGuard = await enforceAnonymousPolicy();
    } catch {
      return jsonError(
        "Anonymous access is temporarily unavailable",
        503,
        "ANONYMOUS_LIMIT_UNAVAILABLE",
      );
    }
    if (anonymousGuard.response) return anonymousGuard.response;
    const response = await invokeAnonymousHandler(request, handler);
    anonymousGuard.headers.forEach((value, name) => response.headers.set(name, value));
    return response;
  }

  const rawKey = request.headers.get("x-api-key") ?? "";
  const permission =
    descriptor.access === "public-read" ? "market.public" : "market.private";
  let verification;
  try {
    const provider = getMarketKeyProvider();
    verification = await provider.verifyKey({ key: rawKey, permission });
  } catch {
    return jsonError("API key verification is temporarily unavailable", 503, "KEY_SERVICE_UNAVAILABLE");
  }
  if (
    !verification ||
    typeof verification !== "object" ||
    typeof verification.valid !== "boolean" ||
    typeof verification.code !== "string" ||
    (verification.keyId !== null && typeof verification.keyId !== "string") ||
    (verification.valid && !verification.keyId)
  ) {
    return jsonError(
      "API key verification is temporarily unavailable",
      503,
      "KEY_SERVICE_UNAVAILABLE",
    );
  }
  if (!verification.valid || !verification.keyId) {
    const forbidden =
      verification.code === "FORBIDDEN" ||
      verification.code === "INSUFFICIENT_PERMISSIONS";
    return jsonError(
      forbidden ? "API key does not grant this operation" : "API key is invalid",
      forbidden ? 403 : 401,
      forbidden ? "API_KEY_FORBIDDEN" : "API_KEY_INVALID",
    );
  }

  let database: ReturnType<typeof requireDatabase>;
  let mappings: Array<typeof marketApiKeys.$inferSelect>;
  try {
    database = requireDatabase();
    mappings = await database
      .select()
      .from(marketApiKeys)
      .where(eq(marketApiKeys.unkeyKeyId, verification.keyId))
      .limit(2);
  } catch {
    return admissionUnavailable();
  }
  const mapping = mappings[0];
  const requiredClass = descriptor.access === "public-read" ? "public" : "private";
  if (
    mappings.length !== 1 ||
    !mapping ||
    mapping.keyClass !== requiredClass ||
    mapping.revocationRequestedAt ||
    mapping.providerRevokedAt
  ) {
    return jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN");
  }

  const attribution = parseMarketAppAttribution(request.headers);
  try {
    if (mapping.keyClass === "public") {
      const admitted = await admitPublicRequest({
        request,
        descriptor,
        rawKey,
        keyId: mapping.id,
        userId: mapping.userId,
        attribution,
      });
      if (admitted.response) return admitted.response;
      return completeAdmittedRequest(admitted.eventId, () =>
        handler(createApiContext(sanitizeHandlerRequest(request)), admitted.actor),
      );
    }
    if (!mapping.adminGrantId) {
      return jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN");
    }
    const bufferedRequest = await bufferPrivateRequestBody(request);
    const grantId = mapping.adminGrantId;
    const authorize = async (tx: MarketTransaction) => {
      await withBoundedLockAcquisition(tx, async () => {
        await acquireAdminGrantLock(tx, grantId);
        await acquireApiKeyLock(tx, mapping.id);
      });
      return reloadAuthorizedPrivateKey(tx, mapping, grantId);
    };
    const eventId = await database.transaction(async (tx) => {
      const actor = await authorize(tx);
      return insertMarketUsageAdmission({
        tx,
        actor,
        descriptor,
        method: "POST",
        stripeSubscriptionId: null,
        billingMode: "disabled",
        rateUsdPer1000Reads: null,
        billableCostUsd: null,
        attribution,
        admittedAt: await databaseNow(tx),
      });
    });
    return completeAdmittedRequest(eventId, () => database.transaction(async (tx) => {
      const actor = await authorize(tx).catch((error: unknown) => {
        if (error instanceof AccessResponseError) throw error;
        throw new AccessResponseError(admissionUnavailable());
      });
      return handler(createApiContext(sanitizeHandlerRequest(bufferedRequest), tx), actor);
    }));
  } catch (error) {
    if (error instanceof AccessResponseError) return error.response;
    console.error("Market API admission failed", {
      routeId: descriptor.id,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return admissionUnavailable();
  }
}

async function reloadAuthorizedPrivateKey(
  tx: MarketTransaction,
  mapping: typeof marketApiKeys.$inferSelect,
  grantId: string,
) {
  const rows = await tx
    .select({
      key: marketApiKeys,
      grant: systemAdmin,
      owner: marketUsageOwner,
      activeUserId: user.id,
      emailVerified: user.emailVerified,
    })
    .from(marketApiKeys)
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
    .innerJoin(systemAdmin, eq(systemAdmin.id, marketApiKeys.adminGrantId))
    .innerJoin(user, eq(user.id, systemAdmin.userId))
    .where(eq(marketApiKeys.id, mapping.id))
    .for("update", { of: user })
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.key.keyClass !== "private" ||
    row.key.revocationRequestedAt ||
    row.key.providerRevokedAt ||
    row.grant.status !== "active" ||
    row.grant.id !== grantId ||
    row.key.unkeyKeyId !== mapping.unkeyKeyId ||
    row.key.userId !== row.activeUserId ||
    row.owner.userId !== row.activeUserId ||
    (row.emailVerified !== true && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled)
  ) {
    throw new AccessResponseError(
      jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN"),
    );
  }
  return actorFromKey(row.key);
}

async function admitPublicRequest(input: {
  request: Request;
  descriptor: KeyedMarketRouteDescriptor;
  rawKey: string;
  keyId: string;
  userId: string | null;
  attribution: ReturnType<typeof parseMarketAppAttribution>;
}) {
  const database = requireDatabase();
  const config = getMarketRuntimeConfig();
  const { userId } = input;
  if (!userId) {
    throw new AccessResponseError(
      jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN"),
    );
  }

  const billed = config.billing.enabled;
  const admitted = await database.transaction(async (tx) => {
    await withBoundedLockAcquisition(tx, async () => {
      if (billed) await acquireBillingSubjectLock(tx, userId);
      await acquireApiKeyLock(tx, input.keyId);
    });
    const row = await reloadAuthorizedPublicKey(tx, input.keyId, userId);
    const funding = billed ? await readPersonalBillingState(tx, userId) : null;
    let usage: { before: bigint; limit: bigint } | null = null;
    if (funding) {
      const { subscription: local, stats, customerId } = funding;
      if (stats.usageOwnerId !== row.owner.id || stats.billingBlocked ||
        !(isFreeBinding(local) || (isPaidBinding(local) && local.stripeCustomerId === customerId))) {
        return { response: jsonError("Billing is unavailable for this account", 402, "BILLING_REQUIRED") };
      }
      usage = { before: decimalUsdToNanoUsd(stats.currentPeriodCost), limit: effectiveLimitNano(stats) };
      if (usage.before >= usage.limit) {
        return { response: jsonError("Usage limit exceeded", 402, "USAGE_LIMIT_EXCEEDED") };
      }
    }
    const stripeSubscriptionId = funding?.subscription.stripeSubscriptionId ?? null;
    const cap = billed && row.key.spendLimitUsd && row.key.spendWindowDays
      ? createSpendLimitCodec(row.key.spendLimitUsd, row.key.spendWindowDays) : null;
    if (cap) {
      const denial = await enforceProviderSpendWindow(tx, row.key, input.rawKey, cap);
      if (denial) return { response: denial };
    }
    const admittedAt = await databaseNow(tx);
    if (cap) {
      const spent = await rollingSpend(tx, input.keyId, admittedAt, cap.duration);
      if (spent + config.billing.requestNanoUsd > cap.limitNanoUsd) {
        return { response: jsonError("API key spend limit exceeded", 429, "API_KEY_SPEND_LIMIT_EXCEEDED") };
      }
    }
    const actor = actorFromKey(row.key);
    const eventId = await insertMarketUsageAdmission({
      tx,
      actor,
      descriptor: input.descriptor,
      method: input.request.method as "GET" | "HEAD",
      stripeSubscriptionId,
      billingMode: billed ? "enabled" : "disabled",
      rateUsdPer1000Reads: billed ? config.billing.usdPer1000Reads : null,
      billableCostUsd: billed ? nanoUsdToDecimalUsd(config.billing.requestNanoUsd) : null,
      attribution: input.attribution,
      admittedAt,
    });
    return { actor, eventId, stripeSubscriptionId, usage };
  });

  if (admitted.usage) {
    const { before, limit } = admitted.usage;
    scheduleUsageThresholdEmail(userId, before, before + config.billing.requestNanoUsd, limit);
  }
  if (admitted.stripeSubscriptionId) {
    try {
      await database.transaction(async (tx) => {
        await withBoundedLockAcquisition(tx, () => acquireBillingSubjectLock(tx, userId));
        try {
          await tx.transaction((settlement) => checkAndBillMarketThreshold(settlement, userId));
        } catch (error) {
          if (!(error instanceof UsageInvoicePaymentFailedError)) throw error;
          await projectMarketUsageInvoicePayment(tx, requireEnabledStripeClient(), error.invoice, userId);
        }
      });
    } catch (error) {
      console.error("Market threshold billing deferred after committed admission", {
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return admitted;
}

async function reloadAuthorizedPublicKey(
  tx: MarketTransaction,
  keyId: string,
  expectedUserId: string,
) {
  const rows = await tx
    .select({
      key: marketApiKeys,
      owner: marketUsageOwner,
      activeUserId: user.id,
      emailVerified: user.emailVerified,
    })
    .from(marketApiKeys)
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
    .innerJoin(user, eq(user.id, marketApiKeys.userId))
    .where(eq(marketApiKeys.id, keyId))
    .for("update", { of: user })
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.key.keyClass !== "public" ||
    row.key.revocationRequestedAt ||
    row.key.providerRevokedAt ||
    row.activeUserId !== expectedUserId ||
    row.key.userId !== row.activeUserId ||
    row.owner.userId !== row.activeUserId ||
    (row.emailVerified !== true && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled)
  ) {
    throw new AccessResponseError(
      jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN"),
    );
  }

  return row;
}

async function rollingSpend(
  tx: MarketTransaction,
  keyId: string,
  at: Date,
  duration: number,
) {
  const cutoff = new Date(at.getTime() - duration);
  const totals = await tx
    .select({
      cost: sql<string>`coalesce(sum(${marketApiUsageEvent.billableCostUsd}), 0)`,
    })
    .from(marketApiUsageEvent)
    .where(
      and(
        eq(marketApiUsageEvent.marketApiKeyId, keyId),
        gte(marketApiUsageEvent.admittedAt, cutoff),
      ),
    );
  return decimalUsdToNanoUsd(totals[0]?.cost ?? "0");
}

async function enforceProviderSpendWindow(
  tx: MarketTransaction,
  key: typeof marketApiKeys.$inferSelect,
  rawKey: string,
  codec: SpendLimitCodec,
): Promise<Response | null> {
  const config = getMarketRuntimeConfig();
  const exactRollingNanoUsd = await rollingSpend(tx, key.id, await databaseNow(tx), codec.duration);
  const provider = getMarketKeyProvider();
  let observation;
  try {
    observation = await probeSpendLimit(provider, rawKey, codec, key.unkeyKeyId);
    await persistSpendObservation(tx, key, observation);
    const observedConsumption = codec.providerLimit - observation.remaining;
    const requiredConsumption = exactRequiredProviderUnits(exactRollingNanoUsd, codec);
    const reserve = requiredConsumption - observedConsumption;
    if (reserve > 0) {
      observation = await consumeSpendLimit(
        provider,
        rawKey,
        codec,
        reserve,
        key.unkeyKeyId,
      );
      await persistSpendObservation(tx, key, observation);
    }
    if (observation.decision === "rate_limited") {
      return jsonError(
        "API key spend limit exceeded",
        429,
        "API_KEY_SPEND_LIMIT_EXCEEDED",
      );
    }
    const requestCost = providerCostForRequest(
      config.billing.requestNanoUsd,
      codec.quantumNanoUsd,
    );
    observation = await consumeSpendLimit(
      provider,
      rawKey,
      codec,
      requestCost,
      key.unkeyKeyId,
    );
    await persistSpendObservation(tx, key, observation);
    if (observation.decision === "rate_limited") {
      return jsonError(
        "API key spend limit exceeded",
        429,
        "API_KEY_SPEND_LIMIT_EXCEEDED",
      );
    }
  } catch {
    return jsonError(
      "Spend-limit enforcement is temporarily unavailable",
      503,
      "SPEND_LIMIT_UNAVAILABLE",
    );
  }

  return null;
}

async function persistSpendObservation(
  tx: MarketTransaction,
  key: typeof marketApiKeys.$inferSelect,
  observation: Awaited<ReturnType<typeof probeSpendLimit>>,
) {
  await tx
    .update(marketApiKeys)
    .set({
      providerObservedRevision: key.spendLimitRevision,
      providerQuantumNanoUsd: observation.quantumNanoUsd,
      providerLimitUnits: String(observation.limit),
      providerRemainingUnits: String(observation.remaining),
      providerDurationMs: String(observation.duration),
      providerResetAt: new Date(observation.reset),
      providerDecision: observation.decision,
      providerObservedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(marketApiKeys.id, key.id));
}

async function bufferPrivateRequestBody(request: Request): Promise<Request> {
  if (!request.body) return request;
  const tooLarge = () => new AccessResponseError(
    jsonError("Request body exceeds 64 KiB", 413, "REQUEST_BODY_TOO_LARGE"),
  );
  if (Number(request.headers.get("content-length")) > MAX_PRIVATE_REQUEST_BODY_BYTES) {
    void request.body.cancel().catch(() => {});
    throw tooLarge();
  }

  const reader = request.body.getReader();
  const bytes = new Uint8Array(MAX_PRIVATE_REQUEST_BODY_BYTES);
  let size = 0;
  let readFailure: AccessResponseError | null = null;
  const cancelRead = (error: AccessResponseError) => {
    readFailure ??= error;
    // Transport cancellation must not extend the read deadline.
    void reader.cancel().catch(() => {});
  };
  const abortRead = () => cancelRead(new AccessResponseError(
    jsonError("Request body was aborted", 400, "INVALID_REQUEST_BODY"),
  ));
  const timeout = setTimeout(() => cancelRead(new AccessResponseError(
    jsonError("Request body read timed out", 408, "REQUEST_BODY_TIMEOUT"),
  )), PRIVATE_REQUEST_BODY_TIMEOUT_MS);
  request.signal.addEventListener("abort", abortRead, { once: true });

  try {
    if (request.signal.aborted) abortRead();
    while (true) {
      const { done, value } = await reader.read();
      if (readFailure) throw readFailure;
      if (done) break;
      if (size + value.byteLength > bytes.length) throw tooLarge();
      bytes.set(value, size);
      size += value.byteLength;
    }
    return new Request(request, { body: bytes.subarray(0, size) });
  } catch (error) {
    if (error instanceof AccessResponseError) throw error;
    throw new AccessResponseError(
      jsonError("Request body could not be read", 400, "INVALID_REQUEST_BODY"),
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortRead);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function invokeAnonymousHandler(request: Request, handler: MarketHandler) {
  try {
    return await handler(createApiContext(sanitizeHandlerRequest(request)), null);
  } catch {
    return jsonError("Internal server error", 500, "INTERNAL_ERROR");
  }
}

async function completeAdmittedRequest(eventId: string, run: () => Promise<Response>) {
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    response = error instanceof AccessResponseError
      ? error.response
      : jsonError("Internal server error", 500, "INTERNAL_ERROR");
  }
  return completeUsageWithoutChangingResponse(eventId, response);
}

async function enforceAnonymousPolicy(): Promise<{
  response: Response | null;
  headers: Headers;
}> {
  const { anonymous: policy, rootKey } = getMarketRuntimeConfig().unkey;
  if (!policy) return { response: null, headers: new Headers() };
  const signature = [
    policy.limit,
    policy.durationSeconds,
    policy.namespaceId,
    rootKey,
  ].join("\u0000");
  if (!anonymousLimiter || anonymousLimiterSignature !== signature) {
    const nextLimiter = createAnonymousLimiter({ ...policy, rootKey });
    anonymousLimiter = nextLimiter;
    anonymousLimiterSignature = signature;
  }
  const result = await anonymousLimiter();
  if (!result.providerAvailable) {
    return {
      response: jsonError(
        "Anonymous access is temporarily unavailable",
        503,
        "ANONYMOUS_LIMIT_UNAVAILABLE",
      ),
      headers: new Headers(),
    };
  }
  const headers = new Headers({
    "X-Market-RateLimit-Limit": String(result.limit),
    "X-Market-RateLimit-Remaining": String(result.remaining),
    "X-Market-RateLimit-Reset": String(Math.ceil(result.reset / 1_000)),
  });
  if (!result.allowed) {
    headers.set("Retry-After", String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000))));
    return {
      response: Response.json(
        { error: "Anonymous request limit exceeded", code: "ANONYMOUS_RATE_LIMITED" },
        { status: 429, headers },
      ),
      headers: new Headers(),
    };
  }
  return { response: null, headers };
}

function sanitizeHandlerRequest(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("http-referer");
  headers.delete("x-title");
  return new Request(request, { headers });
}

function actorFromKey(key: typeof marketApiKeys.$inferSelect): MarketApiActor {
  return {
    keyId: key.id,
    keyClass: key.keyClass as "public" | "private",
    usageOwnerId: key.usageOwnerId,
    userId: key.userId,
    adminGrantId: key.adminGrantId,
  };
}

function admissionUnavailable() {
  return jsonError("API request admission is temporarily unavailable", 503, "ADMISSION_UNAVAILABLE");
}

function jsonError(message: string, status: number, code: string) {
  return Response.json(
    { error: message, code },
    { status, headers: { "x-market-api": "next" } },
  );
}
