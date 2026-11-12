import { and, eq } from "drizzle-orm";

import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";


export async function getCurrentSystemAdmin(userId: string) {

  const [membership] = await requireDatabase()
    .select()
    .from(schema.systemAdmin)
    .where(
      and(
        eq(schema.systemAdmin.userId, userId),
        eq(schema.systemAdmin.status, "active")
      )
    )
    .limit(1);

  return membership ?? null;
}
