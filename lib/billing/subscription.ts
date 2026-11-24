import { subscription } from "@tradinggoose/db/schema";
import { eq } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/runtime";

export const PAYG_ACTIVATION_ATTEMPT_METADATA_KEY = "paygActivationAttemptId" as const;
const PAYG_ACTIVATION_PRICE_METADATA_KEY = "paygActivationPriceId" as const;

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

export function getPaygActivationPriceId(value: unknown) {
  const candidate = normalizeSubscriptionMetadata(value)[PAYG_ACTIVATION_PRICE_METADATA_KEY];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export function getPaygActivationStartedAt(value: unknown) {
  const startedAt = normalizeSubscriptionMetadata(value).paygActivationStartedAt;
  return typeof startedAt === "string" ? startedAt : null;
}

export function getPaygActivationCandidateId(value: unknown) {
  const id = normalizeSubscriptionMetadata(value).paygActivationCandidateId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function withPaygActivationAttemptId(
  value: unknown, attemptId: string, priceId: string, startedAt: Date, candidateId: string | null = null,
) {
  return {
    ...normalizeSubscriptionMetadata(value),
    [PAYG_ACTIVATION_ATTEMPT_METADATA_KEY]: attemptId,
    [PAYG_ACTIVATION_PRICE_METADATA_KEY]: priceId,
    paygActivationStartedAt: startedAt.toISOString(),
    paygActivationPostPossible: false,
    ...(candidateId && { paygActivationCandidateId: candidateId }),
  };
}

export function withoutPaygActivationAttemptId(value: unknown) {
  const metadata = normalizeSubscriptionMetadata(value);
  delete metadata[PAYG_ACTIVATION_ATTEMPT_METADATA_KEY];
  delete metadata[PAYG_ACTIVATION_PRICE_METADATA_KEY];
  delete metadata.paygActivationStartedAt;
  delete metadata.paygActivationCandidateId;
  delete metadata.paygActivationPostPossible;
  return Object.keys(metadata).length ? metadata : null;
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
