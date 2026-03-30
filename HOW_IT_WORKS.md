# TradingGoose Market: How It Works

## Purpose
TradingGoose Market is a Next.js + Postgres/Timescale application that manages the canonical market dataset (locations, exchanges, listings, market hours). The app exposes CRUD APIs and admin UIs for the data and provides loaders to seed the database from normalized JSON inputs.

## High-level flow
1. **Generate normalized data** into `raw/generated/*.json` (from CSVs and mapping files in `raw/`).
2. **Load data** into Postgres using the loader scripts in `scripts/load/`.
3. **Manage and curate** listings, market hours, and other reference data via the Next.js UI and API routes.

## Core data model (from `db/schema.ts`)
The schema centers around canonical listings and venue metadata.

- `time_zones`: Canonical time zone records (name + offset).
- `countries`: ISO country definitions (code, name, optional icon).
- `cities`: Cities scoped to countries, linked to `time_zones`.
- `currencies`: Currency codes (supports fiat and crypto-style codes).
- `exchanges`: Exchange MICs (with optional country/city links and active flag).
- `listings`: Canonical instruments. Each listing is a base symbol (e.g., `AAPL`, `BTC`), optional quote currency, asset class, and primary MIC (plus optional secondary MICs).
- `market_hours`: Trading hours payloads that can be scoped by MIC/asset class/listing/country/city and linked to a canonical time zone.

### How listings act as canonical identity
A listing is the canonical key for an instrument on a venue:
- `base` is the primary symbol/root.
- `quote` is the trading/quote currency (linked to `currencies`).
- `primaryExchId` identifies the primary exchange/venue.
- `assetClass` defines the market segment (stock, etf, crypto, etc.).

Downstream mapping logic uses listings as the target identity for symbols.

## Data ingestion pipeline
Normalized data is stored under `raw/generated/` and loaded with scripts:
- `scripts/load/load-locations.ts`: time zones, countries, cities
- `scripts/load/load-mics.ts`: exchanges (MIC identifiers)
- `scripts/load/load-currencies.ts`: currencies
- `scripts/load/load-listings.ts`: canonical listings
- `scripts/load/load-market-hours.ts`: market hours

The convenience runner `bun run load:all` loads locations, exchanges, listings, and market hours. Currencies are loaded separately.

## App + API layer
The Next.js app exposes CRUD APIs and admin pages for each core dataset:
- API routes under `app/api/*` (e.g., `/api/listings`, `/api/chains`, `/api/cryptos`, `/api/market-hours`).
- Admin pages under `app/*` (e.g., `/exchanges`, `/listings`, `/cryptos`, `/chains`, `/market-hours`).
