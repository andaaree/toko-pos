import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client — SERVER ONLY.
 *
 * Per spec D2: the anon key is read-only; every mutation goes through a Next.js
 * API route using the service_role key, which bypasses RLS entirely.
 *
 * SECURITY:
 *  - The env var is NOT prefixed with NEXT_PUBLIC_, so Next.js will never inline
 *    it into a client bundle. Importing this module from a Client Component will
 *    fail the build rather than leak the key.
 *  - The key value is never logged, echoed, or returned in a response anywhere.
 *  - `persistSession: false` — this client is stateless per request and must not
 *    write an auth session to storage.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Lazily constructed so that a missing key surfaces as a clean 500 at request
 * time instead of crashing the build. The user populates
 * SUPABASE_SERVICE_ROLE_KEY in .env separately.
 *
 * Typed as SupabaseClient<any> because no generated `Database` types exist in
 * this project yet; without a schema generic, supabase-js narrows rpc() argument
 * types to `undefined` and rejects every call.
 */
let cached: SupabaseClient<any, 'public', any> | null = null

export function getSupabaseAdmin(): SupabaseClient<any, 'public', any> {
  if (cached) return cached

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  }
  if (!serviceRoleKey) {
    // Deliberately does not reveal any partial value.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }

  cached = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return cached
}
