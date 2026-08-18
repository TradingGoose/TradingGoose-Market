import {
  marketApiKeys,
  marketApiUsageEvent,
  marketUsageOwner,
  subscription,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoUsdToDecimalUsd } from "@/lib/billing/money";
import { checkAndBillMarketThreshold } from "@/lib/billing/threshold-billing";
import {
  acquireAdminGrantLock,
  acquireApiKeyLock,
  withAdminGrantHandlerLock,
  withBillingSubjectAndApiKeyHandlerLocks,
} from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { createAnonymousLimiter } from "@/lib/unkey/anonymous";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";
import {
  consumeSpendLimit,
  createSpendLimitCodec,
  exactRequiredProviderUnits,
  probeSpendLimit,
  providerCostForRequest,
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
    return jsonError(
      "API request admission is temporarily unavailable",
      503,
      "ADMISSION_UNAVAILABLE",
    );
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
        attribution,
      });
      if ("response" in admitted) return admitted.response;
      return invokeKeyedHandler(request, handler, admitted.actor, admitted.eventId);
    }
    if (!mapping.adminGrantId) {
      return jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN");
    }
    return await withAdminGrantHandlerLock(mapping.adminGrantId, async (reservedDatabase) => {
      const admitted = await reservedDatabase.transaction(async (tx) => {
        await acquireAdminGrantLock(tx, mapping.adminGrantId!);
        await acquireApiKeyLock(tx, mapping.id);
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
          .for("update")
          .limit(1);
        const row = rows[0];
        if (
          !row ||
          row.key.keyClass !== "private" ||
          row.key.revocationRequestedAt ||
          row.key.providerRevokedAt ||
          row.grant.status !== "active" ||
          row.key.adminGrantId !== row.grant.id ||
          row.key.userId !== row.activeUserId ||
          row.owner.userId !== row.activeUserId ||
          row.emailVerified !== true
        ) {
          throw new AccessResponseError(
            jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN"),
          );
        }
        const actor = actorFromKey(row.key);
        const admittedAt = await databaseNow(tx);
        const eventId = await insertMarketUsageAdmission({
          tx,
          actor,
          descriptor,
          method: request.method as "POST",
          billingMode: "disabled",
          rateUsdPer1000Reads: null,
          billableCostUsd: null,
          attribution,
          admittedAt,
        });
        return { actor, eventId };
      });
      return invokeKeyedHandler(request, handler, admitted.actor, admitted.eventId);
    });
  } catch (error) {
    if (error instanceof AccessResponseError) return error.response;
    console.error("Market API admission failed", {
      routeId: descriptor.id,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError("API request admission is temporarily unavailable", 503, "ADMISSION_UNAVAILABLE");
  }
}

async function admitPublicRequest(input: {
  request: Request;
  descriptor: KeyedMarketRouteDescriptor;
  rawKey: string;
  keyId: string;
  attribution: ReturnType<typeof parseMarketAppAttribution>;
}) {
  const database = requireDatabase();
  const config = getMarketRuntimeConfig();
  const initial = await database
    .select({ userId: marketApiKeys.userId })
    .from(marketApiKeys)
    .where(eq(marketApiKeys.id, input.keyId))
    .limit(1);
  const userId = initial[0]?.userId;
  if (!userId) {
    throw new AccessResponseError(
      jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN"),
    );
  }

  if (!config.billing.enabled) {
    return database.transaction(async (tx) => {
      await acquireApiKeyLock(tx, input.keyId);
      const row = await reloadAuthorizedPublicKey(tx, input.keyId, userId, false);
      const actor = actorFromKey(row.key);
      const admittedAt = await databaseNow(tx);
      const eventId = await insertMarketUsageAdmission({
        tx,
        actor,
        descriptor: input.descriptor,
        method: input.request.method as "GET" | "HEAD",
        billingMode: "disabled",
        rateUsdPer1000Reads: null,
        billableCostUsd: null,
        attribution: input.attribution,
        admittedAt,
      });
      return { actor, eventId };
    });
  }

  return withBillingSubjectAndApiKeyHandlerLocks(
    userId,
    input.keyId,
    async (lockedDatabase) => {
      const spendDenial = await lockedDatabase.transaction(async (tx) => {
        const row = await reloadAuthorizedPublicKey(tx, input.keyId, userId, true);
        if (!row.key.spendLimitUsd || !row.key.spendWindowDays) return null;
        return enforceProviderSpendWindow(tx, row.key, input.rawKey);
      });
      if (spendDenial) return { response: spendDenial };

      const admitted = await lockedDatabase.transaction(async (tx) => {
        const row = await reloadAuthorizedPublicKey(tx, input.keyId, userId, true);
        const admittedAt = await databaseNow(tx);
        if (row.key.spendLimitUsd && row.key.spendWindowDays) {
          await requireExactSpendCapacity(tx, row.key, admittedAt);
        }
        const actor = actorFromKey(row.key);
        const eventId = await insertMarketUsageAdmission({
          tx,
          actor,
          descriptor: input.descriptor,
          method: input.request.method as "GET" | "HEAD",
          billingMode: "enabled",
          rateUsdPer1000Reads: config.billing.usdPer1000Reads,
          billableCostUsd: nanoUsdToDecimalUsd(config.billing.requestNanoUsd),
          attribution: input.attribution,
          admittedAt,
        });
        return { actor, eventId };
      });

      try {
        await lockedDatabase.transaction((tx) =>
          checkAndBillMarketThreshold(tx, userId),
        );
      } catch (error) {
        console.error("Market threshold billing deferred after committed admission", {
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
      }
      return admitted;
    },
  );
}

async function reloadAuthorizedPublicKey(
  tx: MarketTransaction,
  keyId: string,
  expectedUserId: string,
  requireActiveBilling: boolean,
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
    .for("update")
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
    row.emailVerified !== true
  ) {
    throw new AccessResponseError(
      jsonError("API key is not authorized", 403, "API_KEY_FORBIDDEN"),
    );
  }

  if (requireActiveBilling) {
    const subscriptions = await tx
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceType, "user"),
          eq(subscription.referenceId, row.activeUserId),
          eq(subscription.plan, "payg"),
        ),
      )
      .for("update")
      .limit(1);
    const payg = subscriptions[0];
    if (
      !payg ||
      payg.status !== "active" ||
      !payg.stripeCustomerId ||
      !payg.stripeSubscriptionId
    ) {
      throw new AccessResponseError(
        jsonError("Active billing is required", 402, "BILLING_REQUIRED"),
      );
    }
  }
  return row;
}

async function enforceProviderSpendWindow(
  tx: MarketTransaction,
  key: typeof marketApiKeys.$inferSelect,
  rawKey: string,
): Promise<Response | null> {
  const config = getMarketRuntimeConfig();
  const codec = createSpendLimitCodec(key.spendLimitUsd!, key.spendWindowDays!);
  const cutoff = sql`now() - (${key.spendWindowDays!} * interval '1 day')`;
  const totals = await tx
    .select({
      cost: sql<string>`coalesce(sum(${marketApiUsageEvent.billableCostUsd}), 0)`,
    })
    .from(marketApiUsageEvent)
    .where(
      and(
        eq(marketApiUsageEvent.marketApiKeyId, key.id),
        gte(marketApiUsageEvent.admittedAt, cutoff),
      ),
    );
  const exactRollingNanoUsd = decimalUsdToNanoUsd(totals[0]?.cost ?? "0");
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
      await persistSpendObservation(tx, key, observation);
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

async function requireExactSpendCapacity(
  tx: MarketTransaction,
  key: typeof marketApiKeys.$inferSelect,
  admittedAt: Date,
) {
  const config = getMarketRuntimeConfig();
  const codec = createSpendLimitCodec(key.spendLimitUsd!, key.spendWindowDays!);
  const cutoff = new Date(
    admittedAt.getTime() - key.spendWindowDays! * 86_400_000,
  );
  const totals = await tx
    .select({
      cost: sql<string>`coalesce(sum(${marketApiUsageEvent.billableCostUsd}), 0)`,
    })
    .from(marketApiUsageEvent)
    .where(
      and(
        eq(marketApiUsageEvent.marketApiKeyId, key.id),
        gte(marketApiUsageEvent.admittedAt, cutoff),
      ),
    );
  const exactRollingNanoUsd = decimalUsdToNanoUsd(totals[0]?.cost ?? "0");
  if (exactRollingNanoUsd + config.billing.requestNanoUsd > codec.limitNanoUsd) {
    throw new AccessResponseError(
      jsonError(
        "API key spend limit exceeded",
        429,
        "API_KEY_SPEND_LIMIT_EXCEEDED",
      ),
    );
  }
}

async function databaseNow(tx: MarketTransaction) {
  const clockRows = await tx.execute(sql<{ now: Date }>`select now() as now`);
  const [clock] = Array.from(clockRows as Iterable<{ now: Date }>);
  if (!clock?.now) throw new Error("Database clock is unavailable");
  return clock.now;
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

async function invokeAnonymousHandler(request: Request, handler: MarketHandler) {
  try {
    return await handler(createApiContext(sanitizeHandlerRequest(request)), null);
  } catch {
    return jsonError("Internal server error", 500, "INTERNAL_ERROR");
  }
}

async function invokeKeyedHandler(
  request: Request,
  handler: MarketHandler,
  actor: MarketApiActor,
  eventId: string,
) {
  let response: Response;
  try {
    response = await handler(createApiContext(sanitizeHandlerRequest(request)), actor);
  } catch {
    response = jsonError("Internal server error", 500, "INTERNAL_ERROR");
  }
  return completeUsageWithoutChangingResponse(eventId, response);
}

async function enforceAnonymousPolicy(): Promise<{
  response: Response | null;
  headers: Headers;
}> {
  const policy = getMarketRuntimeConfig().unkey.anonymous;
  if (!policy) return { response: null, headers: new Headers() };
  const signature = [
    policy.limit,
    policy.durationSeconds,
    policy.namespaceId,
    policy.rootKey,
  ].join("\u0000");
  if (!anonymousLimiter || anonymousLimiterSignature !== signature) {
    const nextLimiter = createAnonymousLimiter(policy);
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

function jsonError(message: string, status: number, code: string) {
  return Response.json(
    { error: message, code },
    { status, headers: { "x-market-api": "next" } },
  );
}
