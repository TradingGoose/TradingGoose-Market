import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { user, userStats } from "@tradinggoose/db/schema";
import type { MarketDatabase, MarketTransaction } from "@tradinggoose/db";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { notificationTokenPattern, validNotificationToken } from "@/lib/billing/notification-token";
import { requireDatabase } from "@/lib/db/runtime";
import { withBillingSubjectLock } from "@/lib/db/locks";
import { browserRouteDescriptor, rejectBrowserHead, rejectBrowserMethod, rejectBrowserOptions } from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/billing/notifications/unsubscribe";
browserRouteDescriptor(TEMPLATE, "GET");
browserRouteDescriptor(TEMPLATE, "POST");

const identity = z.object({ email: z.string().email(), token: z.string().regex(notificationTokenPattern) }).strict();
const confirmation = identity.extend({ type: z.enum(["notifications", "all"]) });
const invalid = () => Response.json({ success: false, code: "invalid-link" }, { status: 400 });

function recipient(email: string, db: MarketDatabase | MarketTransaction = requireDatabase()) {
  return db.select({ id: user.id, currentPreferences: userStats.emailPreferences }).from(user)
    .innerJoin(userStats, eq(userStats.userId, user.id)).where(eq(user.email, email)).limit(1);
}

async function verifiedRecipient({ email, token }: z.infer<typeof identity>) {
  const [row] = await recipient(email);
  return row && validNotificationToken(row.id, email, token) ? row : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = identity.safeParse(Object.fromEntries(params));
  if (!parsed.success) return invalid();
  const row = await verifiedRecipient(parsed.data);
  if (!row) return invalid();
  if (request.headers.get("accept")?.includes("text/html")) {
    const page = new URL("/unsubscribe", getMarketRuntimeConfig().appUrl);
    page.search = params.toString();
    return NextResponse.redirect(page);
  }
  return Response.json({ success: true, ...parsed.data, emailType: "notifications", isTransactional: false,
    currentPreferences: row.currentPreferences });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  const oneClick = contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data";
  let payload: unknown;
  if (oneClick) {
    const form = await request.formData().catch(() => null);
    if (form?.get("List-Unsubscribe") !== "One-Click") return invalid();
    payload = { ...Object.fromEntries(new URL(request.url).searchParams), type: "notifications" };
  } else if (contentType === "application/json") {
    payload = await request.json().catch(() => null);
  }
  const parsed = confirmation.safeParse(payload);
  if (!parsed.success) return invalid();
  const { email, type } = parsed.data;
  const owner = await verifiedRecipient(parsed.data);
  if (!owner) return invalid();
  return withBillingSubjectLock(owner.id, async tx => {
    const [current] = await recipient(email, tx).for("update", { of: user });
    if (!current || current.id !== owner.id) return invalid();
    const flag = type === "all" ? "unsubscribeAll" : "unsubscribeNotifications";
    await tx.update(userStats).set({ emailPreferences: { ...current.currentPreferences, [flag]: true }, updatedAt: new Date() })
      .where(eq(userStats.userId, owner.id));
    return oneClick ? new Response(null, { status: 200 }) : Response.json({
      success: true, code: "success", email, type, emailType: "notifications", message: `Successfully unsubscribed from ${type} emails`,
    });
  });
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
