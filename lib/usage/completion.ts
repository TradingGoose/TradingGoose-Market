import { marketApiUsageCompletion } from "@tradinggoose/db/schema";
import { eq } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/runtime";

export type UsageResultClass = "success" | "client_error" | "server_error";

export function classifyUsageCompletion(status: number): UsageResultClass {
  if (status >= 200 && status <= 399) return "success";
  if (status >= 400 && status <= 499) return "client_error";
  return "server_error";
}

export async function insertMarketUsageCompletion(eventId: string, status: number) {
  const database = requireDatabase();
  const normalized = Number.isInteger(status) && status >= 200 && status <= 599 ? status : 500;
  const resultClass = classifyUsageCompletion(normalized);
  const inserted = await database
    .insert(marketApiUsageCompletion)
    .values({
      eventId,
      httpStatus: normalized,
      resultClass,
    })
    .onConflictDoNothing({ target: marketApiUsageCompletion.eventId })
    .returning({ eventId: marketApiUsageCompletion.eventId });
  if (inserted[0]) return;
  const existing = await database
    .select({
      httpStatus: marketApiUsageCompletion.httpStatus,
      resultClass: marketApiUsageCompletion.resultClass,
    })
    .from(marketApiUsageCompletion)
    .where(eq(marketApiUsageCompletion.eventId, eventId))
    .limit(1);
  if (
    existing[0]?.httpStatus !== normalized ||
    existing[0]?.resultClass !== resultClass
  ) {
    throw new Error("Usage completion already records a conflicting outcome");
  }
}

export async function completeUsageWithoutChangingResponse(
  eventId: string,
  response: Response,
) {
  try {
    await insertMarketUsageCompletion(eventId, response.status);
  } catch (error) {
    console.error("Market usage completion write failed", {
      eventId,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
  }
  return response;
}
