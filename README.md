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
bun run dev
```

`db:migrate` is the sole migration command. It applies the checked-in Drizzle
chain to the configured empty database before the application starts. Drizzle
migrations are generated from `packages/db/schema.ts`; migration SQL is never
hand-edited and there is no legacy cutover or compatibility path.

Create an ordinary account through `/signup`, complete email verification, and
then provision system-admin membership through the database/operator-owned CLI:

```bash
bun run admin:manage add --user-id <user-id>
bun run admin:manage remove --user-id <user-id>
```

Adding admin membership preserves the user’s customer billing, public keys, and history. Removal revokes every grant-bound private key before deleting the membership. There is no HTTP membership writer, invitation flow, role editor, ban flow, or application account-deletion action.

## Required configuration

Core runtime:

- `DATABASE_URL`
- `NEXT_PUBLIC_APP_URL` and the same-origin `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`; production requires exactly 64 lowercase hexadecimal
  characters generated with `openssl rand -hex 32`
- `REGISTRATION_MODE=open|close`
- server-only `RESEND_API_KEY`
- complete `RESEND_FROM_EMAIL` sender on an operator-verified Resend domain
- optional `RESEND_AUDIENCE_ID` for best-effort verified-user contact projection
- `BILLING_ENABLED=true|false`
- positive `PAYG_USD_PER_1000_READS`
- `UNKEY_API_ID`
- separate `UNKEY_KEY_MANAGEMENT_ROOT_KEY` and `UNKEY_KEY_VERIFY_ROOT_KEY`

Enabled billing also requires:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PAYG_STRIPE_PRICE_ID`
- positive `PAYG_INVOICE_THRESHOLD_USD`

Disabled billing supports no Stripe values, `STRIPE_SECRET_KEY` alone for best-effort Customer provisioning, or the complete secret/webhook/Price synchronization triple. Activation and Portal stay disabled, keyed requests remain usable and are recorded as non-billable, saved per-key limits are not consumed, and no disabled-era request is retrocharged.

Anonymous request limiting is optional. Leave both variables absent for unlimited anonymous reads, or set the complete pair:

- `ANONYMOUS_RATE_LIMIT`
- `ANONYMOUS_RATE_LIMIT_DURATION_SECONDS`

A configured pair also requires `UNKEY_ANONYMOUS_NAMESPACE_ID` and `UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY`. The bucket is service-wide; it is not partitioned by client IP. Redis, when configured, belongs only to the retained response cache.

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

Public-key use requires literal active PAYG only while billing is enabled. Key creation, listing, limit editing, and revocation remain billing-independent. Each admitted keyed request is recorded before its data handler runs; completion is stored separately as success, client error, server error, or visibly pending after a crash.

Clients may identify the calling application with `HTTP-Referer` and optional `X-Title`. Market normalizes and stores safe attribution snapshots for Activity and Logs; these headers never affect access, billing, spend enforcement, caching, or handler input.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start development |
| `bun run build` | Build the database package and production application |
| `bun run start` | Start the production application |
| `bun run lint` | Run ESLint |
| `bun run type-check` | Build database types and check TypeScript |
| `DATABASE_URL=postgres://market:market@127.0.0.1:5432/market_quality bun run test` | Build database types and run the unfiltered Vitest suite, including isolated fresh-database and retention lifecycles |
| `bun run test:watch` | Run Vitest in watch mode |
| `bun run db:generate` | Generate the structural Drizzle migration |
| `bun run db:migrate` | Apply the checked-in Drizzle chain to the configured empty database |
| `bun run test:release` | Sequentially clean-build, start, readiness-check, and exact-route-smoke all four registration/billing modes |
| `bun run admin:manage …` | Add or remove database-owned admin membership |

## Release validation

The release workflow runs two independent PostgreSQL 17 gates. `quality` owns
the unfiltered test suite using a `market_quality` control database. The
`release-validation` job applies `db:migrate` exactly once to its separate
`market_release` database, then invokes `test:release` exactly once. The harness
owns all four `REGISTRATION_MODE=open|close` ×
`BILLING_ENABLED=true|false` production builds and servers, performs
exact route and registration-policy probes—including two rejected
closed-registration POSTs and one successful local signup in
open-registration/billing-disabled mode—and always terminates each server.
Publication requires both gates.

## License

Apache-2.0. See [LICENSE](LICENSE).
