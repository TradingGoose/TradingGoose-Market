import { db } from "@tradinggoose/db";
import { sql } from "drizzle-orm";

const res = await db.execute(sql`select to_regclass('public.equities') as equities, to_regclass('public.listings') as listings`);
const rows = Array.isArray(res) ? res : (res.rows ?? []);
console.log(rows);
