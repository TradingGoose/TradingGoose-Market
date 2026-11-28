"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Gauge, ReceiptText } from "lucide-react";
import { UsageHeader } from "@/components/billing/usage-header";
import { UsageLimit, type UsageLimitRef } from "@/components/billing/usage-limit";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { billingSettingsKeys, notificationMutationOptions, useBillingPreferences } from "@/hooks/queries/billing-settings";
import { subscriptionKeys, useSubscriptionData, useUsageLimitData } from "@/hooks/queries/subscription";
import { MarketApiError, marketApiRequest } from "@/hooks/use-market-resource";
import { billingCopy, formatBillingUsd, getPersonalPaygAction } from "@/lib/account/billing-presentation";
import { formatCount } from "@/lib/account/format";
import { useBillingPortal } from "@/lib/billing/billing-portal";

function BillingUsageNotificationsToggle({ userId }: { userId: string }) {
  const client = useQueryClient();
  const title = useId(), description = useId(), feedbackId = useId();
  const prefs = useBillingPreferences(userId);
  const mutationKey = billingSettingsKeys.settings(userId);
  const mutation = useMutation(notificationMutationOptions(client, userId));
  const busy = useIsMutating({ mutationKey }) > 0;
  const enabled = prefs.data?.billingUsageNotificationsEnabled;
  const feedback = busy ? "Saving usage notification preference…" : mutation.isError && enabled !== mutation.variables ? "Couldn’t update usage notifications. Try the switch again."
    : prefs.isError ? "Failed to load billing data." : null;
  function change(value: boolean) {
    if (enabled === undefined || value === enabled || client.isMutating({ mutationKey })) return;
    mutation.mutate(value);
  }
  return <div className="mt-4 flex items-start justify-between gap-4">
    <div className="flex flex-col"><span id={title} className="text-sm font-medium">Usage notifications</span>
      <span id={description} className="text-xs text-muted-foreground">Email me when usage reaches the billing warning threshold</span>
      {feedback && <span id={feedbackId} aria-atomic="true" role={busy ? "status" : "alert"} className={busy ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{feedback}</span>}
    </div>
    <Switch checked={enabled ?? false} disabled={busy || enabled === undefined} aria-busy={busy || undefined}
      aria-labelledby={title} aria-describedby={feedback ? `${description} ${feedbackId}` : description} onCheckedChange={change} />
  </div>;
}

export function SubscriptionSettings({ onOpenChange, userId }: { onOpenChange: (open: boolean) => void; userId: string }) {
  const client = useQueryClient();
  const subscription = useSubscriptionData(), limits = useUsageLimitData();
  const data = subscription.data, info = limits.data?.usageLimit;
  const editor = useRef<UsageLimitRef>(null);
  const activating = useRef(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const portal = useBillingPortal();
  const limitPending = useIsMutating({ mutationKey: subscriptionKeys.usage() }) > 0;
  const shouldClose = subscription.isError || (data?.billingEnabled && limits.isError);
  useEffect(() => { if (shouldClose) onOpenChange(false); }, [onOpenChange, shouldClose]);
  if (shouldClose) return null;
  if (data?.billingEnabled === false) return <Alert variant="info" appearance="light"><AlertDescription>
    {billingCopy.disabled}
  </AlertDescription></Alert>;
  if (!data || !info) return <div role="status" aria-label="Loading subscription" className="space-y-3">
    <div className="space-y-2 rounded-md border bg-background p-3 shadow-sm">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Skeleton className="h-5 w-16" />
        <Skeleton className="h-[1.125rem] w-14 rounded-sm" /></div><div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Skeleton className="h-4 w-8" />/<Skeleton className="h-4 w-8" /></div></div>
      <Skeleton className="h-2 w-full rounded" />
    </div>
    <div className="flex flex-col rounded-md border p-4"><div className="mb-4"><Skeleton className="mb-2 h-5 w-8" />
      <div className="flex items-baseline"><Skeleton className="h-6 w-10" /><Skeleton className="ml-1 h-3 w-12" /></div></div>
      <div className="mb-4 space-y-2">{[0, 1, 2].map(i => <div key={i} className="flex items-start gap-2">
        <Skeleton className="mt-0.5 h-3 w-3" /><Skeleton className="h-3 w-20" /></div>)}</div>
      <Skeleton className="h-9 w-full rounded-sm" />
    </div>
  </div>;
  const action = getPersonalPaygAction(data, info.canEdit);
  const isEdit = action === "Increase Limit";
  const busy = pending || portal.pending;
  const available = !data.hasStripeSubscription && !data.billingBlocked && (data.status === null || data.status === "canceled");
  const openPortal = () => { void portal.open().catch(() => {}); };
  async function primaryAction() {
    if (busy || activating.current) return;
    if (isEdit) return editor.current?.startEdit();
    if (action !== "Activate PAYG") return openPortal();
    activating.current = true;
    setPending(true);
    setActionError(null);
    try {
      await marketApiRequest("/api/account/billing/payg/activate", { method: "POST", body: "{}" });
      await Promise.all([client.invalidateQueries({ queryKey: subscriptionKeys.user() }), client.invalidateQueries({ queryKey: subscriptionKeys.usage() })]);
    } catch (error) {
      if (data?.portalAvailable && error instanceof MarketApiError && (error.status === 402 || error.responseCode === "PAYMENT_METHOD_REQUIRED")) {
        await portal.open().catch(() => {});
      } else { setActionError("Failed to activate PAYG"); }
    } finally { activating.current = false; setPending(false); }
  }
  const disabled = busy || (isEdit ? limitPending : action === "Activate PAYG" ? !data.activationAvailable : !data.portalAvailable);
  return <div className="flex flex-col gap-2">
    <div className="mb-2"><UsageHeader data={data}
      badge={<button type="button" className="h-[1.125rem] rounded-sm border border-primary bg-background px-2 text-xs font-bold text-primary disabled:opacity-50"
        disabled={disabled} aria-busy={busy || (isEdit && limitPending) || undefined} onClick={primaryAction}>
        {action}</button>}
      limitEditor={isEdit && info.currentLimitUsd !== null ? <UsageLimit ref={editor} currentLimit={info.currentLimitUsd} currentUsage={data.currentPeriodCostUsd}
        minimumLimit={info.minimumLimitUsd} /> : undefined}
      onResolvePayment={data.portalAvailable && !busy ? openPortal : undefined} /></div>
    <article aria-current="true" className="relative flex flex-col rounded-md border border-primary p-4">
      <header className="mb-4"><h3 className="mb-2 text-sm font-semibold">PAYG</h3>
        <div className="flex items-baseline"><span className="text-xl font-semibold">$0.00</span><span className="ml-1 text-xs text-muted-foreground">/mo</span></div>
      </header>
      <ul className="mb-4 flex-1 space-y-2 text-xs text-muted-foreground">
        <li className="flex items-start gap-2"><CreditCard className="mt-0.5 size-3 shrink-0" />${data.rateUsdPer1000Reads} / 1,000 reads</li>
        <li className="flex items-start gap-2"><ReceiptText className="mt-0.5 size-3 shrink-0" />{formatCount(data.currentPeriodRequestQuantity)} reads this period</li>
        <li className="flex items-start gap-2"><Gauge className="mt-0.5 size-3 shrink-0" /><span>
          {available ? "Available onboarding allowance" : "Reserved onboarding allowance"} {formatBillingUsd(available ? data.availableOnboardingAllowanceUsd : data.grantedOnboardingAllowanceUsd)}
        </span></li>
      </ul>
      <div className="flex h-9 items-center justify-center rounded-sm bg-primary/10 px-4 text-xs font-medium text-primary">Current</div>
    </article>
    {data.nextBillingDate && <div className="mt-4 flex items-center justify-between text-sm"><span className="font-medium">Next Billing Date</span>
      <span className="text-muted-foreground">{new Date(data.nextBillingDate).toLocaleDateString("en-US")}</span></div>}
    {data.hasStripeSubscription && <><BillingUsageNotificationsToggle userId={userId} />
      <div className="mt-2 flex items-center justify-between gap-2"><div>
        <span className="text-sm font-medium">{data.cancelAtPeriodEnd ? "Restore Subscription" : "Manage Subscription"}</span>
        <p className="mt-1 text-xs text-muted-foreground">Open Stripe Billing Portal to cancel, restore, or update your subscription.</p>
      </div><Button variant="outline" className="h-8 rounded-sm text-xs" disabled={!data.portalAvailable || busy} onClick={openPortal}>Manage</Button></div></>}
    {(actionError || portal.error) && <p role="alert" className="text-xs text-destructive">{actionError || portal.error}</p>}
  </div>;
}
