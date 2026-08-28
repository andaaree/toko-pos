# Toko POS

A full-stack point-of-sale application built with Next.js, React, and Supabase.

## Quick Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:andaaree/toko-pos.git
   cd toko-pos
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   NEXTAUTH_SECRET=your_nextauth_secret
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```
   Get these values from your Supabase project settings:
   - URL and anon key: Settings → API
   - NEXTAUTH_SECRET: generate a random string (e.g., `openssl rand -base64 32`)
   - SERVICE_ROLE key: Settings → API → service_role secret

4. Set up the Supabase database:
   ```bash
   # Apply migrations
   npx supabase db push --db-url postgres://postgres:[YOUR_PASSWORD]@db.your-supabase-url.supabase.co:5432/postgres
   # Or manually run the SQL files in supabase/migrations/ in order: 0001_init.sql, 0002_api_functions.sql
   # Then run the seeder:
   psql -d your_database -f supabase/seeder.sql
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment

Build for production:
```bash
npm run build
```
Then deploy the `.next` output to your preferred hosting (Vercel, Netlify, etc.). Ensure the environment variables are set in the deployment platform.

## Technical Specification

See [docs/spec.md](docs/spec.md) for the full technical specification, including database schema, RLS policies, triggers, and API contracts.

