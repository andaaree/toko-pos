# Toko POS

Point-of-sale and product-margin management dashboard for a small retail shop
(mini-market). Built with Next.js 14 (App Router), React 18, TypeScript,
Tailwind CSS, NextAuth, and Supabase/Postgres.

Features: sales entry with automatic cost-of-goods snapshot, stock ledger with
running balance, weighted-average HPP (landed cost) calculation, margin and
selling-price management, profit simulation, and a profit-summary dashboard.

## Requirements

- Node.js 18.17 or newer
- A Supabase project (or any Postgres 14+ instance)
- `psql` or the Supabase SQL editor, to apply migrations

## Quick install

```bash
git clone https://github.com/andaaree/toko-pos.git
cd toko-pos
npm install
cp .env.example .env
```

Then fill in `.env`. The four required variables:

| Variable | Where to get it | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → Project API keys → `anon` | Public |
| `NEXTAUTH_SECRET` | Generate: `openssl rand -base64 32` | Server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → Project API keys → `service_role` | **Server only** |

`NEXTAUTH_URL` is also set in `.env.example`; it defaults to
`http://localhost:3000` and must be changed to the deployed origin in
production.

Never commit real values. `.env` is gitignored; `.env.example` holds empty
placeholders only.

### About the two Supabase keys

The app deliberately uses two clients:

- The **anon key** is read-only, constrained by row-level security, and safe in
  the browser. All page reads use it directly.
- The **service_role key** bypasses RLS entirely — treat it as a root database
  credential. It has no `NEXT_PUBLIC_` prefix, so Next.js cannot inline it into
  a client bundle. It is used only by `lib/supabaseAdmin.ts` inside API routes,
  which is where every write goes.

Rotate the service_role key immediately if it is ever exposed.

## Supabase setup

Apply both migrations, in order, then seed.

**Option A — Supabase CLI**

```bash
npx supabase db push
```

**Option B — psql (or paste into the Supabase SQL editor)**

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_api_functions.sql
psql "$DATABASE_URL" -f supabase/seeder.sql
```

What each file does:

- `0001_init.sql` — business tables, RLS policies, and the two triggers that own
  derived columns: `stock_ledger.balance_after` + `products.stock_qty`, and
  `sales.total_amount` + `sales.total_cost`. Application code must never write
  those columns. The `users` table is extended with `ALTER TABLE ... ADD COLUMN
  IF NOT EXISTS` rather than created, so it is safe to run against a project
  that already has Supabase-managed tables.
- `0002_api_functions.sql` — `get_weighted_hpp()` and `create_sale()`.
  **Required**: `POST /api/sales` returns HTTP 500 until this is applied, because
  a sale must be written atomically and supabase-js has no transaction API.
- `seeder.sql` — idempotent sample data in foreign-key order (users, categories,
  suppliers, customers, products, margins, purchases, costs, stock ledger,
  sales). Safe to re-run.

The seeder creates two accounts with default passwords that **must be changed** before any real deployment (see supabase/seeder.sql).

`db/migrations/` holds byte-identical copies of the migration files for
reference; `supabase/migrations/` is the set the tooling reads.

## Run

```bash
npm run dev     # development server on http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # ESLint
```

Sign in at `/login`. Protected routes (`/dashboard`, `/stock-management`,
`/hpp-pricing`, `/profit-simulation`) are gated server-side in `middleware.ts`,
so an unauthenticated request never receives page HTML. Stock mutations and all
master-data writes additionally require the `admin` role, re-read from the
database on every request rather than trusted from the session token.

## Deployment

Any platform that runs Next.js server-side works; Vercel is the least
configuration. The app cannot be exported as a static site — it relies on API
routes and middleware.

```bash
npm run build
```

Before going live:

1. Set all four environment variables in the hosting platform, plus
   `NEXTAUTH_URL` pointing at the deployed origin.
2. Confirm `SUPABASE_SERVICE_ROLE_KEY` is configured as a server-side secret,
   not a build-time public variable.
3. Apply `0001` and `0002` to the production database.
4. Change the seeded default passwords, or skip the seeder entirely and create
   accounts manually.

## Project layout

```
app/                 App Router pages and API routes
  api/               Every mutation endpoint (service_role, Zod-validated)
components/          Shared UI, including the AppShell nav and session gate
lib/                 supabaseAdmin, apiAuth (role checks), validation, crud helpers
supabase/migrations/ Schema, RLS, triggers, SQL functions
supabase/seeder.sql  Sample data
docs/spec.md         Technical specification
middleware.ts        Server-side route gate
```

## Technical specification

See [docs/spec.md](docs/spec.md) for the schema, RLS policies, trigger
ownership rules, corrected queries, and the write-flow contract that the API
routes implement.
