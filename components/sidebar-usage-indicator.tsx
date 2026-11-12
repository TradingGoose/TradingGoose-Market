"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSidebar } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketResource } from "@/hooks/use-market-resource";
import type { BillingSummary } from "@/lib/account/contracts";
import { formatCount, formatUsd } from "@/lib/account/format";

function UsagePreviewSkeleton() {
  return (
    <Card aria-label="Billing usage preview" aria-busy="true" className="rounded-md bg-background shadow-xs">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-3"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-12" /></div>
        <div className="flex items-center justify-between gap-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-14" /></div>
      </CardContent>
    </Card>
  );
}

export function SidebarUsageIndicator({ onOpenSubscription }: { onOpenSubscription: () => void }) {
  const { state } = useSidebar();
  const { data, isLoading, error } = useMarketResource<BillingSummary>("/api/account/billing");
  if (state === "collapsed") return null;
  if (data?.billingEnabled === false) return null;
  if (isLoading || error || !data) return <UsagePreviewSkeleton />;

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpenSubscription}
      className="h-auto w-full flex-col items-stretch gap-2 p-3 text-left shadow-xs"
    >
      <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">PAYG usage</span><span className="text-xs tabular-nums text-muted-foreground">{formatUsd(data.currentPeriodCostUsd)}</span></div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{formatCount(data.currentPeriodRequestQuantity)} requests</span><span>${data.rateUsdPer1000Reads}/1K</span></div>
    </Button>
  );
}
