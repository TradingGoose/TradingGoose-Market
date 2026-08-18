import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  MARKET_API_METHODS,
  MARKET_API_ROUTE_MANIFEST,
  type MarketApiMethod,
  type MarketRouteDescriptor,
} from "../../lib/market-api/core/manifest";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT_BUILD_DIRECTORY = resolve(PROJECT_ROOT, ".next");
const READY_TIMEOUT_MS = 60_000;
const PROCESS_EXIT_TIMEOUT_MS = 10_000;
const MAX_CAPTURED_OUTPUT = 40_000;

export const RELEASE_REQUIRED_BASE_ENV_KEYS = [
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "PAYG_USD_PER_1000_READS",
  "UNKEY_API_ID",
  "UNKEY_KEY_MANAGEMENT_ROOT_KEY",
  "UNKEY_KEY_VERIFY_ROOT_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

export const RELEASE_CLEARED_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYG_STRIPE_PRICE_ID",
  "PAYG_INVOICE_THRESHOLD_USD",
  "RESEND_AUDIENCE_ID",
  "ANONYMOUS_RATE_LIMIT",
  "ANONYMOUS_RATE_LIMIT_DURATION_SECONDS",
  "UNKEY_ANONYMOUS_NAMESPACE_ID",
  "UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY",
] as const;

export const MARKET_RELEASE_MODES = Object.freeze([
  { registrationMode: "open", billingEnabled: true },
  { registrationMode: "close", billingEnabled: true },
  { registrationMode: "close", billingEnabled: false },
  { registrationMode: "open", billingEnabled: false },
] as const);

const RELEASE_SIGNUP = Object.freeze({
  name: "Release Smoke Registration",
  email: "release-smoke-registration@example.com",
  password: "Release-smoke-password-123!",
});

type ReleaseBaseEnvironment = Record<
  (typeof RELEASE_REQUIRED_BASE_ENV_KEYS)[number],
  string
>;

type RunningServer = {
  child: ChildProcess;
  output: () => string;
};

type SmokeTarget = {
  publicOrigin: URL;
  serverOrigin: string;
};

type SmokeRequestOptions = {
  body?: string;
  canonical?: boolean;
  headers?: HeadersInit;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function captureOutput(current: string, chunk: Buffer | string): string {
  const combined = `${current}${String(chunk)}`;
  return combined.length <= MAX_CAPTURED_OUTPUT
    ? combined
    : combined.slice(combined.length - MAX_CAPTURED_OUTPUT);
}

function requireBaseEnvironment(environment: NodeJS.ProcessEnv): ReleaseBaseEnvironment {
  const entries = RELEASE_REQUIRED_BASE_ENV_KEYS.map((key) => {
    const value = environment[key];
    invariant(value !== undefined && value.trim().length > 0, `${key} is required for release validation.`);
    return [key, value] as const;
  });
  const base = Object.fromEntries(entries) as ReleaseBaseEnvironment;

  const appUrl = new URL(base.NEXT_PUBLIC_APP_URL);
  const authUrl = new URL(base.BETTER_AUTH_URL);
  invariant(appUrl.origin === authUrl.origin, "Release validation origins must match.");
  invariant(
    appUrl.protocol === "https:" && ["127.0.0.1", "localhost"].includes(appUrl.hostname),
    "Release validation must use an explicit loopback HTTPS public origin.",
  );
  invariant(appUrl.port.length > 0, "Release validation origin must include an isolated port.");
  return base;
}

function createModeEnvironment(
  base: ReleaseBaseEnvironment,
  mode: (typeof MARKET_RELEASE_MODES)[number],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...base,
    NODE_ENV: "production",
  };
  for (const key of RELEASE_CLEARED_ENV_KEYS) delete environment[key];

  environment.REGISTRATION_MODE = mode.registrationMode;
  environment.BILLING_ENABLED = String(mode.billingEnabled);

  if (mode.billingEnabled) {
    environment.STRIPE_SECRET_KEY = "sk_test_release_validation";
    environment.STRIPE_WEBHOOK_SECRET = "whsec_release_validation";
    environment.PAYG_STRIPE_PRICE_ID = "price_release_validation";
    environment.PAYG_INVOICE_THRESHOLD_USD = "50";
  }

  return environment;
}

async function runCommand(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
  await new Promise<void>((resolveCommand, rejectCommand) => {
    const child = spawn(command, [...args], {
      cwd: PROJECT_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output = captureOutput(output, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output = captureOutput(output, chunk);
    });
    child.once("error", rejectCommand);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.\n${output}`),
      );
    });
  });
}

function startProductionServer(
  environment: NodeJS.ProcessEnv,
  hostname: string,
  port: number,
): RunningServer {
  let output = "";
  const child = spawn(
    "bun",
    ["node_modules/next/dist/bin/next", "start", "-H", hostname, "-p", String(port)],
    {
      cwd: PROJECT_ROOT,
      env: { ...environment, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => {
    output = captureOutput(output, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output = captureOutput(output, chunk);
  });
  child.on("error", (error) => {
    output = captureOutput(output, `${error.name}: ${error.message}\n`);
  });
  return { child, output: () => output };
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

async function terminateServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  if (await waitForExit(server.child, PROCESS_EXIT_TIMEOUT_MS)) return;
  server.child.kill("SIGKILL");
  invariant(
    await waitForExit(server.child, PROCESS_EXIT_TIMEOUT_MS),
    `Production server did not terminate.\n${server.output()}`,
  );
}

async function request(
  target: SmokeTarget,
  path: string,
  method: string,
  options: SmokeRequestOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.canonical !== false) {
    headers.set("x-forwarded-proto", target.publicOrigin.protocol.slice(0, -1));
    headers.set("x-forwarded-host", target.publicOrigin.host);
    headers.set("x-forwarded-port", target.publicOrigin.port || "443");
  }
  return fetch(new URL(path, target.serverOrigin), {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: options.body }),
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
}

async function waitForReadiness(target: SmokeTarget, server: RunningServer): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    invariant(
      server.child.exitCode === null && server.child.signalCode === null,
      `Production server exited before readiness.\n${server.output()}`,
    );
    try {
      const response = await request(target, "/api/health", "GET");
      if (response.status === 200 && response.headers.get("x-market-api") === "next") {
        const payload = (await response.json()) as { status?: unknown; service?: unknown };
        if (payload.status === "ok" && payload.service === "tradinggoose-market") return;
      }
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.name : "request failure";
    }
    await delay(250);
  }
  throw new Error(`Production server readiness timed out (${lastFailure}).\n${server.output()}`);
}

function materializePath(template: string): string {
  return template
    .replace(/\[\.\.\.[^\]]+\]/gu, "release-smoke/missing.bin")
    .replace(/\[[^\]]+\]/gu, "release-smoke-id");
}

function rejectedMethod(descriptor: MarketRouteDescriptor): MarketApiMethod {
  const method = MARKET_API_METHODS.find(
    (candidate) => candidate !== "HEAD" && !descriptor.methods.includes(candidate),
  );
  invariant(method, `Manifest route ${descriptor.path} has no safe rejected-method probe.`);
  return method;
}

async function smokeExactManifest(target: SmokeTarget): Promise<void> {
  for (const descriptor of MARKET_API_ROUTE_MANIFEST) {
    const method = rejectedMethod(descriptor);
    const response = await request(target, materializePath(descriptor.path), method);
    invariant(
      response.status === 405,
      `${method} ${descriptor.path} returned ${response.status}, expected 405.`,
    );
    invariant(
      response.headers.get("allow") === descriptor.methods.join(", "),
      `${method} ${descriptor.path} did not expose its exact manifest Allow header.`,
    );
    invariant(
      response.headers.get("x-market-api") === "next",
      `${method} ${descriptor.path} did not resolve through the Market route owner.`,
    );
  }
}

async function smokeCanonicalRedirect(target: SmokeTarget): Promise<void> {
  const path = "/login?release-smoke=canonical-redirect";
  const response = await request(target, path, "GET", { canonical: false });
  invariant(response.status === 308, `Raw loopback UI request returned ${response.status}.`);
  invariant(
    response.headers.get("location") === new URL(path, target.publicOrigin).toString(),
    "Raw loopback UI request did not redirect to the canonical HTTPS URL.",
  );
}

async function smokeAllowedOwners(target: SmokeTarget): Promise<void> {
  for (const descriptor of MARKET_API_ROUTE_MANIFEST.filter(
    (candidate): candidate is Extract<MarketRouteDescriptor, { keyed: true }> => candidate.keyed,
  )) {
    const requestedHeaders =
      descriptor.access === "private-key"
        ? "x-api-key, http-referer, x-title, content-type"
        : "x-api-key, http-referer, x-title";
    const response = await request(
      target,
      `${descriptor.path}?version=v1`,
      "OPTIONS",
      {
        headers: {
          origin: target.publicOrigin.origin,
          "access-control-request-method": descriptor.methods[0],
          "access-control-request-headers": requestedHeaders,
        },
      },
    );
    invariant(response.status === 204, `OPTIONS ${descriptor.path} returned ${response.status}.`);
    invariant(
      response.headers.get("access-control-allow-origin") === target.publicOrigin.origin,
      `OPTIONS ${descriptor.path} did not retain the canonical CORS origin.`,
    );
    invariant(
      response.headers.get("access-control-allow-methods") ===
        `${descriptor.methods.join(", ")}, OPTIONS`,
      `OPTIONS ${descriptor.path} did not expose the descriptor methods.`,
    );
    invariant(
      response.headers.get("access-control-allow-headers") === requestedHeaders,
      `OPTIONS ${descriptor.path} did not expose the descriptor request headers.`,
    );
  }

  const anonymousRead = await request(
    target,
    "/api/search/cities?version=v1&city_name=release-smoke-no-match-7f70b2",
    "HEAD",
  );
  invariant(anonymousRead.status === 200, `Anonymous public read returned ${anonymousRead.status}.`);
  invariant(
    anonymousRead.headers.get("x-market-api") === "next",
    "Anonymous public read did not resolve through the Market owner.",
  );
  for (const header of [
    "x-market-ratelimit-limit",
    "x-market-ratelimit-remaining",
    "x-market-ratelimit-reset",
  ]) {
    invariant(!anonymousRead.headers.has(header), `Unlimited anonymous read exposed ${header}.`);
  }

  const privateWithoutKey = await request(
    target,
    "/api/update/crypto-rank?version=v1",
    "POST",
    { body: "{}", headers: { "content-type": "application/json" } },
  );
  invariant(privateWithoutKey.status === 401, `Private owner returned ${privateWithoutKey.status}.`);
  invariant(
    (await privateWithoutKey.json() as { code?: unknown }).code === "API_KEY_REQUIRED",
    "Private owner did not return the canonical missing-key response.",
  );

  for (const path of ["/api/account/billing", "/api/admin/api-keys"]) {
    const response = await request(target, path, "GET");
    invariant(response.status === 401, `Unauthenticated owner ${path} returned ${response.status}.`);
  }

  const unsignedWebhook = await request(target, "/api/billing/stripe/webhook", "POST", {
    body: "{}",
    headers: { "content-type": "application/json" },
  });
  invariant(unsignedWebhook.status === 400, `Unsigned Stripe webhook returned ${unsignedWebhook.status}.`);

  const anonymousSession = await request(target, "/api/auth/get-session", "GET");
  invariant(anonymousSession.status === 200, `Anonymous auth session returned ${anonymousSession.status}.`);

  const malformedAuthRequests = [
    {
      path: "/api/auth/sign-up/email",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: "Release Smoke", email: "smoke@example.com", password: "unused" }),
      error: "INVALID_SIGNUP_REQUEST",
    },
    {
      path: "/api/auth/email-otp/send-verification-otp",
      headers: { "content-type": "application/json" },
      body: "{}",
      error: "INVALID_OTP_REQUEST",
    },
    {
      path: "/api/auth/sign-in/email-otp",
      headers: { "content-type": "application/json" },
      body: "{}",
      error: "INVALID_OTP_REQUEST",
    },
  ] as const;
  for (const malformed of malformedAuthRequests) {
    const response = await request(target, malformed.path, "POST", {
      body: malformed.body,
      headers: {
        ...malformed.headers,
        origin: target.publicOrigin.origin,
      },
    });
    invariant(response.status === 400, `Malformed auth owner ${malformed.path} returned ${response.status}.`);
    invariant(
      (await response.json() as { error?: unknown }).error === malformed.error,
      `Malformed auth owner ${malformed.path} did not return its fixed protocol error.`,
    );
  }
}

async function smokeRetainedOwners(
  target: SmokeTarget,
  mode: (typeof MARKET_RELEASE_MODES)[number],
): Promise<void> {
  const exactPages = ["/", "/login", "/verify", "/forgot-password", "/reset-password"];
  for (const path of exactPages) {
    const response = await request(target, path, "GET");
    invariant(response.status === 200, `Retained page ${path} returned ${response.status}.`);
  }

  const signup = await request(target, "/signup", "GET");
  const expectedSignupStatus = mode.registrationMode === "open" ? 200 : 404;
  invariant(
    signup.status === expectedSignupStatus,
    `Signup page returned ${signup.status} in ${mode.registrationMode} registration mode.`,
  );

  const account = await request(target, "/account", "GET");
  invariant(
    [302, 303, 307, 308].includes(account.status),
    `Unauthenticated account shell returned ${account.status} instead of a redirect.`,
  );

  for (const path of ["/api/health", "/health"]) {
    const response = await request(target, path, "GET");
    invariant(response.status === 200, `Support owner ${path} returned ${response.status}.`);
    invariant(
      response.headers.get("x-market-api") === "next",
      `Support owner ${path} did not return the Market ownership header.`,
    );
  }
}

async function smokeRegistrationPolicy(
  target: SmokeTarget,
  mode: (typeof MARKET_RELEASE_MODES)[number],
): Promise<void> {
  if (mode.registrationMode === "open" && mode.billingEnabled) return;

  const response = await request(target, "/api/auth/sign-up/email", "POST", {
    body: JSON.stringify(RELEASE_SIGNUP),
    headers: {
      "content-type": "application/json",
      origin: target.publicOrigin.origin,
      "sec-fetch-site": "same-origin",
    },
  });

  if (mode.registrationMode === "close") {
    invariant(response.status === 403, `Closed registration returned ${response.status}.`);
    const payload = (await response.json()) as { code?: unknown; message?: unknown };
    invariant(
      payload.code === "REGISTRATION_CLOSED" && payload.message === "REGISTRATION_CLOSED",
      "Closed registration did not return the canonical REGISTRATION_CLOSED error.",
    );
    return;
  }

  invariant(!mode.billingEnabled, "Valid release signup must run only with billing disabled.");
  invariant(response.status === 200, `Open registration returned ${response.status}.`);
  const payload = (await response.json()) as {
    token?: unknown;
    user?: {
      name?: unknown;
      email?: unknown;
      emailVerified?: unknown;
      image?: unknown;
    };
  };
  invariant(payload.token === null, "Open registration unexpectedly created a session token.");
  invariant(payload.user?.name === RELEASE_SIGNUP.name, "Open registration returned the wrong name.");
  invariant(payload.user.email === RELEASE_SIGNUP.email, "Open registration returned the wrong email.");
  invariant(payload.user.emailVerified === false, "Open registration returned a verified user.");
  invariant(payload.user.image === null, "Open registration returned an unexpected image.");
}

async function smokeRemovedOwners(target: SmokeTarget): Promise<void> {
  const removed = [
    ["GET", "/api/account/usage"],
    ["GET", "/api/plugins"],
    ["POST", "/api/plugin/market"],
    ["GET", "/api/search/currency?version=v1"],
    ["GET", "/api/get/timezones?version=v1"],
    ["POST", "/api/update/logo?version=v1"],
    ["POST", "/api/auth/sign-in/social"],
    ["GET", "/api/auth/list-sessions"],
  ] as const;
  for (const [method, path] of removed) {
    const response = await request(target, path, method);
    invariant(response.status === 404, `Removed owner ${method} ${path} returned ${response.status}.`);
  }
}

async function runMode(
  base: ReleaseBaseEnvironment,
  mode: (typeof MARKET_RELEASE_MODES)[number],
): Promise<void> {
  const environment = createModeEnvironment(base, mode);
  const publicOrigin = new URL(base.NEXT_PUBLIC_APP_URL);
  const serverOrigin = new URL(publicOrigin);
  serverOrigin.protocol = "http:";
  const port = Number(serverOrigin.port);
  invariant(Number.isSafeInteger(port) && port > 0, "Release validation port is invalid.");

  await rm(NEXT_BUILD_DIRECTORY, { recursive: true, force: true, maxRetries: 3 });
  const label = `${mode.registrationMode}/${mode.billingEnabled ? "billing-enabled" : "billing-disabled"}`;
  await runCommand("bun", ["run", "build"], environment, `Production build (${label})`);

  const server = startProductionServer(environment, serverOrigin.hostname, port);
  const target = { publicOrigin, serverOrigin: serverOrigin.origin };
  try {
    await waitForReadiness(target, server);
    await smokeCanonicalRedirect(target);
    await smokeExactManifest(target);
    await smokeAllowedOwners(target);
    await smokeRetainedOwners(target, mode);
    await smokeRegistrationPolicy(target, mode);
    await smokeRemovedOwners(target);
  } finally {
    await terminateServer(server);
  }
}

export async function runMarketReleaseValidationMatrix(): Promise<void> {
  const base = requireBaseEnvironment(process.env);
  for (const mode of MARKET_RELEASE_MODES) await runMode(base, mode);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void runMarketReleaseValidationMatrix().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Release validation failed.");
    process.exitCode = 1;
  });
}
