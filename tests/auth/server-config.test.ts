import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthAfterContext = {
  path: string;
  context: {
    returned: unknown;
    newSession: null | { user: { id: string } };
  };
};

type CapturedOptions = {
  disabledPaths?: string[];
  emailAndPassword?: Record<string, unknown>;
  emailVerification?: Record<string, unknown>;
  plugins?: Array<{ id: string; options?: Record<string, unknown> }>;
  hooks?: { after?: (context: AuthAfterContext) => Promise<unknown> };
  databaseHooks?: {
    user?: {
      create?: {
        before?: (user: Record<string, unknown>) => Promise<unknown>;
        after?: (user: Record<string, unknown>) => Promise<unknown>;
      };
    };
    session?: Record<string, unknown>;
  };
};

const capture = vi.hoisted(() => ({
  options: null as CapturedOptions | null,
  adapterConfig: null as Record<string, unknown> | null,
  send: vi.fn(),
  project: vi.fn(),
  log: vi.fn(),
  ensureMarket: vi.fn(),
  ensureStripe: vi.fn(),
  runtime: {
    appUrl: "https://market.example.com",
    betterAuth: { url: "https://market.example.com", secret: "secret" },
    resend: { apiKey: "re_test", fromEmail: "market@example.com", audienceId: null },
    registrationMode: "close",
    billing: { stripeSecretKey: null as string | null },
  },
  database: {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => [
          { email: "verified@example.com", emailVerified: true },
        ]),
      };
      return builder;
    }),
  },
}));

vi.mock("better-auth", () => ({
  betterAuth: (options: Record<string, unknown>) => {
    capture.options = options as CapturedOptions;
    return { handler: vi.fn(), api: {} };
  },
}));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn((_database: unknown, config: Record<string, unknown>) => {
    capture.adapterConfig = config;
    return { id: "drizzle" };
  }),
}));
vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    status: string;
    constructor(status: string, details?: { message?: string }) {
      super(details?.message);
      this.status = status;
    }
  },
  createAuthMiddleware: (handler: (context: AuthAfterContext) => Promise<unknown>) =>
    handler,
}));
vi.mock("better-auth/next-js", () => ({ nextCookies: vi.fn(() => ({ id: "next-cookies" })) }));
vi.mock("better-auth/plugins", () => ({
  emailOTP: vi.fn((options: Record<string, unknown>) => ({ id: "email-otp", options })),
}));
vi.mock("@tradinggoose/db", () => ({
  schema: { user: { id: "id", email: "email", emailVerified: "emailVerified" } },
}));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => capture.database }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => capture.runtime,
}));
vi.mock("@/lib/billing/customer-state", () => ({
  ensureMarketCustomerState: capture.ensureMarket,
  ensureStripeUserCustomer: capture.ensureStripe,
}));
vi.mock("@/lib/auth/mailer", () => ({
  sendMarketAuthEmail: capture.send,
  projectVerifiedEmailToAudience: capture.project,
  logAuthEmailDeliveryFailure: capture.log,
}));

await import("../../lib/auth/server");

function options() {
  if (!capture.options) throw new Error("Better Auth options were not captured.");
  return capture.options;
}

beforeEach(() => {
  capture.send.mockReset().mockResolvedValue(undefined);
  capture.project.mockReset().mockResolvedValue(undefined);
  capture.log.mockReset();
  capture.ensureMarket.mockReset().mockResolvedValue(undefined);
  capture.ensureStripe.mockReset().mockResolvedValue(undefined);
  capture.runtime.billing.stripeSecretKey = null;
  capture.database.select.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Market Better Auth configuration", () => {
  it.each([
    ["/email-otp/check-verification-otp", true],
    ["/email-otp/verify-email", true],
    ["/email-otp/request-password-reset", true],
    ["/forget-password/email-otp", true],
    ["/email-otp/reset-password", true],
    ["/email-otp/send-verification-otp", false],
    ["/sign-in/email-otp", false],
  ] as const)("sets email-OTP disabledPaths for %s to %s", (path, disabled) => {
    const disabledPaths = options().disabledPaths;
    expect(disabledPaths).toBeDefined();
    expect(disabledPaths?.includes(path)).toBe(disabled);
  });

  it("requires verified password identities without reset-time session revocation", () => {
    const password = options().emailAndPassword as Record<string, unknown>;
    const verification = options().emailVerification as Record<string, unknown>;
    expect(password.requireEmailVerification).toBe(true);
    expect(password).not.toHaveProperty("revokeSessionsOnPasswordReset");
    expect(verification.sendOnSignUp).toBe(false);
    expect(verification.sendOnSignIn).toBe(false);
  });

  it("pins Studio sign-in OTP to six digits, fifteen minutes, and three attempts", () => {
    const plugins = options().plugins as Array<{ id: string; options?: Record<string, unknown> }>;
    expect(plugins.map((plugin) => plugin.id)).toEqual(["email-otp", "next-cookies"]);
    expect(plugins[0].options).toEqual(expect.objectContaining({
      sendVerificationOnSignUp: false,
      otpLength: 6,
      expiresIn: 900,
      allowedAttempts: 3,
    }));
    expect(plugins[0].options).not.toHaveProperty("disableSignUp");
  });

  it("uses the sole user-create hook for closed registration", async () => {
    const before = options().databaseHooks?.user?.create?.before;
    if (!before) throw new Error("User-create gate is missing.");
    await expect(before({ id: "user_1" })).rejects.toMatchObject({
      message: "REGISTRATION_CLOSED",
      status: "FORBIDDEN",
    });
  });

  it("enables adapter transactions and keeps only the user-create before hook", () => {
    expect(capture.adapterConfig).toEqual({
      provider: "pg",
      schema: { user: { id: "id", email: "email", emailVerified: "emailVerified" } },
      transaction: true,
    });
    expect(Object.keys(options().databaseHooks ?? {})).toEqual(["user"]);
    expect(Object.keys(options().databaseHooks?.user?.create ?? {})).toEqual([
      "before",
    ]);
    expect(options().databaseHooks?.user?.create).not.toHaveProperty("after");
    expect(options().databaseHooks).not.toHaveProperty("session");
  });

  it("preserves a committed signup response after initialization failure and repairs later", async () => {
    const after = options().hooks?.after;
    if (!after) throw new Error("Post-commit auth hook is missing.");
    const initializationFailure = new Error("database unavailable");
    capture.ensureMarket
      .mockRejectedValueOnce(initializationFailure)
      .mockResolvedValueOnce(undefined);
    const response = { token: null, user: { id: "customer_1" } };
    const signupContext: AuthAfterContext = {
      path: "/sign-up/email",
      context: { returned: response, newSession: null },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(after(signupContext)).resolves.toBeUndefined();
    expect(signupContext.context.returned).toBe(response);
    expect(capture.ensureMarket).toHaveBeenNthCalledWith(1, "customer_1");
    expect(capture.ensureStripe).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Market customer initialization failed.",
      expect.objectContaining({
        operation: "post-commit-auth-initialization",
        errorClass: "Error",
      }),
    );

    const repairResponse = { token: "session_token", user: { id: "customer_1" } };
    await expect(
      after({
        path: "/sign-in/email",
        context: {
          returned: repairResponse,
          newSession: { user: { id: "customer_1" } },
        },
      }),
    ).resolves.toBeUndefined();
    expect(capture.ensureMarket).toHaveBeenNthCalledWith(2, "customer_1");
  });

  it("runs best-effort Stripe and verified-email projection only after local initialization", async () => {
    const after = options().hooks?.after;
    if (!after) throw new Error("Post-commit auth hook is missing.");
    capture.runtime.billing.stripeSecretKey = "sk_test";
    capture.ensureStripe.mockRejectedValueOnce(new Error("Stripe unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      after({
        path: "/sign-in/email-otp",
        context: {
          returned: { token: "session_token", user: { id: "customer_2" } },
          newSession: { user: { id: "customer_2" } },
        },
      }),
    ).resolves.toBeUndefined();

    expect(capture.ensureMarket).toHaveBeenCalledWith("customer_2");
    expect(capture.ensureStripe).toHaveBeenCalledWith("customer_2");
    expect(capture.ensureMarket.mock.invocationCallOrder[0]).toBeLessThan(
      capture.ensureStripe.mock.invocationCallOrder[0],
    );
    expect(capture.project).toHaveBeenCalledWith("verified@example.com");
    expect(consoleError).toHaveBeenCalledWith(
      "Stripe customer provisioning failed.",
      expect.objectContaining({ errorClass: "Error" }),
    );
  });

  it("propagates direct reset delivery failure and projects verified email best effort", async () => {
    const failure = new Error("delivery failed");
    capture.send.mockRejectedValueOnce(failure);
    const sendReset = options().emailAndPassword?.sendResetPassword as ((data: unknown) => Promise<void>) | undefined;
    if (!sendReset) throw new Error("Password reset sender is missing.");
    await expect(sendReset({ user: { email: "customer@example.com" }, url: "https://market.example.com/reset" })).rejects.toBe(failure);
    expect(capture.log).toHaveBeenCalledWith("password-reset", failure);

    const afterVerification = options().emailVerification?.afterEmailVerification as ((user: { email: string }) => Promise<void>) | undefined;
    if (!afterVerification) throw new Error("Verified-email projection hook is missing.");
    await afterVerification({ email: "verified@example.com" });
    expect(capture.project).toHaveBeenCalledWith("verified@example.com");
  });
});
