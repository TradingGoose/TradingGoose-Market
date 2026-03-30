# TradingGoose Market

A canonical market data management platform built with Next.js. It acts as a centralized authority for financial market reference data — managing exchanges, listings, cryptocurrencies, currencies, market hours, and more — with a full admin UI and a versioned public API for programmatic access.

## What it does

- **Stores and manages canonical market reference data**: exchanges (MIC-based), listings, cryptocurrencies, fiat/crypto currencies, countries, cities, time zones, blockchain networks, and trading hours (including holidays and early closes).
- **Serves a versioned public API** (`/search`, `/get`, `/update`) with API key authentication, per-key rate limiting, and usage-based billing integration with TradingGoose Studio.
- **Provides an admin UI** for browsing, creating, editing, exporting, and uploading icons for every entity type.
- **Supports bulk data ingestion** from normalized JSON files via loader scripts that populate the database.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Framework | Next.js (App Router) |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth (session-based) + HMAC-signed API keys |
| UI | Radix UI, shadcn/ui, Tailwind CSS, TanStack Table |
| Storage | Local filesystem, Azure Blob, or Vercel Blob (configurable) |
| Language | TypeScript |

## Project layout

```
app/
  (auth)/           Login and signup pages
  admin/            Admin UI (listings, exchanges, currencies, cryptos, countries,
                    cities, timezones, chains, markets, market-hours)
  api/
    auth/           Better Auth handler
    health/         Health check endpoint
    files/serve/    Uploaded file serving
    uploads/        Icon upload endpoints (listing, crypto, currency, country, chain)
    search/         Public search API (v1)
    get/            Public get API (v1)
    update/         Public update API (v1)
    listings/       Admin CRUD + export
    cryptos/        Admin CRUD + export
    currencies/     Admin CRUD + export
    exchanges/      Admin CRUD + export
    countries/      Admin CRUD + export
    cities/         Admin CRUD + export
    chains/         Admin CRUD + export
    markets/        Admin CRUD + export
    market-hours/   Admin CRUD + export
    time-zones/     Admin CRUD + export
lib/market-api/
  core/             Auth, rate limiting, billing outbox, request pipeline
  v1/               Versioned handlers for search, get, update
packages/
  db/               Drizzle schema, client, migrations
  market-data/      Data loaders and raw JSON datasets
  market-logo/      Logo provider integrations (Logo.dev, TradingView, flag icons)
uploads/            Storage abstraction (local, Azure Blob, Vercel Blob)
```

## Getting started

### 1. Install dependencies

```bash
cp .env.example .env
bun install
```

### 2. Configure environment

Set these in `.env`:

```bash
DATABASE_URL=postgres://postgres:password@localhost:5432/tradinggoose
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
INTERNAL_API_SECRET=<openssl rand -hex 32>
OFFICIAL_TG_URL=http://localhost:3000
```

Need a local database? Run PostgreSQL via Docker:

```bash
docker run -d --name market-db -p 5434:5432 \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=tradinggoose \
  postgres:17
```

### 3. Apply migrations

```bash
bun run db:migrate
```

### 4. Run the app

```bash
bun run dev
```

The first user to sign up becomes the admin. After that, signup is disabled.

## Public API

All public API routes are accessed via `/search`, `/get`, and `/update` paths. They require an API key (created in the admin UI) and are versioned (`v1`).

### Search

| Endpoint | Description |
|---|---|
| `GET /search` | Universal search across listings, cryptos, and currencies |
| `GET /search/listings` | Search listings with filters (asset class, market, country, exchange, etc.) |
| `GET /search/cryptos` | Search cryptocurrencies (base/quote, chain filters) |
| `GET /search/currencies` | Search currencies by code or name |
| `GET /search/exchanges` | Search exchanges by MIC or name |
| `GET /search/countries` | Search countries by code or name |
| `GET /search/cities` | Search cities by name or country |

### Get

| Endpoint | Description |
|---|---|
| `GET /get/listing` | Fetch listing(s) by ID (single or batch up to 200) |
| `GET /get/crypto` | Fetch crypto(s) by ID (single or batch up to 200) |
| `GET /get/currency` | Fetch currency(ies) by ID (single or batch up to 200) |
| `GET /get/timezone` | Fetch time zone info |
| `GET /get/market-hours` | Fetch trading hours for an exchange/market |

### Update

| Endpoint | Description |
|---|---|
| `POST /update/listing-rank` | Update listing rank (also `/decay` variant) |
| `POST /update/listing-logo` | Fetch and update listing logo from external sources |
| `POST /update/crypto-rank` | Update crypto rank (also `/decay` variant) |
| `POST /update/crypto-logo` | Fetch and update crypto logo |
| `POST /update/currency-rank` | Update currency rank (also `/decay` variant) |
| `POST /update/currency-logo` | Fetch and update currency logo |
| `POST /update/country-logo` | Fetch and update country logo |

Rate limits: 50 req/s per user key, 1,000 req/s for internal service keys.

## Admin CRUD endpoints

Each entity (listings, cryptos, currencies, exchanges, countries, cities, chains, markets, time-zones, market-hours) exposes:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/{entity}` | List with pagination and filters (also supports option mode for dropdowns) |
| `POST` | `/api/{entity}` | Create |
| `GET` | `/api/{entity}/{id}` | Get single |
| `PATCH` | `/api/{entity}/{id}` | Update |
| `DELETE` | `/api/{entity}/{id}` | Delete |
| `GET` | `/api/{entity}/export` | Export all as JSON |

## Data ingestion

Normalized JSON data files go in `packages/market-data/raw/generated/`. The loader scripts in `packages/market-data/scripts/load/` ingest them into the database:

| Script | Data |
|---|---|
| `load-locations.ts` | Time zones, countries, cities |
| `load-mics.ts` | Exchanges (MIC codes) |
| `load-currencies.ts` | Currencies |
| `load-chains.ts` | Blockchain networks |
| `load-cryptos.ts` | Cryptocurrencies with contract addresses |
| `load-markets.ts` | Market groups |
| `load-listings.ts` | Canonical listings |
| `load-market-hours.ts` | Trading sessions, holidays, early closes |
| `run-load-all.ts` | Runs all loaders in the correct order |

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start development server |
| `bun run build` | Production build |
| `bun run start` | Start production server |
| `bun run lint` | Run ESLint |
| `bun run type-check` | Run TypeScript type checking |
| `bun run db:generate` | Generate Drizzle migration files |
| `bun run db:migrate` | Apply database migrations |
