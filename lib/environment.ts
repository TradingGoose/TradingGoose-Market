export type MarketRegistrationMode = "open" | "close";

export type MarketRuntimeConfig = {
  databaseUrl: string;
  appUrl: string;
  betterAuth: {
    url: string;
    secret: string;
  };
  resend: {
    apiKey: string;
    fromEmail: string;
    audienceId: string | null;
  };
  registrationMode: MarketRegistrationMode;
  billing: {
    enabled: boolean;
    usdPer1000Reads: string;
    requestNanoUsd: bigint;
    stripeSecretKey: string | null;
    stripeWebhookSecret: string | null;
    stripePriceId: string | null;
    invoiceThresholdUsd: string | null;
  };
  unkey: {
    apiId: string;
    managementRootKey: string;
    verifyRootKey: string;
    anonymous: null | {
      limit: number;
      durationSeconds: number;
      namespaceId: string;
      rootKey: string;
    };
  };
};

const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

let cachedRuntimeConfig: MarketRuntimeConfig | undefined;

function requiredNonEmpty(
  environment: NodeJS.ProcessEnv,
  name: string
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required and must not be empty.`);
  }
  return value;
}

function optionalNonEmpty(
  environment: NodeJS.ProcessEnv,
  name: string
): string | null {
  const raw = environment[name];
  if (raw === undefined) return null;

  const value = raw.trim();
  if (!value) {
    throw new Error(`${name} must not be empty when supplied.`);
  }
  return value;
}

function parseOrigin(raw: string, name: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials.`);
  }
  if (production && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS in production.`);
  }
  return url.origin;
}

function parseDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme.");
  }

  return raw;
}

const PRODUCTION_BETTER_AUTH_SECRET_PATTERN = /^[0-9a-f]{64}$/;

function parseBetterAuthSecret(raw: string, production: boolean): string {
  if (!production) return raw;

  if (!PRODUCTION_BETTER_AUTH_SECRET_PATTERN.test(raw)) {
    throw new Error(
      "BETTER_AUTH_SECRET must be exactly 64 lowercase hexadecimal characters (32 bytes) in production; generate it with `openssl rand -hex 32`.",
    );
  }
  if (/^([0-9a-f])\1{63}$/.test(raw)) {
    throw new Error(
      "BETTER_AUTH_SECRET must not repeat one hexadecimal character in production; generate it with `openssl rand -hex 32`.",
    );
  }
  return raw;
}

function parseResendFromEmail(raw: string): string {
  if (/[\r\n]/.test(raw)) {
    throw new Error("RESEND_FROM_EMAIL must be one complete email sender without line breaks.");
  }

  const mailbox = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
  const namedMailbox = /^[^<>]+<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>$/;
  const namedMatch = namedMailbox.exec(raw);
  if (!mailbox.test(raw) && !namedMatch) {
    throw new Error(
      "RESEND_FROM_EMAIL must be one complete email address or display-name sender.",
    );
  }
  return raw;
}

function rejectPublicCredentialAliases(environment: NodeJS.ProcessEnv): void {
  const forbidden = [
    "NEXT_PUBLIC_BETTER_AUTH_SECRET",
    "NEXT_PUBLIC_RESEND_API_KEY",
    "NEXT_PUBLIC_RESEND_FROM_EMAIL",
    "NEXT_PUBLIC_RESEND_AUDIENCE_ID",
    "NEXT_PUBLIC_STRIPE_SECRET_KEY",
    "NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_UNKEY_KEY_MANAGEMENT_ROOT_KEY",
    "NEXT_PUBLIC_UNKEY_KEY_VERIFY_ROOT_KEY",
    "NEXT_PUBLIC_UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY",
  ] as const;
  const alias = forbidden.find((name) => environment[name] !== undefined);
  if (alias) {
    throw new Error(`${alias} is forbidden; Market provider credentials are server-only.`);
  }
}

function parsePositiveDecimal(
  raw: string,
  name: string,
  maximumFractionDigits?: number
): { canonical: string; whole: string; fraction: string } {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new Error(`${name} must be a positive base-10 decimal.`);
  }

  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  if (
    maximumFractionDigits !== undefined &&
    fraction.length > maximumFractionDigits
  ) {
    throw new Error(
      `${name} may contain at most ${maximumFractionDigits} fractional digits.`
    );
  }

  const significantFraction = fraction.replace(/0+$/, '');
  const canonical = significantFraction
    ? `${whole}.${significantFraction}`
    : whole;
  if (BigInt(whole) === 0n && !/[1-9]/.test(fraction)) {
    throw new Error(`${name} must be greater than zero.`);
  }

  return { canonical, whole, fraction };
}

function parsePositiveSafeInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

function parseRegistrationMode(raw: string): MarketRegistrationMode {
  if (raw !== 'open' && raw !== 'close') {
    throw new Error('REGISTRATION_MODE must be exactly "open" or "close".');
  }
  return raw;
}

function parseBillingEnabled(raw: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error('BILLING_ENABLED must be exactly "true" or "false".');
}

function parseAnonymousPolicy(environment: NodeJS.ProcessEnv) {
  const limitRaw = environment.ANONYMOUS_RATE_LIMIT;
  const durationRaw = environment.ANONYMOUS_RATE_LIMIT_DURATION_SECONDS;

  if (limitRaw === undefined && durationRaw === undefined) return null;
  if (limitRaw === undefined || durationRaw === undefined) {
    throw new Error(
      'ANONYMOUS_RATE_LIMIT and ANONYMOUS_RATE_LIMIT_DURATION_SECONDS must be supplied together.'
    );
  }

  const limit = parsePositiveSafeInteger(
    limitRaw.trim(),
    'ANONYMOUS_RATE_LIMIT'
  );
  const durationSeconds = parsePositiveSafeInteger(
    durationRaw.trim(),
    'ANONYMOUS_RATE_LIMIT_DURATION_SECONDS'
  );
  if (!Number.isSafeInteger(durationSeconds * 1_000)) {
    throw new Error(
      "ANONYMOUS_RATE_LIMIT_DURATION_SECONDS must produce a safe millisecond duration.",
    );
  }

  return {
    limit,
    durationSeconds,
    namespaceId: requiredNonEmpty(environment, 'UNKEY_ANONYMOUS_NAMESPACE_ID'),
    rootKey: requiredNonEmpty(environment, 'UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY')
  };
}

function parseRuntimeConfig(environment: NodeJS.ProcessEnv): MarketRuntimeConfig {
  rejectPublicCredentialAliases(environment);
  const databaseUrl = parseDatabaseUrl(
    requiredNonEmpty(environment, "DATABASE_URL")
  );
  const production = environment.NODE_ENV === 'production';
  const appUrl = parseOrigin(
    requiredNonEmpty(environment, 'NEXT_PUBLIC_APP_URL'),
    'NEXT_PUBLIC_APP_URL',
    production
  );
  const betterAuthUrl = parseOrigin(
    requiredNonEmpty(environment, 'BETTER_AUTH_URL'),
    'BETTER_AUTH_URL',
    production
  );
  if (appUrl !== betterAuthUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL and BETTER_AUTH_URL must have the same origin.');
  }

  const registrationMode = parseRegistrationMode(
    requiredNonEmpty(environment, 'REGISTRATION_MODE')
  );
  const billingEnabled = parseBillingEnabled(
    requiredNonEmpty(environment, 'BILLING_ENABLED')
  );

  const rate = parsePositiveDecimal(
    requiredNonEmpty(environment, 'PAYG_USD_PER_1000_READS'),
    'PAYG_USD_PER_1000_READS',
    6
  );
  const requestNanoUsd =
    BigInt(rate.whole) * 1_000_000n +
    BigInt(rate.fraction.padEnd(6, '0') || '0');
  if (requestNanoUsd <= 0n || requestNanoUsd > MAX_SAFE_INTEGER) {
    throw new Error(
      'PAYG_USD_PER_1000_READS must produce a positive safe-integer nano-USD request cost.'
    );
  }

  const stripeSecretKey = optionalNonEmpty(environment, 'STRIPE_SECRET_KEY');
  const stripeWebhookSecret = optionalNonEmpty(
    environment,
    'STRIPE_WEBHOOK_SECRET'
  );
  const stripePriceId = optionalNonEmpty(
    environment,
    'PAYG_STRIPE_PRICE_ID'
  );
  const thresholdRaw = optionalNonEmpty(
    environment,
    'PAYG_INVOICE_THRESHOLD_USD'
  );
  const invoiceThresholdUsd = thresholdRaw
    ? parsePositiveDecimal(
        thresholdRaw,
        'PAYG_INVOICE_THRESHOLD_USD'
      ).canonical
    : null;

  if (billingEnabled) {
    if (
      !stripeSecretKey ||
      !stripeWebhookSecret ||
      !stripePriceId ||
      !invoiceThresholdUsd
    ) {
      throw new Error(
        'Enabled billing requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PAYG_STRIPE_PRICE_ID, and PAYG_INVOICE_THRESHOLD_USD.'
      );
    }
  } else {
    const synchronizationValueCount = [
      stripeSecretKey,
      stripeWebhookSecret,
      stripePriceId
    ].filter((value) => value !== null).length;
    if (synchronizationValueCount !== 0 && synchronizationValueCount !== 1 && synchronizationValueCount !== 3) {
      throw new Error(
        'Disabled billing accepts no Stripe synchronization values, STRIPE_SECRET_KEY alone, or the complete Stripe secret/webhook/Price triple.'
      );
    }
    if (synchronizationValueCount === 1 && !stripeSecretKey) {
      throw new Error(
        'Disabled billing accepts a lone Stripe value only when it is STRIPE_SECRET_KEY.'
      );
    }
  }

  return {
    databaseUrl,
    appUrl,
    betterAuth: {
      url: betterAuthUrl,
      secret: parseBetterAuthSecret(
        requiredNonEmpty(environment, 'BETTER_AUTH_SECRET'),
        production,
      )
    },
    resend: {
      apiKey: requiredNonEmpty(environment, 'RESEND_API_KEY'),
      fromEmail: parseResendFromEmail(
        requiredNonEmpty(environment, 'RESEND_FROM_EMAIL')
      ),
      audienceId: optionalNonEmpty(environment, 'RESEND_AUDIENCE_ID')
    },
    registrationMode,
    billing: {
      enabled: billingEnabled,
      usdPer1000Reads: rate.canonical,
      requestNanoUsd,
      stripeSecretKey,
      stripeWebhookSecret,
      stripePriceId,
      invoiceThresholdUsd
    },
    unkey: {
      apiId: requiredNonEmpty(environment, 'UNKEY_API_ID'),
      managementRootKey: requiredNonEmpty(
        environment,
        'UNKEY_KEY_MANAGEMENT_ROOT_KEY'
      ),
      verifyRootKey: requiredNonEmpty(environment, 'UNKEY_KEY_VERIFY_ROOT_KEY'),
      anonymous: parseAnonymousPolicy(environment)
    }
  };
}

export function getMarketRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): MarketRuntimeConfig {
  if (environment !== process.env) return parseRuntimeConfig(environment);
  cachedRuntimeConfig ??= parseRuntimeConfig(environment);
  return cachedRuntimeConfig;
}

export function clearMarketRuntimeConfigCacheForTests(): void {
  cachedRuntimeConfig = undefined;
}
