import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { schema } from "@tradinggoose/db";
import {
  ensureMarketCustomerState,
  ensureStripeUserCustomer
} from "@/lib/billing/customer-state";
import {
  logAuthEmailDeliveryFailure,
  projectVerifiedEmailToAudience,
  sendMarketAuthEmail,
} from "@/lib/auth/mailer";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";

const DISABLED_AUTH_PATHS = [
  "/account-info",
  "/callback/:id",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/email-otp/check-verification-otp",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/email-otp/verify-email",
  "/error",
  "/forget-password/email-otp",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/refresh-token",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/social",
  "/unlink-account",
  "/verify-password"
] as const;

const marketDb = requireDatabase();

const runtime = getMarketRuntimeConfig();

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function successfulSignupUserId(path: string, returned: unknown): string | null {
  if (path !== "/sign-up/email" || !returned || typeof returned !== "object") {
    return null;
  }
  const user = "user" in returned ? returned.user : null;
  if (!user || typeof user !== "object" || !("id" in user)) return null;
  return typeof user.id === "string" && user.id ? user.id : null;
}

async function initializeMarketAuthUser(userId: string): Promise<boolean> {
  try {
    await ensureMarketCustomerState(userId);
  } catch (error) {
    console.error("Market customer initialization failed.", {
      operation: "post-commit-auth-initialization",
      errorClass: errorClass(error),
    });
    return false;
  }

  if (runtime.billing.stripeSecretKey) {
    try {
      await ensureStripeUserCustomer(userId);
    } catch (error) {
      console.error("Stripe customer provisioning failed.", {
        operation: "post-commit-auth-initialization",
        errorClass: errorClass(error),
      });
    }
  }
  return true;
}

async function projectEmailOtpUserToAudience(userId: string): Promise<void> {
  try {
    const [verifiedUser] = await marketDb
      .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (verifiedUser?.emailVerified) {
      await projectVerifiedEmailToAudience(verifiedUser.email);
    }
  } catch (error) {
    console.warn("Verified-email audience projection lookup failed.", {
      operation: "post-commit-auth-initialization",
      errorClass: errorClass(error),
    });
  }
}

export const auth = betterAuth({
  baseURL: runtime.betterAuth.url,
  secret: runtime.betterAuth.secret,
  trustedOrigins: [runtime.appUrl],
  disabledPaths: [...DISABLED_AUTH_PATHS],
  database: drizzleAdapter(marketDb, {
    provider: "pg",
    schema,
    transaction: true,
  }),
  logger: {
    disabled: true
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    freshAge: 60 * 60
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    async sendResetPassword({ user, url }) {
      try {
        await sendMarketAuthEmail({
          kind: "password-reset",
          to: user.email,
          url,
        });
      } catch (error) {
        logAuthEmailDeliveryFailure("password-reset", error);
        throw error;
      }
    },
  },
  emailVerification: {
    sendOnSignUp: false,
    sendOnSignIn: false,
    async sendVerificationEmail({ user, url }) {
      try {
        await sendMarketAuthEmail({
          kind: "email-change-verification",
          to: user.email,
          url,
        });
      } catch (error) {
        logAuthEmailDeliveryFailure("email-change-verification", error);
        throw error;
      }
    },
    async afterEmailVerification(user) {
      await projectVerifiedEmailToAudience(user.email);
    },
  },
  user: {
    changeEmail: {
      enabled: true
    },
    deleteUser: {
      enabled: false
    }
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          if (runtime.registrationMode === "close") {
            throw new APIError("FORBIDDEN", { message: "REGISTRATION_CLOSED" });
          }
          return { data: user };
        },
      },
    }
  },
  hooks: {
    after: createAuthMiddleware(async (context) => {
      if (context.context.returned instanceof APIError) return;

      const userId =
        context.context.newSession?.user.id ??
        successfulSignupUserId(context.path, context.context.returned);
      if (!userId || !(await initializeMarketAuthUser(userId))) return;

      if (context.path === "/sign-in/email-otp") {
        await projectEmailOtpUserToAudience(userId);
      }
    }),
  },
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") {
          throw new APIError("BAD_REQUEST", { message: "UNSUPPORTED_OTP_TYPE" });
        }
        try {
          await sendMarketAuthEmail({ kind: "sign-in-otp", to: email, otp });
        } catch (error) {
          logAuthEmailDeliveryFailure("sign-in-otp", error);
          throw error;
        }
      },
      sendVerificationOnSignUp: false,
      otpLength: 6,
      expiresIn: 15 * 60,
      allowedAttempts: 3,
    }),
    nextCookies(),
  ]
});

export { DISABLED_AUTH_PATHS };
