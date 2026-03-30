import { notFound } from "next/navigation";

import { db, schema } from "@tradinggoose/db";
import SignupForm from "./signup-form";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (!db) {
    throw new Error("DATABASE_POOL_URL or DATABASE_URL is not configured.");
  }

  const rows = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  if (rows.length > 0) {
    notFound();
  }

  return <SignupForm />;
}
