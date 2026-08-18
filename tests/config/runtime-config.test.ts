import { describe, expect, it } from "vitest";
import { getMarketRuntimeConfig } from "../../lib/environment";

function validEnvironment(
  overrides: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://market:market@localhost:5432/market",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "auth-secret",
    RESEND_API_KEY: "re_test",
    RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
    REGISTRATION_MODE: "open",
    BILLING_ENABLED: "false",
    PAYG_USD_PER_1000_READS: "1.25",
    UNKEY_API_ID: "api_market",
    UNKEY_KEY_MANAGEMENT_ROOT_KEY: "management-key",
    UNKEY_KEY_VERIFY_ROOT_KEY: "verify-key"
  };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }
  return environment;
}

describe("getMarketRuntimeConfig", () => {
  it("parses the disabled, unlimited-anonymous baseline exactly", () => {
    const config = getMarketRuntimeConfig(validEnvironment());

    expect(config.databaseUrl).toBe(
      "postgres://market:market@localhost:5432/market"
    );
    expect(config.appUrl).toBe("http://localhost:3000");
    expect(config.registrationMode).toBe("open");
    expect(config.resend).toEqual({
      apiKey: "re_test",
      fromEmail: "TradingGoose Market <market@example.com>",
      audienceId: null
    });
    expect(config.billing).toEqual({
      enabled: false,
      usdPer1000Reads: "1.25",
      requestNanoUsd: 1_250_000n,
      stripeSecretKey: null,
      stripeWebhookSecret: null,
      stripePriceId: null,
      invoiceThresholdUsd: null
    });
    expect(config.unkey.anonymous).toBeNull();
  });

  it("requires one trimmed syntactically valid PostgreSQL database URL", () => {
    expect(() =>
      getMarketRuntimeConfig(validEnvironment({ DATABASE_URL: undefined }))
    ).toThrow(/DATABASE_URL.*required/);
    expect(() =>
      getMarketRuntimeConfig(validEnvironment({ DATABASE_URL: "   " }))
    ).toThrow(/DATABASE_URL.*required/);
    expect(() =>
      getMarketRuntimeConfig(validEnvironment({ DATABASE_URL: "not a url" }))
    ).toThrow(/valid PostgreSQL URL/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ DATABASE_URL: "https://database.example.com/market" })
      )
    ).toThrow(/postgres or postgresql scheme/);

    expect(
      getMarketRuntimeConfig(
        validEnvironment({
          DATABASE_URL: "  postgresql://market@db.example.com/market  "
        })
      ).databaseUrl
    ).toBe("postgresql://market@db.example.com/market");
  });

  it("accepts only the canonical close registration value", () => {
    expect(
      getMarketRuntimeConfig(validEnvironment({ REGISTRATION_MODE: "close" }))
        .registrationMode
    ).toBe("close");
    expect(() =>
      getMarketRuntimeConfig(validEnvironment({ REGISTRATION_MODE: "closed" }))
    ).toThrow(/open.*close/);
  });

  it("requires canonical matching application and auth origins", () => {
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ BETTER_AUTH_URL: "http://localhost:4000" })
      )
    ).toThrow(/same origin/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "http://market.example.com",
          BETTER_AUTH_URL: "http://market.example.com"
        })
      )
    ).toThrow(/HTTPS/);
  });

  it("keeps nonproduction auth secrets trimmed and nonempty", () => {
    expect(() =>
      getMarketRuntimeConfig(validEnvironment({ BETTER_AUTH_SECRET: "   " }))
    ).toThrow(/BETTER_AUTH_SECRET.*required/);
    expect(
      getMarketRuntimeConfig(
        validEnvironment({ BETTER_AUTH_SECRET: "  local-test-secret  " }),
      ).betterAuth.secret,
    ).toBe("local-test-secret");
  });

  it.each([
    "short-varied-secret",
    "0123456789abcdef".repeat(4).toUpperCase(),
    "0123456789abcdef".repeat(4).slice(1),
    `${"0123456789abcdef".repeat(4)}0`,
    `${"0123456789abcdef".repeat(3)}0123456789abcdeg`,
    "replace-with-a-long-random-server-secret",
    "replace-with-64-lowercase-hex-characters",
    "release-validation-secret-that-is-long-enough",
  ])("rejects noncanonical production auth secret %s", (secret) => {
    const production = {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://market.example.com",
      BETTER_AUTH_URL: "https://market.example.com",
    };
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          ...production,
          BETTER_AUTH_SECRET: secret,
        }),
      )
    ).toThrow(/exactly 64 lowercase hexadecimal characters/);
  });

  it.each(["0", "a", "f"])(
    "rejects a production auth secret made from repeated %s nibbles",
    (nibble) => {
      expect(() =>
        getMarketRuntimeConfig(
          validEnvironment({
            NODE_ENV: "production",
            NEXT_PUBLIC_APP_URL: "https://market.example.com",
            BETTER_AUTH_URL: "https://market.example.com",
            BETTER_AUTH_SECRET: nibble.repeat(64),
          }),
        )
      ).toThrow(/must not repeat one hexadecimal character/);
    },
  );

  it("accepts exactly one nonrepeated 32-byte lowercase-hex production secret", () => {
    const secret =
      "51d365045e0022c3c710f22e1d4133321ae9eb5e081d6eee119c09cacf145dfb";
    expect(
      getMarketRuntimeConfig(
        validEnvironment({
          NODE_ENV: "production",
          NEXT_PUBLIC_APP_URL: "https://market.example.com",
          BETTER_AUTH_URL: "https://market.example.com",
          BETTER_AUTH_SECRET: secret,
        }),
      ).betterAuth.secret,
    ).toBe(secret);
  });

  it("requires one direct Resend credential and complete sender", () => {
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          RESEND_FROM_EMAIL: "not-an-email"
        })
      )
    ).toThrow(/complete email/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ RESEND_API_KEY: " " })
      )
    ).toThrow(/RESEND_API_KEY/);
    expect(
      getMarketRuntimeConfig(
        validEnvironment({ RESEND_AUDIENCE_ID: "aud_market" })
      ).resend.audienceId
    ).toBe("aud_market");
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ RESEND_AUDIENCE_ID: " " })
      )
    ).toThrow(/RESEND_AUDIENCE_ID/);
  });

  it("rejects public aliases for server credentials", () => {
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ NEXT_PUBLIC_RESEND_API_KEY: "re_public" })
      )
    ).toThrow(/server-only/);
  });

  it("requires an exactly representable positive safe request nano-USD rate", () => {
    expect(
      getMarketRuntimeConfig(
        validEnvironment({ PAYG_USD_PER_1000_READS: "0.000001" })
      ).billing.requestNanoUsd
    ).toBe(1n);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ PAYG_USD_PER_1000_READS: "0.0000001" })
      )
    ).toThrow(/6 fractional digits/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ PAYG_USD_PER_1000_READS: "0" })
      )
    ).toThrow(/greater than zero/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          PAYG_USD_PER_1000_READS: "9007199254.740992"
        })
      )
    ).toThrow(/safe-integer/);
  });

  it("requires the complete enabled Stripe matrix", () => {
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ BILLING_ENABLED: "true" })
      )
    ).toThrow(/Enabled billing requires/);

    const config = getMarketRuntimeConfig(
      validEnvironment({
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        PAYG_STRIPE_PRICE_ID: "price_test",
        PAYG_INVOICE_THRESHOLD_USD: "050.5000"
      })
    );
    expect(config.billing.invoiceThresholdUsd).toBe("50.5");
  });

  it("allows only no Stripe values, secret-only, or the complete triple while disabled", () => {
    expect(
      getMarketRuntimeConfig(
        validEnvironment({ STRIPE_SECRET_KEY: "sk_test" })
      ).billing.stripeSecretKey
    ).toBe("sk_test");
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          STRIPE_SECRET_KEY: "sk_test",
          PAYG_STRIPE_PRICE_ID: "price_test"
        })
      )
    ).toThrow(/complete Stripe/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ STRIPE_WEBHOOK_SECRET: "whsec_test" })
      )
    ).toThrow(/lone Stripe value/);
  });

  it("does not read anonymous credentials when the policy is null", () => {
    const target = validEnvironment();
    const environment = new Proxy(target, {
      get(object, property, receiver) {
        if (
          property === "UNKEY_ANONYMOUS_NAMESPACE_ID" ||
          property === "UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY"
        ) {
          throw new Error("anonymous credential was read");
        }
        return Reflect.get(object, property, receiver);
      }
    });

    expect(getMarketRuntimeConfig(environment).unkey.anonymous).toBeNull();
  });

  it("requires one complete positive safe anonymous policy and credential pair", () => {
    const config = getMarketRuntimeConfig(
      validEnvironment({
        ANONYMOUS_RATE_LIMIT: "100",
        ANONYMOUS_RATE_LIMIT_DURATION_SECONDS: "60",
        UNKEY_ANONYMOUS_NAMESPACE_ID: "namespace_market",
        UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY: "ratelimit-key"
      })
    );
    expect(config.unkey.anonymous).toEqual({
      limit: 100,
      durationSeconds: 60,
      namespaceId: "namespace_market",
      rootKey: "ratelimit-key"
    });

    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({ ANONYMOUS_RATE_LIMIT: "100" })
      )
    ).toThrow(/supplied together/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          ANONYMOUS_RATE_LIMIT: "0",
          ANONYMOUS_RATE_LIMIT_DURATION_SECONDS: "60"
        })
      )
    ).toThrow(/positive safe integer/);
    expect(() =>
      getMarketRuntimeConfig(
        validEnvironment({
          ANONYMOUS_RATE_LIMIT: "1",
          ANONYMOUS_RATE_LIMIT_DURATION_SECONDS: String(
            Number.MAX_SAFE_INTEGER,
          ),
          UNKEY_ANONYMOUS_NAMESPACE_ID: "namespace_market",
          UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY: "ratelimit-key",
        }),
      ),
    ).toThrow(/safe millisecond duration/);
  });
});
