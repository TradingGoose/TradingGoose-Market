import {
  marketApiKeys,
  marketApiUsageEvent,
  marketUsageOwner,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  decimalUsdToNanoUsd,
  nanoUsdToDecimalUsd,
  NANO_USD_PER_USD,
} from "@/lib/billing/money";
import { requireDatabase } from "@/lib/db/runtime";
import { acquireApiKeyLock } from "@/lib/db/locks";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { createSpendLimitCodec } from "@/lib/unkey/spend-limit";
import type { CustomerKeyAllowance } from "./validation";

export class ApiKeyNotFoundError extends Error {
  override readonly name = "ApiKeyNotFoundError";
}

export class ApiKeyRevisionConflict extends Error {
  override readonly name = "ApiKeyRevisionConflict";
}

export async function listCustomerApiKeys(userId: string) {
  const database = requireDatabase();
  const rows = await database
    .select({
      key: marketApiKeys,
      allTimeRequests: count(marketApiUsageEvent.id),
      lastUsedAt: sql<Date | null>`max(${marketApiUsageEvent.admittedAt})`,
    })
    .from(marketApiKeys)
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
    .leftJoin(
      marketApiUsageEvent,
      eq(marketApiUsageEvent.marketApiKeyId, marketApiKeys.id),
    )
    .where(
      and(
        eq(marketUsageOwner.userId, userId),
        eq(marketApiKeys.keyClass, "public"),
      ),
    )
    .groupBy(marketApiKeys.id)
    .orderBy(desc(marketApiKeys.createdAt));

  const keys = [];
  for (const row of rows) {
    const rolling = row.key.spendLimitUsd
      ? await getRollingUsage(row.key.id, row.key.spendLimitUsd, row.key.spendWindowDays!)
      : null;
    keys.push({
      ...safeCustomerKeyFields(row.key),
      totalRequestCount: Number(row.allTimeRequests),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      rollingBillableCostUsd: rolling?.costUsd ?? null,
    });
  }
  return keys;
}

export async function getCustomerApiKeyDetail(userId: string, keyId: string) {
  const database = requireDatabase();
  const rows = await database
    .select({ key: marketApiKeys })
    .from(marketApiKeys)
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
    .where(
      and(
        eq(marketApiKeys.id, keyId),
        eq(marketApiKeys.keyClass, "public"),
        eq(marketUsageOwner.userId, userId),
      ),
    )
    .limit(1);
  const key = rows[0]?.key;
  if (!key) throw new ApiKeyNotFoundError("API key was not found");
  if (key.spendLimitRevision === null) {
    throw new Error("Customer API key allowance revision is missing");
  }

  const aggregate = await database
    .select({
      allTimeRequests: count(marketApiUsageEvent.id),
      lastUsedAt: sql<Date | null>`max(${marketApiUsageEvent.admittedAt})`,
    })
    .from(marketApiUsageEvent)
    .where(eq(marketApiUsageEvent.marketApiKeyId, key.id));
  const rolling = key.spendLimitUsd
    ? await getRollingUsage(key.id, key.spendLimitUsd, key.spendWindowDays!)
    : null;

  return {
    ...safeCustomerKeyFields(key),
    spendLimitRevision: key.spendLimitRevision,
    totalRequestCount: Number(aggregate[0]?.allTimeRequests ?? 0),
    lastUsedAt: aggregate[0]?.lastUsedAt?.toISOString() ?? null,
    rollingWindowRequestCount: rolling?.requestQuantity ?? null,
    rollingBillableCostUsd: rolling?.costUsd ?? null,
    ledgerRemainingUsd: rolling?.remainingUsd ?? null,
    ledgerNextCostEligibleAt: rolling?.nextCostEligibleAt ?? null,
    providerEnforcement: providerEnforcement(key),
  };
}

export async function updateCustomerApiKeyAllowance(input: {
  userId: string;
  keyId: string;
  expectedRevision: number;
  allowance: CustomerKeyAllowance;
}) {
  const database = requireDatabase();
  await database.transaction(async (tx) => {
    await acquireApiKeyLock(tx, input.keyId);
    const rows = await tx
      .select({ key: marketApiKeys })
      .from(marketApiKeys)
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
      .where(
        and(
          eq(marketApiKeys.id, input.keyId),
          eq(marketApiKeys.keyClass, "public"),
          eq(marketUsageOwner.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    const key = rows[0]?.key;
    if (!key) throw new ApiKeyNotFoundError("API key was not found");
    if (key.revocationRequestedAt) {
      throw new ApiKeyRevisionConflict("Revoked API keys cannot be edited");
    }
    if (key.spendLimitRevision !== input.expectedRevision) {
      throw new ApiKeyRevisionConflict("API key allowance revision is stale");
    }
    if (key.spendLimitRevision === null) {
      throw new ApiKeyRevisionConflict("API key allowance revision is unavailable");
    }
    await tx
      .update(marketApiKeys)
      .set({
        spendLimitUsd: input.allowance.limitUsd,
        spendWindowDays: input.allowance.windowDays,
        spendLimitRevision: key.spendLimitRevision + 1,
        spendLimitUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(marketApiKeys.id, input.keyId));
  });
  return getCustomerApiKeyDetail(input.userId, input.keyId);
}

export async function listAdminApiKeys() {
  const database = requireDatabase();
  const rows = await database
    .select({
      key: marketApiKeys,
      adminName: user.name,
      adminEmail: user.email,
      grantStatus: systemAdmin.status,
      totalRequests: count(marketApiUsageEvent.id),
      lastUsedAt: sql<Date | null>`max(${marketApiUsageEvent.admittedAt})`,
    })
    .from(marketApiKeys)
    .leftJoin(user, eq(user.id, marketApiKeys.userId))
    .leftJoin(systemAdmin, eq(systemAdmin.id, marketApiKeys.adminGrantId))
    .leftJoin(
      marketApiUsageEvent,
      eq(marketApiUsageEvent.marketApiKeyId, marketApiKeys.id),
    )
    .where(eq(marketApiKeys.keyClass, "private"))
    .groupBy(marketApiKeys.id, user.name, user.email, systemAdmin.status)
    .orderBy(desc(marketApiKeys.createdAt));
  return rows.map((row) => ({
    ...safeBaseKeyFields(row.key),
    totalRequestCount: Number(row.totalRequests),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    originatingAdminName: row.adminName ?? "Deleted admin",
    originatingAdminEmail: row.adminEmail ?? "Unavailable",
    grantStatus:
      row.grantStatus === "active"
        ? "active"
        : row.grantStatus === "removing"
          ? "removing"
          : "removed",
  }));
}

export async function getRollingUsage(
  keyId: string,
  limitUsd: string,
  windowDays: number,
) {
  const database = requireDatabase();
  return database.transaction(async (tx) => {
    const clockRows = await tx.execute(sql<{ now: Date }>`select now() as now`);
    const [clock] = Array.from(clockRows as Iterable<{ now: Date }>);
    const now = clock?.now ?? new Date();
    const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
    const totals = await tx
      .select({
        requestQuantity: count(marketApiUsageEvent.id),
        costUsd: sql<string>`coalesce(sum(${marketApiUsageEvent.billableCostUsd}), 0)`,
      })
      .from(marketApiUsageEvent)
      .where(
        and(
          eq(marketApiUsageEvent.marketApiKeyId, keyId),
          gte(marketApiUsageEvent.admittedAt, cutoff),
        ),
      );
    const costUsd = totals[0]?.costUsd ?? "0";
    const costNanoUsd = decimalUsdToNanoUsd(costUsd);
    const limitNanoUsd = BigInt(limitUsd) * NANO_USD_PER_USD;
    const remainingNanoUsd =
      limitNanoUsd > costNanoUsd ? limitNanoUsd - costNanoUsd : 0n;
    const nextRequestNanoUsd = getMarketRuntimeConfig().billing.requestNanoUsd;

    let nextCostEligibleAt: string | null = null;
    if (costNanoUsd + nextRequestNanoUsd > limitNanoUsd) {
      const billableEvents = await tx
        .select({
          admittedAt: marketApiUsageEvent.admittedAt,
          costUsd: marketApiUsageEvent.billableCostUsd,
        })
        .from(marketApiUsageEvent)
        .where(
          and(
            eq(marketApiUsageEvent.marketApiKeyId, keyId),
            gte(marketApiUsageEvent.admittedAt, cutoff),
            isNotNull(marketApiUsageEvent.billableCostUsd),
          ),
        )
        .orderBy(asc(marketApiUsageEvent.admittedAt), asc(marketApiUsageEvent.id));
      let releasedNanoUsd = 0n;
      for (let index = 0; index < billableEvents.length; ) {
        const admittedAt = billableEvents[index].admittedAt;
        while (
          index < billableEvents.length &&
          billableEvents[index].admittedAt.getTime() === admittedAt.getTime()
        ) {
          releasedNanoUsd += decimalUsdToNanoUsd(
            billableEvents[index].costUsd ?? "0",
          );
          index += 1;
        }
        if (
          costNanoUsd - releasedNanoUsd + nextRequestNanoUsd <=
          limitNanoUsd
        ) {
          nextCostEligibleAt = new Date(
            admittedAt.getTime() + windowDays * 86_400_000,
          ).toISOString();
          break;
        }
      }
    }
    return {
      requestQuantity: Number(totals[0]?.requestQuantity ?? 0),
      costUsd,
      remainingUsd: nanoUsdToDecimalUsd(remainingNanoUsd),
      nextCostEligibleAt,
      costNanoUsd,
    };
  });
}

function safeBaseKeyFields(key: typeof marketApiKeys.$inferSelect) {
  return {
    id: key.id,
    name: key.name,
    displayValue: key.displayValue,
    status: key.providerRevokedAt
      ? "revoked"
      : key.revocationRequestedAt
        ? "revocation_pending"
        : "available",
    createdAt: key.createdAt.toISOString(),
  };
}

function safeCustomerKeyFields(key: typeof marketApiKeys.$inferSelect) {
  return {
    ...safeBaseKeyFields(key),
    spendLimitUsd: key.spendLimitUsd,
    spendWindowDays: key.spendWindowDays,
  };
}

function providerEnforcement(key: typeof marketApiKeys.$inferSelect) {
  if (!key.spendLimitUsd) {
    return {
      status: "unlimited",
      remainingUsdUpperBound: null,
      resetAt: null,
      decision: null,
      observedRevision: null,
      observedAt: null,
      mayBeMoreRestrictive: false,
    };
  }
  const billingDisabled = !getMarketRuntimeConfig().billing.enabled;
  if (
    key.providerObservedRevision === null ||
    key.providerQuantumNanoUsd === null ||
    key.providerLimitUnits === null ||
    key.providerRemainingUnits === null ||
    key.providerDurationMs === null ||
    key.providerResetAt === null ||
    key.providerDecision === null ||
    key.providerObservedAt === null
  ) {
    return {
      status: billingDisabled ? "disabled" : "unobserved",
      remainingUsdUpperBound: null,
      resetAt: null,
      decision: null,
      observedRevision: null,
      observedAt: null,
      mayBeMoreRestrictive: true,
    };
  }
  const upperNanoUsd =
    BigInt(key.providerQuantumNanoUsd) * BigInt(key.providerRemainingUnits);
  const codec = createSpendLimitCodec(key.spendLimitUsd, key.spendWindowDays!);
  const observationMatchesCurrentConfiguration =
    key.providerObservedRevision === key.spendLimitRevision &&
    key.providerQuantumNanoUsd === codec.quantumNanoUsd.toString() &&
    key.providerLimitUnits === String(codec.providerLimit) &&
    key.providerDurationMs === String(codec.duration) &&
    key.providerResetAt.getTime() > Date.now();
  return {
    status: billingDisabled
      ? "disabled"
      : observationMatchesCurrentConfiguration
        ? "current"
        : "stale",
    remainingUsdUpperBound: nanoUsdToDecimalUsd(upperNanoUsd),
    resetAt: key.providerResetAt.toISOString(),
    decision: key.providerDecision,
    observedRevision: key.providerObservedRevision,
    observedAt: key.providerObservedAt.toISOString(),
    mayBeMoreRestrictive: true,
  };
}
