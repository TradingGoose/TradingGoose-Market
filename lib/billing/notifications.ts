import { after } from "next/server";
import { user, userStats } from "@tradinggoose/db/schema";
import { render } from "@react-email/render";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { Resend } from "resend";
import type Stripe from "stripe";
import { z } from "zod";
import { BillingEmail, billingSubjects, type BillingEmailMessage } from "@/components/emails/billing-email";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { nanoUsdToDecimalUsd } from "./money";
import { notificationToken } from "./notification-token";

async function send(to: string, message: BillingEmailMessage, unsubscribeApiUrl?: string) {
  const { resend } = getMarketRuntimeConfig();
  const element = createElement(BillingEmail, { message });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const { error } = await new Resend(resend.apiKey).emails.send({
    from: resend.fromEmail, to, subject: billingSubjects[message.kind], html, text,
    ...(unsubscribeApiUrl && { headers: {
      "List-Unsubscribe": `<${unsubscribeApiUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    } }),
  });
  if (error) throw new Error("Billing email delivery failed");
}

export function scheduleUsageThresholdEmail(userId: string, usageBefore: bigint, usageAfter: bigint, limit: bigint) {
  function reportFailure(error: unknown) {
    console.error("Usage notification failed", { userId, errorClass: error instanceof Error ? error.name : "UnknownError" });
  }
  try {
    const config = getMarketRuntimeConfig();
    if (!config.billing.enabled || limit <= 0n) return;
    const crosses = (threshold: bigint) => usageBefore * 100n < limit * threshold && usageAfter * 100n >= limit * threshold;
    const warning = crosses(80n);
    const upgrade = crosses(90n);
    if (!warning && !upgrade) return;

    after(async () => {
      try {
        const [recipient] = await requireDatabase().select({
          email: user.email, name: user.name, enabled: userStats.billingUsageNotificationsEnabled, preferences: userStats.emailPreferences,
        }).from(user).innerJoin(userStats, eq(userStats.userId, user.id)).where(eq(user.id, userId)).limit(1);
        if (!recipient?.enabled || recipient.preferences.unsubscribeAll || recipient.preferences.unsubscribeNotifications) return;
        const params = new URLSearchParams({ email: recipient.email, token: notificationToken(userId, recipient.email) });
        for (const kind of ["usage", "upgrade"] as const) {
          if (kind === "usage" ? !warning : !upgrade) continue;
          await send(recipient.email, {
            kind, name: recipient.name, url: `${config.appUrl}/account/api-keys?billing=${kind}`,
            unsubscribe: `${config.appUrl}/unsubscribe?${params}`, current: nanoUsdToDecimalUsd(usageAfter),
            limit: nanoUsdToDecimalUsd(limit), percent: Math.min(100, Math.round(Number(usageAfter) / Number(limit) * 100)),
          }, `${config.appUrl}/api/billing/notifications/unsubscribe?${params}`);
        }
      } catch (error) {
        reportFailure(error);
      }
    });
  } catch (error) {
    reportFailure(error);
  }
}

async function paymentDetails(stripe: Stripe, invoice: Stripe.Invoice) {
  const payments = invoice.payments;
  const payment = (payments?.data.find(p => p.is_default) ??
    (payments?.data.length === 1 && !payments.has_more ? payments.data[0] : undefined))?.payment;
  let reason = invoice.last_finalization_error?.message;
  let lastFour: string | undefined;
  try {
    let chargeRef: string | Stripe.Charge | null | undefined;
    if (payment?.type === "payment_intent" && payment.payment_intent) {
      const ref = payment.payment_intent;
      const intent = typeof ref === "string" ? await stripe.paymentIntents.retrieve(ref) : ref;
      const failure = intent.last_payment_error;
      reason ??= failure?.message;
      if (failure?.payment_method) lastFour = failure.payment_method.card?.last4;
      else chargeRef = failure?.charge ?? intent.latest_charge;
    } else if (payment?.type === "charge") {
      chargeRef = payment.charge;
    }
    if (chargeRef) {
      const charge = typeof chargeRef === "string" ? await stripe.charges.retrieve(chargeRef) : chargeRef;
      if (charge.status === "failed") {
        lastFour = charge.payment_method_details?.card?.last4 ?? undefined;
        reason ??= charge.failure_message ?? undefined;
      }
    }
  } catch { console.warn("Invoice failure details unavailable", { invoiceId: invoice.id }); }
  return { lastFour, reason };
}

export async function sendMarketPaymentFailureEmail(stripe: Stripe, userId: string, invoice: Stripe.Invoice) {
  try {
    if (!invoice.hosted_invoice_url) return;
    const [recipient] = await requireDatabase().select({ name: user.name, email: user.email }).from(user)
      .where(eq(user.id, userId)).limit(1);
    if (!recipient || !z.string().email().safeParse(recipient.email).success) return;
    await send(recipient.email, { kind: "payment", name: recipient.name, url: invoice.hosted_invoice_url,
      amount: invoice.amount_due / 100, ...await paymentDetails(stripe, invoice) });
  } catch (error) {
    console.error("Payment recovery email failed", { invoiceId: invoice.id, errorClass: error instanceof Error ? error.name : "UnknownError" });
  }
}
