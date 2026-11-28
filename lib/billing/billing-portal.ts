"use client";

import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { marketApiRequest } from "@/hooks/use-market-resource";

export async function openBillingPortal() {
  const result = await marketApiRequest<{ url: string }>("/api/account/billing/portal", { method: "POST", body: "{}" });
  if (!result.url) throw new Error("Failed to open billing portal");
  window.location.assign(result.url);
}

const mutationKey = ["billing-portal"];
export function useBillingPortal() {
  const client = useQueryClient();
  const pending = useIsMutating({ mutationKey });
  const mutation = useMutation({ mutationKey, mutationFn: openBillingPortal });
  return {
    open: async () => {
      if (!client.isMutating({ mutationKey })) await mutation.mutateAsync();
    },
    pending: pending > 0 || mutation.isPending,
    error: mutation.isError ? "Failed to open billing portal" : null,
  };
}
