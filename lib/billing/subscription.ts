import { subscription } from "@tradinggoose/db/schema";
import { and, eq } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/runtime";

export const ACTIVE_PAYG_STATUS = "active" as const;
export const PAYG_ACTIVATION_ATTEMPT_METADATA_KEY = "paygActivationAttemptId" as const;

export function normalizeSubscriptionMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function getPaygActivationAttemptId(value: unknown) {
  const candidate = normalizeSubscriptionMetadata(value)[
    PAYG_ACTIVATION_ATTEMPT_METADATA_KEY
  ];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export function withPaygActivationAttemptId(value: unknown, attemptId: string) {
  return {
    ...normalizeSubscriptionMetadata(value),
    [PAYG_ACTIVATION_ATTEMPT_METADATA_KEY]: attemptId,
  };
}

export function withoutPaygActivationAttemptId(value: unknown) {
  const metadata = normalizeSubscriptionMetadata(value);
  delete metadata[PAYG_ACTIVATION_ATTEMPT_METADATA_KEY];
  return Object.keys(metadata).length ? metadata : null;
}

export async function getDefaultPaygSubscription(userId: string, database = requireDatabase()) {
  const rows = await database
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, "user"),
        eq(subscription.referenceId, userId),
        eq(subscription.plan, "payg"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getPaygSubscriptionByStripeId(
  stripeSubscriptionId: string,
  database = requireDatabase(),
) {
  const rows = await database
    .select()
    .from(subscription)
    .where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return rows[0] ?? null;
}

export function isPaygActive(status: string | null | undefined) {
  return status === ACTIVE_PAYG_STATUS;
}
