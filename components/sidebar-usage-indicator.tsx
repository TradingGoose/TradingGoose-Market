"use client";

import { UsageHeader, UsageHeaderSkeleton } from "@/components/billing/usage-header";
import { useSidebar } from "@/components/ui/sidebar";
import { useSubscriptionData } from "@/hooks/queries/subscription";
import { useBillingPortal } from "@/lib/billing/billing-portal";

export function SidebarUsageIndicator({ onOpenSubscription }: { onOpenSubscription: () => void }) {
  const { state } = useSidebar();
  const { data } = useSubscriptionData();
  const portal = useBillingPortal();
  if (state === "collapsed" || data?.billingEnabled === false) return null;
  return <div className="relative w-full">
    <button type="button" aria-label="PAYG usage, open subscription settings" onClick={onOpenSubscription}
      className="absolute inset-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring" />
    {data ? <UsageHeader data={data} onResolvePayment={data.portalAvailable && !portal.pending ? () => { void portal.open().catch(() => {}); } : undefined} />
      : <UsageHeaderSkeleton />}
    {portal.error && <p role="alert" className="text-xs text-destructive">{portal.error}</p>}
  </div>;
}
