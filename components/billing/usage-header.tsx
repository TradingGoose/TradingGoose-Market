import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { billingCopy, formatBillingUsd, usagePills } from "@/lib/account/billing-presentation";
import type { BillingSummary } from "@/lib/account/contracts";

export function UsageHeaderSkeleton() {
  return <div aria-label="Billing usage preview" aria-busy="true" className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2"><Skeleton className="h-4 w-10 rounded-full" /><Skeleton className="h-4 w-10 rounded-full" /></div>
      <div className="flex items-center gap-1"><Skeleton className="h-3 w-full rounded-full" /><Skeleton className="h-3 w-full rounded-full" /></div>
    </div>
    <Skeleton className="h-2 w-full rounded" />
  </div>;
}

export function UsageHeader({ data, badge, limitEditor, onResolvePayment }: {
  data: BillingSummary; badge?: ReactNode; limitEditor?: ReactNode; onResolvePayment?: () => void;
}) {
  const { usageLimit: limit, billingBlocked: blocked } = data;
  const percent = Math.min(100, Math.max(0, Math.round(limit.percentUsed)));
  return <div className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2"><span className="text-sm font-bold text-foreground">PAYG</span>{badge}</div>
      <div className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        {blocked ? "Payment required" : <><span>{formatBillingUsd(data.currentPeriodCostUsd)}</span><span>/</span>
          {limitEditor ?? <span>{formatBillingUsd(limit.currentLimitUsd ?? "0")}</span>}</>}
      </div>
    </div>
    <div role="progressbar" aria-label="Account spending limit used" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
      className="flex items-center gap-1">
      {usagePills(limit.percentUsed).map((color, index) => <div key={index} className="h-[6px] flex-1 rounded-[2px]" style={{ backgroundColor: color }} />)}
    </div>
    {blocked ? <div className="flex items-center justify-between gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
      {billingCopy.paymentFailed}
      {onResolvePayment && <button type="button" onClick={onResolvePayment} className="relative z-10 font-medium underline underline-offset-2">Resolve payment</button>}
    </div> : limit.status === "exceeded" ? <div className="rounded-sm bg-amber-900/10 px-2 py-1 text-xs text-amber-600">{billingCopy.limitExceeded}</div>
      : limit.status === "warning" && <div className="rounded-sm bg-yellow-900/10 px-2 py-1 text-xs text-yellow-600">{percent}% of your limit used.</div>}
  </div>;
}
