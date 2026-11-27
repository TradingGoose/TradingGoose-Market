# Contributing to TradingGoose Market

TradingGoose Market is a standalone Next.js service for canonical market reference data. It includes customer and admin interfaces, public and private Market API routes, local usage accounting, Stripe PAYG billing, Unkey-backed API-key enforcement, and upload storage providers.

## Project Map

```text
app/          Next.js pages and API routes
components/   Shared shadcn UI, tables, account settings, and product canvases
lib/          Auth, billing, usage, API-key, DB, market API, and UI owners
packages/db/  Drizzle schema, client, and generated migrations
uploads/      Local, Vercel Blob, and Azure Blob storage abstraction
scripts/      Database-operator and admin tooling
```

## Local Setup

```bash
cp .env.example .env
bun install
bun run db:migrate
bun run db:push
bun run dev
```

Use a newly initialized empty PostgreSQL database. Create an ordinary account at
`http://localhost:3000/signup`, complete email verification when enabled, then run
`bun run admin:manage add --user-id <user-id>` as a database operator before
opening `/admin`.

Required for a normal local setup:

- `DATABASE_URL` for the target database, using its transaction-pooler endpoint when available. Handler lock acquisition has a five-second transaction-local timeout.
- `BETTER_AUTH_SECRET`; production requires exactly 64 lowercase hexadecimal
  characters generated with `openssl rand -hex 32`
- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- server-only `RESEND_API_KEY`
- optional `EMAIL_DOMAIN`, defaulting to `tradinggoose.ai`, for `noreply@<domain>`
- optional complete `RESEND_FROM_EMAIL` override on an operator-verified Resend domain
- optional `RESEND_AUDIENCE_ID` for best-effort verified-user contact projection
- `REGISTRATION_MODE` and `BILLING_ENABLED`
- optional `EMAIL_VERIFICATION_ENABLED`, defaulting to `false` like Studio
- `PAYG_USD_PER_1000_READS`
- `UNKEY_API_ID` and one server-only `UNKEY_ROOT_KEY`

Stripe variables are required only by the enabled or explicitly synchronized billing branches. The anonymous limiter variables are required only when both anonymous-policy values are configured. See `.env.example` for the exact closed configuration matrix.

## Validation

The quality checks use the `market_quality` control database.

```bash
bun install --frozen-lockfile
bun run db:build
bun run type-check
bun run lint
DATABASE_URL=postgres://market:market@127.0.0.1:26432/market_quality bun run test
```

The ordinary test suite expects `DATABASE_URL` to target the dedicated
`market_quality` control database through the quality workflow’s transaction-mode
PgBouncer on port 26432. Enable wildcard database routing so the same listener
serves the generated child databases. The database tests create, migrate, inspect,
and drop only uniquely named child databases.

The local release check uses the workflow's base environment and starts with a separate, empty `market_release` database. [Release workflow](workflows/release.yml)

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

The harness uses that schema for all four production builds. After open signup with billing disabled,
it reads the persisted personal owner, stats row, and PAYG subscription directly from PostgreSQL.
It verifies the configured $25 grant and spending limit, zero usage, default email preferences, and no Stripe binding.

## Ground Rules

- Branch from `main` and open PRs against `main` unless a maintainer says otherwise.
- Keep changes focused and describe env, cache, auth, billing, storage, provider, and rollout impact.
- Use Conventional Commits, for example `fix(market-api): preserve immutable request outcomes`.
- Do not manually edit files under any `*/migrations/` directory; generate Drizzle migrations when schema changes require them.
- Do not add legacy fallback paths when replacing behavior. Keep only the updated method.
- Do not commit secrets, credentials, generated build output, or private provider tokens.

## Area Notes

- Public API behavior lives in `app/api` and `lib/market-api`.
- Anonymous access is unlimited when its two policy variables are absent; when configured, its one service-wide limit is enforced by the dedicated server-side limiter.
- Database schema source lives in `packages/db/schema.ts`.
- Apply the generated baseline with `bun run db:migrate`, then the current authored schema with `bun run db:push`. Apply it to a newly initialized empty Market database; there is no legacy probe, import, backfill, retry, or preservation path.
- Upload behavior lives in `uploads` and upload API routes.

## License

Contributions are provided under the Apache License 2.0.
