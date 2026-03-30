import { db, schema } from "@tradinggoose/db";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!db) {
    throw new Error("DATABASE_POOL_URL or DATABASE_URL is not configured.");
  }

  const rows = await db.select({ id: schema.user.id }).from(schema.user).limit(1);
  const showSignupLink = rows.length === 0;

  return <LoginForm showSignupLink={showSignupLink} />;
}
