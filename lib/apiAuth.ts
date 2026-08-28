import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

/**
 * Role resolution for API routes (spec D7).
 *
 * The JWT carries a role claim, but it is a snapshot from login time — a role
 * revoked or downgraded after the token was issued would still pass. Writes
 * therefore re-read `users.role` and `users.is_active` from the database via
 * service_role on every request. `users` has FORCE ROW LEVEL SECURITY with no
 * anon policy, so service_role is the only way to read it.
 */

/**
 * `id` is the database identity (users.id, an integer), NOT the NextAuth session
 * id. NextAuth's contract forces session.user.id to be a string, so the two
 * representations are converted at exactly one place: the filter in
 * requireUser() below. Keeping this field numeric means the value can be handed
 * straight to BIGINT-typed RPC args (e.g. create_sale.p_created_by) without a
 * second implicit coercion.
 */
export type AuthedUser = {
  id: number
  username: string
  role: 'admin' | 'cashier'
  isActive: boolean
}

export class ApiAuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Verifies the session and loads the CURRENT role from the database.
 * Throws ApiAuthError(401) when unauthenticated, (403) when disabled.
 */
export async function requireUser(): Promise<AuthedUser> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    throw new ApiAuthError(401, 'Unauthorized')
  }

  const userId = Number(session.user.id)
  if (!Number.isInteger(userId)) {
    // A session id that is not a valid integer cannot match any users.id.
    throw new ApiAuthError(401, 'Unauthorized')
  }

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('users')
    .select('id, username, role, is_active')
    .eq('id', userId)
    .single()

  if (error || !data) {
    // Session references a user that no longer exists.
    throw new ApiAuthError(401, 'Unauthorized')
  }

  const row = data as { id: number; username: string; role: string; is_active: boolean }

  if (row.is_active === false) {
    throw new ApiAuthError(403, 'Account is disabled')
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role === 'admin' ? 'admin' : 'cashier',
    // Narrowed to true by the guard above.
    isActive: true,
  }
}

/** Verifies the session and requires role = admin (UC-K03, master data). */
export async function requireAdmin(): Promise<AuthedUser> {
  const user = await requireUser()
  if (user.role !== 'admin') {
    throw new ApiAuthError(403, 'Forbidden: admin only')
  }
  return user
}

/**
 * Maps thrown errors to responses. ApiAuthError keeps its status; anything else
 * becomes a generic 500 so driver internals and key material can never leak into
 * a response body.
 */
export function toErrorResponse(err: unknown) {
  if (err instanceof ApiAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('[api] unhandled error:', err instanceof Error ? err.message : err)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}
