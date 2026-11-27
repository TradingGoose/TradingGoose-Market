"use client";

import { mutationOptions, useIsMutating, useQuery, type QueryClient } from "@tanstack/react-query";
import { marketApiRequest } from "@/hooks/use-market-resource";

type Preferences = { billingUsageNotificationsEnabled: boolean };
const endpoint = "/api/account/billing/notifications";
export const billingSettingsKeys = { settings: (id: string) => ["general-settings", id] as const };

export function useBillingPreferences(userId: string) {
  const queryKey = billingSettingsKeys.settings(userId);
  const pending = useIsMutating({ mutationKey: queryKey });
  return useQuery({ queryKey, queryFn: ({ signal }) => marketApiRequest<Preferences>(endpoint, { signal }), enabled: pending === 0,
    staleTime: 60 * 60 * 1000 });
}

export function refreshPreferences(client: QueryClient, id: string) {
  const queryKey = billingSettingsKeys.settings(id);
  return client.invalidateQueries({ queryKey, refetchType: client.isMutating({ mutationKey: queryKey }) > 0 ? "none" : "active" });
}

export function notificationMutationOptions(client: QueryClient, userId: string) {
  const queryKey = billingSettingsKeys.settings(userId);
  return mutationOptions({
    mutationKey: queryKey,
    mutationFn: (enabled: boolean) => marketApiRequest<Preferences>(endpoint, {
      method: "PATCH", body: JSON.stringify({ billingUsageNotificationsEnabled: enabled }),
    }),
    onMutate: async (enabled) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<Preferences>(queryKey);
      client.setQueryData<Preferences>(queryKey, old => old && ({ ...old, billingUsageNotificationsEnabled: enabled }));
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
}
