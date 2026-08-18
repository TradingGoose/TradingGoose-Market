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
bun run dev
```

Use a newly initialized empty PostgreSQL database. Create an ordinary account at
`http://localhost:3000/signup`, complete email verification, then run
`bun run admin:manage add --user-id <user-id>` as a database operator before
opening `/admin`.

Required for a normal local setup:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`; production requires exactly 64 lowercase hexadecimal
  characters generated with `openssl rand -hex 32`
- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- server-only `RESEND_API_KEY`
- complete `RESEND_FROM_EMAIL` sender on an operator-verified Resend domain
- optional `RESEND_AUDIENCE_ID` for best-effort verified-user contact projection
- `REGISTRATION_MODE` and `BILLING_ENABLED`
- `PAYG_USD_PER_1000_READS`
- `UNKEY_API_ID`, `UNKEY_KEY_MANAGEMENT_ROOT_KEY`, and `UNKEY_KEY_VERIFY_ROOT_KEY`

Stripe variables are required only by the enabled or explicitly synchronized billing branches. The anonymous limiter variables are required only when both anonymous-policy values are configured. See `.env.example` for the exact closed configuration matrix.

## Validation

Run the complete local checks:

```bash
bun install --frozen-lockfile
bun run db:build
bun run type-check
bun run lint
bun run test
bun run build
bun run test:release
```

The ordinary test suite expects `DATABASE_URL` to target the dedicated
`market_quality` control database. Its database tests create, migrate, inspect,
and drop only uniquely named child databases. The release workflow separately
applies `bun run db:migrate` once to `market_release`, then runs the sole
production build/start smoke owner through `bun run test:release`.

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
- `bun run db:migrate` is the only migration command. Apply it to a newly initialized empty Market database; there is no legacy probe, import, backfill, retry, or preservation path.
- Upload behavior lives in `uploads` and upload API routes.

## License

Contributions are provided under the Apache License 2.0.
