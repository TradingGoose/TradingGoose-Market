"use client";

import { keepPreviousData, mutationOptions, useIsMutating, useQuery, type QueryClient } from "@tanstack/react-query";
import { marketApiRequest } from "@/hooks/use-market-resource";
import type { BillingSummary, UsageLimitInfo } from "@/lib/account/contracts";

const billing = "/api/account/billing";
export const subscriptionKeys = {
  user: () => ["subscription", "user"] as const,
  usage: () => ["subscription", "usage"] as const,
};
type LimitResponse = { usageLimit: UsageLimitInfo };

export function useSubscriptionData() {
  const pending = useIsMutating({ mutationKey: subscriptionKeys.usage() });
  return useQuery({ queryKey: subscriptionKeys.user(), queryFn: ({ signal }) => marketApiRequest<BillingSummary>(billing, { signal }),
    enabled: pending === 0, placeholderData: keepPreviousData, staleTime: 30_000 });
}

export function useUsageLimitData() {
  const pending = useIsMutating({ mutationKey: subscriptionKeys.usage() });
  return useQuery({ queryKey: subscriptionKeys.usage(), queryFn: ({ signal }) => marketApiRequest<LimitResponse>(billing + "/usage-limit", { signal }),
    enabled: pending === 0, placeholderData: keepPreviousData, staleTime: 30_000 });
}

export function refreshSubscription(client: QueryClient) {
  const refetchType = client.isMutating({ mutationKey: subscriptionKeys.usage() }) > 0 ? "none" : "active";
  return Promise.all([
    client.invalidateQueries({ queryKey: subscriptionKeys.user(), refetchType }),
    client.invalidateQueries({ queryKey: subscriptionKeys.usage(), refetchType }),
  ]);
}

export const subscriptionMutationOptions = {
  updateUsageLimit(client: QueryClient) {
    const user = subscriptionKeys.user(), usage = subscriptionKeys.usage();
    return mutationOptions({
      mutationKey: usage,
      mutationFn: (limitUsd: string) => marketApiRequest<LimitResponse>(billing + "/usage-limit", {
        method: "PUT", body: JSON.stringify({ limitUsd }),
      }),
      onMutate: async (limitUsd) => {
        await Promise.all([client.cancelQueries({ queryKey: user }), client.cancelQueries({ queryKey: usage })]);
        const previousSubscription = client.getQueryData<BillingSummary>(user);
        const previousLimit = client.getQueryData<LimitResponse>(usage);
        client.setQueryData<BillingSummary>(user, old => old && ({ ...old, usageLimit: {
          ...old.usageLimit, currentLimitUsd: limitUsd,
          percentUsed: Number(limitUsd) > 0 ? Number(old.currentPeriodCostUsd) / Number(limitUsd) * 100 : 0,
        } }));
        client.setQueryData<LimitResponse>(usage, old => old && ({ usageLimit: { ...old.usageLimit, currentLimitUsd: limitUsd } }));
        return { previousSubscription, previousLimit };
      },
      onError: (_err, _limit, context) => {
        if (context?.previousSubscription) client.setQueryData(user, context.previousSubscription);
        if (context?.previousLimit) client.setQueryData(usage, context.previousLimit);
      },
      onSettled: () => Promise.all([client.invalidateQueries({ queryKey: user }), client.invalidateQueries({ queryKey: usage })]),
    });
  },
};
