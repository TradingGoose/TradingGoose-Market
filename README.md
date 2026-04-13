<h1 align="center">TradingGoose Market</h1>
<p align="center">
  <b>Canonical market reference data platform for TradingGoose</b>
</p>

<p align="center">
  Market data cockpit for canonical listings, exchanges, currencies, and trading hours.
</p>

<p align='center'>
  <a href="https://discord.gg/wavf5JWhuT" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align='center'>
  <a href="https://google.com/ai?q=I+am+using+TradingGoose-Market+from+https%3A%2F%2Fgithub.com%2FTradingGoose%2FTradingGoose-Market.+How+do+I+manage+canonical+market+reference+data+with+this+project" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/ASK%20google%20AI-8E75B2?style=for-the-badge&logo=google%20gemini&logoColor=white" alt="Gemini"></a>
  <a href="https://perplexity.ai?q=I+am+using+TradingGoose-Market+from+https%3A%2F%2Fgithub.com%2FTradingGoose%2FTradingGoose-Market.+How+do+I+manage+canonical+market+reference+data+with+this+project" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/ASK%20perplexity-088F8F?style=for-the-badge&logo=perplexity&logoColor=000000" alt="Perplexity"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/94f9af3c-0fc4-4bbc-9a19-fe6fa0314b24">
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/b5ce6a54-6986-4a6a-afa7-df341bb35bdf">
  <img alt="Project Screenshot" src="https://github.com/user-attachments/assets/94f9af3c-0fc4-4bbc-9a19-fe6fa0314b24" width="2559">
</picture>

---

## What is TradingGoose Market?

TradingGoose Market is the canonical source of truth for market reference data used across TradingGoose. It stores and serves listings, exchanges, cryptocurrencies, currencies, countries, cities, time zones, blockchain networks, market groups, and trading hours through a Next.js admin UI and a versioned public API.

It exists because of a problem we ran into while building [TradingGoose Studio](https://github.com/TradingGoose/TradingGoose-Studio): once Studio needed to support more than one market data provider, symbol identity stopped being simple. The same asset could be spelled differently across Yahoo Finance, Alpaca, Finnhub, Alpha Vantage, and other sources, which made cross-provider support harder than it should have been.

> **Early Stage Notice**
>
> TradingGoose Market is still under active development. Expect rough edges, schema changes, and occasional breaking updates while the platform evolves.

## Why It Exists

TradingGoose Market was built to give TradingGoose Studio a shared market identity layer instead of pushing provider-specific symbol logic into every connector. Market keeps the canonical records and market metadata. Studio can then apply provider-specific symbol formatting rules on top of that shared context.

If you want the full background, see:

- [TradingGoose Studio repository](https://github.com/TradingGoose/TradingGoose-Studio)
- [Blog post: why and how we built TradingGoose Market](https://www.tradinggoose.ai/blog/building-tradinggoose-market#how-rule-resolution-works)

## Core Capabilities

- Canonical management of market reference data.
- Versioned public API at `/api/search`, `/api/get`, and `/api/update`, with short-path rewrites for `/search` and `/update`.
- Admin UI for browse, create, edit, export, and upload flows across every entity type.
- Team management and invitation-based signup flows for admin and collaborators.
- API key support with per-key rate limiting and usage reporting back to TradingGoose Studio.
- Icon upload support with local filesystem, Vercel Blob, or Azure Blob storage.
- Optional plugin injection through `MARKET_PLUGIN_MODULES`.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Bun |
| Framework | Next.js (App Router) |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth + HMAC-signed API keys |
| UI | Radix UI, shadcn/ui, Tailwind CSS, TanStack Table |
| Storage | Local filesystem, Vercel Blob, or Azure Blob |
| Integrations | Redis, Resend, TradingGoose Studio billing hooks |
| Language | TypeScript |

## Quick Start

### Requirements

- Bun 1.3+
- Docker or an existing PostgreSQL instance
- PostgreSQL 17 recommended

### Setup

1. Copy the environment template.

   ```bash
   cp .env.example .env
   ```

2. Install dependencies.

   ```bash
   bun install
   ```

3. Start PostgreSQL. Example:

   ```bash
   docker run -d --name tradinggoose-market-db -p 5432:5432 \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=tradinggoose \
     postgres:17
   ```

4. Fill in the required values in `.env`.

5. Run migrations.

   ```bash
   bun run db:migrate
   ```

6. Start the app.

   ```bash
   bun run dev
   ```

7. Open `http://localhost:3000/admin`.

The first user to sign up becomes an admin. After that, sign-up is restricted to invited users.

### Environment

Required for a normal local setup:

- `DATABASE_URL` - used by Drizzle Kit migrations and as the runtime fallback connection string.
- `BETTER_AUTH_SECRET` - auth and session secret.
- `BETTER_AUTH_URL` - auth base URL.
- `NEXT_PUBLIC_APP_URL` - public app URL used for auth redirects and generated links.
- `INTERNAL_API_SECRET` - HMAC pepper and internal API secret.

Optional or integration-specific:

- Runtime DB tuning: `DATABASE_POOL_URL`, `DATABASE_POOL_MAX`.
- Free-tier and rate limiting: `REDIS_URL`, `MARKET_FREE_TIER_*`.
- Rank update access: `MARKET_RANK_UPDATE_ACCESS_MODE` (`authenticated` or `service`).
- Email delivery: `RESEND_API_KEY`, optional `FROM_EMAIL_ADDRESS`.
- TradingGoose Studio billing integration: `OFFICIAL_TG_URL`.
- Storage and plugins: `STORAGE_SERVICE`, cloud storage credentials, `MARKET_PLUGIN_MODULES`, `MARKET_PLUGIN_SOURCES`.

If you use `DATABASE_POOL_URL` at runtime, keep `DATABASE_URL` set for migrations.

### Storage

If `STORAGE_SERVICE` is not set, the app auto-detects storage from the configured credentials and falls back to local storage when no cloud provider is configured.

## Plugins

TradingGoose Market can inject private or local plugins at install time without committing their dependencies.

Example:

```bash
MARKET_PLUGIN_MODULES=@your-org/your-plugin
MARKET_PLUGIN_SOURCES={"@your-org/your-plugin":"file:../your-plugin"}
bun run install:with-plugins
bun run dev
```

`bun run install:with-plugins` writes the generated plugin loader, installs the requested modules, and restores `package.json` afterward. Restart the dev server after rerunning it so the generated loader is picked up.

## Project Layout

```text
app/
  (auth)/           Login and signup pages
  admin/            Admin UI pages and CRUD screens
  api/              Auth, health, search, get, update, uploads, and export routes
lib/
  auth/             Better Auth server and client config
  db/               Database client utilities and status checks
  market-api/       API auth, rate limiting, billing, and versioned handlers
  ui/               Shared UI utilities
packages/
  db/               Drizzle schema, client, and migrations package
uploads/            Storage abstraction for local, Vercel Blob, and Azure Blob
scripts/            Install-time plugin injector
```

## API

The public API is available through `/api/search`, `/api/get`, and `/api/update`. The shorter `/search` and `/update` paths are rewritten to the same handlers.

Authenticated requests are validated with HMAC-signed keys, and rate limits are enforced per key.

### Search

| Endpoint | Description |
| --- | --- |
| `GET /search` | Universal search across listings, cryptos, and currencies |
| `GET /search/listings` | Search listings with filters |
| `GET /search/cryptos` | Search cryptocurrencies with chain and pair filters |
| `GET /search/currencies` | Search currencies by code or name |
| `GET /search/exchanges` | Search exchanges by MIC or name |
| `GET /search/countries` | Search countries by code or name |
| `GET /search/cities` | Search cities by name or country |

### Get

| Endpoint | Description |
| --- | --- |
| `GET /get/listing` | Fetch listing(s) by ID, single or batch up to 200 |
| `GET /get/crypto` | Fetch crypto(s) by ID, single or batch up to 200 |
| `GET /get/currency` | Fetch currency(ies) by ID, single or batch up to 200 |
| `GET /get/timezone` | Fetch time zone info |
| `GET /get/market-hours` | Fetch trading hours for an exchange or market |

### Update

| Endpoint | Description |
| --- | --- |
| `POST /update/listing-rank` | Update listing rank, with `/decay` variant |
| `POST /update/listing-logo` | Update listing logo |
| `POST /update/crypto-rank` | Update crypto rank, with `/decay` variant |
| `POST /update/crypto-logo` | Update crypto logo |
| `POST /update/currency-rank` | Update currency rank, with `/decay` variant |
| `POST /update/currency-logo` | Update currency logo |
| `POST /update/country-logo` | Update country logo |

Rate limits default to 50 req/s per user key and 1,000 req/s for internal service keys. When free tier access is enabled, unauthenticated requests are rate limited by IP, with defaults of 25 req/min and 500 req/day.

## Admin CRUD Endpoints

Each entity (`listings`, `cryptos`, `currencies`, `exchanges`, `countries`, `cities`, `chains`, `markets`, `time-zones`, `market-hours`) exposes:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/{entity}` | List with pagination and filters, plus option mode for dropdowns |
| `POST` | `/api/{entity}` | Create |
| `GET` | `/api/{entity}/{id}` | Get single |
| `PATCH` | `/api/{entity}/{id}` | Update |
| `DELETE` | `/api/{entity}/{id}` | Delete |
| `GET` | `/api/{entity}/export` | Export all as JSON |

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the development server |
| `bun run build` | Create a production build |
| `bun run start` | Start the production server |
| `bun run lint` | Run ESLint |
| `bun run type-check` | Run TypeScript type checking |
| `bun run db:generate` | Generate Drizzle migration files |
| `bun run db:migrate` | Apply database migrations |
| `bun run install:with-plugins` | Install dependencies with plugin injection enabled |

## License

TradingGoose Market is licensed under Apache-2.0. See the [LICENSE](LICENSE) file for details.
