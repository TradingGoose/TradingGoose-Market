# TradingGoose Market

TradingGoose Market is a standalone market-reference data service. It owns customer authentication, usage-priced PAYG billing, API-key management, request history, and administrative curation for listings, exchanges, currencies, cryptocurrencies, countries, cities, time zones, chains, markets, and trading hours.

Market shares TradingGoose’s visual system with Studio, but it does not call Studio for authorization, billing, keys, usage, or request limiting. Studio and other products consume Market as ordinary API clients.

## Product surfaces

- Email/password signup, sign-in, sign-out, verified email change, and password reset through Better Auth.
- A customer account shell with exactly API Keys, Activity, and Logs.
- One-time-reveal public API keys with an optional whole-dollar spend allowance over the preceding 1–30 × 24 hours.
- Market-owned immutable request admissions and completion status for customer analytics.
- Stripe-backed PAYG activation, metered request accrual, threshold/cycle/final settlement, and Customer Portal management.
- Database-provisioned additive system administrators with private update keys and system-wide private-key usage views.
- Admin entity curation, export, delete, and icon upload workflows. Market Hours intentionally supports list, export, and delete only.

## Runtime

| Layer | Technology |
| --- | --- |
| Runtime and package manager | Bun |
| Application | Next.js App Router, React, TypeScript |
| Database | PostgreSQL and Drizzle ORM |
| Authentication | Better Auth |
| Billing | Stripe |
| API-key generation and validation | Unkey (server-side) |
| UI | shadcn/ui, Tailwind CSS, Recharts, TanStack Table |
| Storage | Local filesystem, Vercel Blob, or Azure Blob |

## Setup

Requirements are Bun 1.3+, PostgreSQL, and the configured provider accounts.
Provision a newly initialized empty PostgreSQL database; Market does not probe,
import, backfill, or preserve an earlier Market schema.

```bash
cp .env.example .env
bun install
bun run db:migrate
bun run db:push
bun run dev
```

The pinned Better Auth package includes the checked-in Bun patch in `patches/`.
Keep `patchedDependencies` and `bun.lock` together: the patch fixes immutable-user
email-change verification, retires old-address OTP/reset challenges atomically,
and serializes one-time redemption and OTP attempt limits in Better Auth's
existing routes. CI installs it with `bun install --frozen-lockfile`.

`db:migrate` is the sole migration command. It applies the checked-in Drizzle
chain to the configured empty database. Apply the current authored schema with `bun run db:push` before starting the matching build. Drizzle
migrations are generated from `packages/db/schema.ts`; migration SQL is never
hand-edited and there is no legacy cutover or compatibility path.

Create an ordinary account through `/signup`, complete email verification when enabled, and
then provision system-admin membership through the database/operator-owned CLI:

```bash
bun run admin:manage add --user-id <user-id>
bun run admin:manage remove --user-id <user-id>
```

Adding admin membership preserves the user’s customer billing, public keys, and history. Removal revokes every grant-bound private key before deleting the membership. There is no HTTP membership writer, invitation flow, role editor, ban flow, or application account-deletion action.

## Required configuration

Core runtime:

- `DATABASE_URL` — the PostgreSQL endpoint, including a Neon pooled URL or PgBouncer in transaction mode. Each bounded lock acquisition can wait up to five seconds. A transaction can acquire several locks and holds them until it ends.
- `NEXT_PUBLIC_APP_URL` and the same-origin `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`; production requires exactly 64 lowercase hexadecimal
  characters generated with `openssl rand -hex 32`
- `REGISTRATION_MODE=open|close`
- optional `EMAIL_VERIFICATION_ENABLED=true|false`, defaulting to `false` like Studio
- server-only `RESEND_API_KEY`
- optional `EMAIL_DOMAIN`, defaulting to `tradinggoose.ai`; sender is `noreply@<domain>`
- optional complete `RESEND_FROM_EMAIL` override on an operator-verified Resend domain
- optional `RESEND_AUDIENCE_ID` for best-effort verified-user contact projection
- `BILLING_ENABLED=true|false`
- positive `PAYG_USD_PER_1000_READS`
- `UNKEY_API_ID`: the target keyspace's API ID, not a credential
- server-only `UNKEY_ROOT_KEY`: one root key for key management and verification

When email verification is enabled, signup requires the six-digit OTP before
session or API-key access. When disabled, password signup/login works without
OTP and does not falsely mark the email verified. Password reset and profile
email changes still use Resend; changing an email still requires verification.

Copy the **API ID** (`api_...`) from the Market [Keyspace Settings](https://www.unkey.com/docs/api-management/keyspaces/settings),
not its separate **Keyspace ID** (`ks_...`). The installed v2 SDK requires
`apiId` for key creation and listing. Create one root key scoped to that
keyspace with keyspace read and key read/create/update/delete/verify
permissions. Before deployment, grant `unkey:v1:<workspace_id>:keyspaces/<keyspace_id>/keys/*#update_key` to the existing
Market root key. Market uses it to enable a newly created key after recording its provider ID.
Unkey permission paths use the Keyspace ID (`ks_...`), not the API
ID. Market does not need key decryption or workspace-wide permissions.
See [Unkey's root-key setup](https://www.unkey.com/docs/platform/root-keys/configure)
and [permission reference](https://www.unkey.com/docs/platform/root-keys/permission-reference).

Enabled billing also requires:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PAYG_STRIPE_PRICE_ID`
- positive `PAYG_INVOICE_THRESHOLD_USD`

`ONBOARDING_ALLOWANCE_USD` defaults to `0` and accepts a non-negative USD amount with up to nine fractional digits. Signup seeds this grant and the initial personal spending limit once. Enabled public reads can use the remaining allowance before PAYG activation. Market admits a whole read while current usage is below the account cap, so one read can cross it. A key’s rolling limit still checks the full projected cost. Activated PAYG bills every rated paid read and reserves unused onboarding allowance for return to free after final settlement.

Usage warning and upgrade emails start enabled. The personal Usage notifications switch and signed notification or all-email unsubscribe choices govern these optional emails. Mail uses the configured Resend sender. First-attempt payment-recovery and authentication messages are transactional.

Market checks the payment block before authorizing either funding source. A confirmed decline preserves the already-admitted request but pauses later billable requests until invoice payment recovery. Key management remains available. Threshold billing waits for at least one full cent of unbilled usage, even when the configured threshold is smaller; cycle/final settlement retains nearest-cent rounding.

Before switching an existing deployment to transaction pooling, pause traffic, webhook delivery and the admin CLI. Drain in-flight writers and reconcile outstanding key creations on the old build. Inspect each unbound PAYG subscription with a pending activation UUID. An older Stripe POST can lack `paygActivationAttemptId`, and the local row can lack a candidate ID. Find the original POST in Stripe request logs using `payg-activate:<local subscription ID>:<attempt UUID>:<canonical Customer ID>`. List **all pages and statuses** for that Customer and retrieve the identified subscription. Verify its ID, Customer, ownership metadata (`userId`, `referenceId`, `subscriptionId`), single configured Price, quantity one and valid billing period.

For one verified active match, run the old build’s activation recovery while writers are drained and verify that the local row binds that exact Stripe ID and period. A missing list entry alone cannot rule out a dispatched POST. Keep the deployment paused for incomplete inventory, unresolved ownership or dispatch, multiple candidates, or a binding that cannot be verified. Resume traffic only after every pending row is resolved. The new build enforces its recorded attempt or candidate identity. [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests) · [Subscription inventory](https://docs.stripe.com/api/subscriptions/list)

Disabled billing supports no Stripe values, `STRIPE_SECRET_KEY` alone for best-effort Customer provisioning, or the complete secret/webhook/Price synchronization triple. Activation and Portal stay disabled, keyed requests remain usable and are recorded as non-billable, saved per-key limits are not consumed, and no disabled-era request is retrocharged.

Anonymous request limiting is optional. Leave both variables absent for unlimited anonymous reads, or set the complete pair:

- `ANONYMOUS_RATE_LIMIT`
- `ANONYMOUS_RATE_LIMIT_DURATION_SECONDS`

A configured pair also requires `UNKEY_ANONYMOUS_NAMESPACE_ID` and limit permission on that namespace for the same `UNKEY_ROOT_KEY`. The bucket is service-wide; it is not partitioned by client IP. Redis, when configured, belongs only to the retained response cache.

`STORAGE_SERVICE` is an optional `LOCAL|VERCEL|AZURE` override. When it is
unset, Market preserves its original auto-detection contract:

- Only complete Vercel credentials select `VERCEL`.
- Only complete Azure credentials select `AZURE`.
- Neither complete credential set selects `LOCAL`.
- Both complete credential sets select `LOCAL` and emit a warning.

An explicit `STORAGE_SERVICE=LOCAL|VERCEL|AZURE` overrides that detection:

- `LOCAL` needs no provider credentials.
- `VERCEL` requires the server-only `BLOB_READ_WRITE_TOKEN`.
- `AZURE` requires `AZURE_STORAGE_CONTAINER_NAME` plus either `AZURE_CONNECTION_STRING` or both `AZURE_ACCOUNT_NAME` and `AZURE_ACCOUNT_KEY`.

## Finite Market API

Every keyed request requires the exact `version=v1` query parameter. Public reads accept an optional `x-api-key`; absence selects anonymous access, while a present header—including an empty value—selects key validation and never falls back. `Authorization: Bearer` is not an API-key alias.

Public `GET|HEAD` routes:

| Route | Requested resource |
| --- | --- |
| `/api/search` | Market Instrument |
| `/api/search/cities` | City |
| `/api/search/countries` | Country |
| `/api/search/currencies` | Currency |
| `/api/search/cryptos` | Cryptocurrency |
| `/api/search/exchanges` | Exchange |
| `/api/search/listings` | Listing Identity |
| `/api/get/crypto` | Cryptocurrency |
| `/api/get/currency` | Currency |
| `/api/get/listing` | Listing Identity |
| `/api/get/market-hours` | Market Hours |
| `/api/get/timezone` | Timezone |

Private `POST` routes require a database-admin-minted private key:

| Route |
| --- |
| `/api/update/crypto-rank` |
| `/api/update/crypto-rank/decay` |
| `/api/update/currency-rank` |
| `/api/update/currency-rank/decay` |
| `/api/update/listing-rank` |
| `/api/update/listing-rank/decay` |

There are no short-path aliases, wildcard endpoint families, logo-update API aliases, static service secrets, customer-key throughput limits, or private-key request/spend limits.

Private requests buffer up to 64 KiB before taking a grant lock. A 10-second read deadline returns `408` for slow bodies, `413` for oversized bodies and `400` for aborted or failed reads. Admission acquires the grant lock and then the key lock. After admission commits, the mutation acquires both locks again in the same order and rechecks authorization. Each acquisition has its own five-second timeout and returns `503 ADMISSION_UNAVAILABLE` on expiry. A revocation committed between the two transactions returns `403` before the mutation runs.

Enabled public-key usage requires available account headroom with either onboarding allowance or active PAYG. Key creation, listing, limit editing, and revocation remain billing-independent. Each admitted keyed request is recorded before its data handler runs; completion is stored separately as success, client error, server error, or visibly pending after a crash.

Clients may identify the calling application with `HTTP-Referer` and optional `X-Title`. Market normalizes and stores safe attribution snapshots for Activity and Logs; these headers never affect access, billing, spend enforcement, caching, or handler input.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start development |
| `bun run build` | Build the database package and production application |
| `bun run start` | Start the production application |
| `bun run lint` | Run ESLint |
| `bun run type-check` | Build database types and check TypeScript |
| `DATABASE_URL=postgres://market:market@127.0.0.1:26432/market_quality bun run test` | Build database types and run the unfiltered Vitest suite, including isolated fresh-database and retention lifecycles |
| `bun run test:watch` | Run Vitest in watch mode |
| `bun run db:generate` | Generate the structural Drizzle migration |
| `bun run db:migrate` | Apply the checked-in Drizzle chain to the configured empty database |
| `bun run db:push` | Apply the current authored schema after baseline migration |
| `bun run test:release` | Sequentially clean-build, start, readiness-check, and exact-route-smoke all four registration/billing modes |
| `bun run admin:manage …` | Add or remove database-owned admin membership |

## Release validation

The release workflow runs two independent PostgreSQL 17 gates. `quality` runs
the full test suite through a transaction-mode PgBouncer serving `market_quality` and its disposable child databases.
The local release check uses the same base environment and starts with a separate, empty `market_release` database. [Release workflow](.github/workflows/release.yml)

```bash
(
  set -e
  createdb -h 127.0.0.1 -p 5432 -U market market_release
  export DATABASE_URL=postgres://market:market@127.0.0.1:5432/market_release
  export NEXT_PUBLIC_APP_URL=https://market.example.test:3000 BETTER_AUTH_URL=https://market.example.test:3000
  bun run db:migrate
  bun run db:push
  bun run test:release
)
```

This prepares the schema once. The harness builds and starts all four registration/billing modes,
checks their routes and registration policies, and terminates each server. After open signup with billing disabled,
it reads PostgreSQL directly to verify one personal owner, stats row, and PAYG subscription, the configured $25 grant
and spending limit, zero usage, enabled usage notifications, empty unsubscribe preferences, and no Stripe binding.
The shared public/auth origin is `https://market.example.test:3000`; transport
binds to `http://127.0.0.1:3000` and sends the canonical Host and forwarded headers.
The distinct public hostname proves reverse-proxied UI requests render instead
of redirecting to themselves; raw loopback requests must still redirect to HTTPS.
Publication requires both gates.

## License

Apache-2.0. See [LICENSE](LICENSE).
