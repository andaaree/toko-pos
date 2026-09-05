/**
 * Shared helpers for backend smoke tests.
 *
 * These tests run against the REAL Supabase project configured in .env and a
 * real `next start` server. They are integration smoke tests: they assert
 * observable HTTP behaviour, not mocked behaviour. Nothing here fabricates a
 * success path — if a precondition is missing the test reports it.
 */
import { createClient } from '@supabase/supabase-js'

export const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100'

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set — cannot run integration smoke tests`)
  return v
}

/** service_role client. Bypasses RLS. Test-fixture use only. */
export function admin() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** anon client, exactly what the browser gets. */
export function anon() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** True when migration 0002 has been applied to the target database. */
export async function migration0002Applied(): Promise<boolean> {
  const res = await fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/rpc/get_weighted_hpp`, {
    method: 'POST',
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_product_ids: [1] }),
  })
  // PGRST202 = function not found in schema cache.
  return res.status !== 404
}

/**
 * Signs in through the real NextAuth credentials flow and returns a Cookie
 * header carrying the session token. Returns null when the credentials are
 * rejected.
 */
export async function signIn(username: string, password: string): Promise<string | null> {
  const jar = new Map<string, string>()
  const absorb = (res: Response) => {
    for (const raw of (res.headers as any).getSetCookie?.() ?? []) {
      const [pair] = String(raw).split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }
  const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
  absorb(csrfRes)
  const { csrfToken } = await csrfRes.json()

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
    body: new URLSearchParams({ csrfToken, username, password, json: 'true' }).toString(),
    redirect: 'manual',
  })
  absorb(loginRes)

  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { Cookie: cookie() } })
  const session = await sessionRes.json().catch(() => null)
  if (!session || !session.user) return null
  return cookie()
}

export async function api(
  path: string,
  init: RequestInit & { cookie?: string | null } = {}
): Promise<{ status: number; body: any; raw: string }> {
  const { cookie, ...rest } = init
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(rest.headers ?? {}),
    },
  })
  const raw = await res.text()
  let body: any = null
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  return { status: res.status, body, raw }
}
