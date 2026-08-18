import {
  marketApiUsageEvent,
  userStats,
} from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq, sql } from "drizzle-orm";
import type { KeyedMarketRouteDescriptor } from "@/lib/market-api/core/manifest";
import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { MarketAppAttribution } from "./attribution";

type AdmissionClient = MarketTransaction;

export async function insertMarketUsageAdmission(input: {
  tx: AdmissionClient;
  actor: MarketApiActor;
  descriptor: KeyedMarketRouteDescriptor;
  method: "GET" | "HEAD" | "POST";
  billingMode: "enabled" | "disabled";
  rateUsdPer1000Reads: string | null;
  billableCostUsd: string | null;
  attribution: MarketAppAttribution;
  admittedAt: Date;
}) {
  const billable =
    input.actor.keyClass === "public" && input.billingMode === "enabled";
  if (billable && (!input.rateUsdPer1000Reads || !input.billableCostUsd)) {
    throw new Error("Enabled public admission is missing its exact billing snapshot");
  }

  const eventId = crypto.randomUUID();
  await input.tx.insert(marketApiUsageEvent).values({
    id: eventId,
    usageOwnerId: input.actor.usageOwnerId,
    marketApiKeyId: input.actor.keyId,
    keyClass: input.actor.keyClass,
    routeId: input.descriptor.id,
    category: input.descriptor.category,
    resourceId: input.descriptor.resource.id,
    method: input.method,
    apiVersion: "v1",
    billingMode: input.billingMode,
    billableQuantity: billable ? 1 : 0,
    rateUsdPer1000Reads: billable ? input.rateUsdPer1000Reads : null,
    billableCostUsd: billable ? input.billableCostUsd : null,
    applicationUrl: input.attribution.url,
    applicationTitle: input.attribution.title,
    admittedAt: input.admittedAt,
  });

  if (billable) {
    if (!input.actor.userId) {
      throw new Error("Billable usage actor is missing its active user identity");
    }
    const rows = await input.tx
      .select({
        id: userStats.id,
        userId: userStats.userId,
        usageOwnerId: userStats.usageOwnerId,
        billingReferenceId: userStats.billingReferenceId,
      })
      .from(userStats)
      .where(
        and(
          eq(userStats.userId, input.actor.userId),
          eq(userStats.usageOwnerId, input.actor.usageOwnerId),
          eq(userStats.billingReferenceId, input.actor.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!rows[0]) throw new Error("Usage accumulator is missing");
    await input.tx
      .update(userStats)
      .set({
        totalRequestQuantity: sql`${userStats.totalRequestQuantity} + 1`,
        currentPeriodRequestQuantity: sql`${userStats.currentPeriodRequestQuantity} + 1`,
        totalCost: sql`${userStats.totalCost} + ${input.billableCostUsd}`,
        currentPeriodCost: sql`${userStats.currentPeriodCost} + ${input.billableCostUsd}`,
        lastActive: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userStats.id, rows[0].id));
  }
  return eventId;
}
