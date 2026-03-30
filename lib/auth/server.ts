import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { defaultAc } from "better-auth/plugins/admin/access";
import { createAuthMiddleware } from "better-auth/plugins";

import { db, schema } from "@tradinggoose/db";

function getBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

function requireDatabase() {
  if (!db) {
    throw new Error("DATABASE_POOL_URL or DATABASE_URL is not configured.");
  }
  return db;
}

const database = requireDatabase();

async function hasExistingUsers() {
  const rows = await database.select({ id: schema.user.id }).from(schema.user).limit(1);
  return rows.length > 0;
}

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  trustedOrigins: [getBaseUrl()].filter(Boolean),
  database: drizzleAdapter(database, {
    provider: "pg",
    schema
  }),
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    freshAge: 60 * 60
  },
  emailAndPassword: {
    enabled: true
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const path = ctx.path?.startsWith("/") ? ctx.path : `/${ctx.path ?? ""}`;
      if (!path.startsWith("/sign-up")) return;
      if (await hasExistingUsers()) {
        throw new Error("Sign up is disabled.");
      }
    })
  },
  plugins: [
    nextCookies(),
    admin({
      defaultRole: "viewer",
      adminRoles: ["admin"],
      roles: {
        admin: defaultAc.newRole({
          user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "get", "update"],
          session: ["list", "revoke", "delete"]
        }),
        editor: defaultAc.newRole({
          user: ["get"],
          session: []
        }),
        viewer: defaultAc.newRole({
          user: ["get"],
          session: []
        })
      }
    })
  ]
});
