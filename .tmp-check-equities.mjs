import { db } from "@tradinggoose/db";
import { sql } from "drizzle-orm";

try {
  const res = await db.execute(sql`select count(*)::int as count from equities`);
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  console.log(rows);
} catch (err) {
  console.error(err?.message ?? err);
}
