import { NextResponse } from 'next/server'
import type { ZodTypeAny } from 'zod'
import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin, toErrorResponse, ApiAuthError } from '@/lib/apiAuth'

/**
 * Shared CRUD handlers for master-data tables (spec §5.2: products, categories,
 * suppliers, customers, margins — all admin-only for writes).
 *
 * Reads use the anon client (D2: anon key is read-only, RLS allows SELECT).
 * Writes use service_role behind requireAdmin().
 */

type CrudConfig = {
  table: string
  columns: string
  createSchema: ZodTypeAny
  updateSchema: ZodTypeAny
  orderBy?: string
  /** Human label used in error messages. */
  label: string
}

async function parseBody(req: Request) {
  try {
    return await req.json()
  } catch {
    throw new ApiAuthError(400, 'Invalid JSON body')
  }
}

/** Maps Postgres / PostgREST error codes to sensible HTTP statuses. */
function mapDbError(error: { code?: string; message?: string }, label: string) {
  switch (error.code) {
    // PostgREST: .single() matched zero rows. This is how an UPDATE or DELETE
    // against a non-existent id surfaces — as an ERROR, not as data === null.
    // Without this case those requests would fall through to a generic 500.
    case 'PGRST116':
      return NextResponse.json({ error: `${label} not found` }, { status: 404 })
    case '23505': // unique_violation
      return NextResponse.json({ error: `${label} already exists` }, { status: 409 })
    case '23503': // foreign_key_violation
      return NextResponse.json({ error: 'Referenced record does not exist' }, { status: 400 })
    case '23514': // check_violation
      return NextResponse.json(
        { error: `Value violates a constraint on ${label}` },
        { status: 400 }
      )
    case '23502': // not_null_violation
      return NextResponse.json({ error: 'A required field is missing' }, { status: 400 })
    default:
      return null
  }
}

export function makeListHandler(cfg: CrudConfig) {
  return async function GET(req: Request) {
    try {
      const { searchParams } = new URL(req.url)
      const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 200)
      const search = searchParams.get('search')?.trim()

      let query = supabase
        .from(cfg.table)
        .select(cfg.columns)
        .order(cfg.orderBy || 'id', { ascending: true })
        .limit(limit)

      if (search) {
        // ilike on name; PostgREST escapes the value.
        query = query.ilike('name', `%${search}%`)
      }

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ data: data || [] })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}

export function makeCreateHandler(cfg: CrudConfig) {
  return async function POST(req: Request) {
    try {
      await requireAdmin()
      const raw = await parseBody(req)

      const parsed = cfg.createSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        )
      }

      const admin = getSupabaseAdmin()
      const { data, error } = await admin
        .from(cfg.table)
        .insert(parsed.data as any)
        .select(cfg.columns)
        .single()

      if (error) {
        const mapped = mapDbError(error, cfg.label)
        if (mapped) return mapped
        throw error
      }

      return NextResponse.json({ data }, { status: 201 })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}

export function makeUpdateHandler(cfg: CrudConfig) {
  return async function PATCH(req: Request) {
    try {
      await requireAdmin()
      const raw = await parseBody(req)

      const id = Number(raw?.id)
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: 'A positive integer id is required' }, { status: 400 })
      }

      const { id: _omit, ...rest } = raw as Record<string, unknown>
      const parsed = cfg.updateSchema.safeParse(rest)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        )
      }

      const patch = parsed.data as Record<string, unknown>
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
      }

      const admin = getSupabaseAdmin()
      const { data, error } = await admin
        .from(cfg.table)
        .update(patch as any)
        .eq('id', id)
        .select(cfg.columns)
        .single()

      if (error) {
        const mapped = mapDbError(error, cfg.label)
        if (mapped) return mapped
        throw error
      }
      if (!data) {
        return NextResponse.json({ error: `${cfg.label} not found` }, { status: 404 })
      }

      return NextResponse.json({ data })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}

/**
 * DELETE. Products are soft-deleted (is_active = false) because product_costs,
 * sale_items and stock_ledger reference them — a hard delete would either fail
 * on the FK or destroy sales history. Other master tables are hard-deleted, and
 * an FK violation is reported as 409 rather than a 500.
 */
export function makeDeleteHandler(cfg: CrudConfig & { softDelete?: boolean }) {
  return async function DELETE(req: Request) {
    try {
      await requireAdmin()

      const { searchParams } = new URL(req.url)
      const id = Number(searchParams.get('id'))
      if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: 'A positive integer id is required' }, { status: 400 })
      }

      const admin = getSupabaseAdmin()

      if (cfg.softDelete) {
        const { data, error } = await admin
          .from(cfg.table)
          .update({ is_active: false } as any)
          .eq('id', id)
          .select('id')
          .single()

        if (error) {
          const mapped = mapDbError(error, cfg.label)
          if (mapped) return mapped
          throw error
        }
        if (!data) {
          return NextResponse.json({ error: `${cfg.label} not found` }, { status: 404 })
        }
        return NextResponse.json({ data: { id, deactivated: true } })
      }

      // Hard delete. Report whether a row actually matched instead of always
      // claiming success: `count` distinguishes 404 from a real deletion.
      const { error, count } = await admin
        .from(cfg.table)
        .delete({ count: 'exact' })
        .eq('id', id)

      if (error) {
        if (error.code === '23503') {
          return NextResponse.json(
            { error: `${cfg.label} is referenced by other records and cannot be deleted` },
            { status: 409 }
          )
        }
        throw error
      }

      if (count === 0) {
        return NextResponse.json({ error: `${cfg.label} not found` }, { status: 404 })
      }

      return NextResponse.json({ data: { id, deleted: true } })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}
