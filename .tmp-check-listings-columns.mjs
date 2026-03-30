import { db } from "@tradinggoose/db";
import { sql } from "drizzle-orm";

const res = await db.execute(sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public' and table_name = 'listings'
  order by ordinal_position
`);
const rows = Array.isArray(res) ? res : (res.rows ?? []);
console.log(rows);
