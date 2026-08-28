import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin, toErrorResponse, ApiAuthError } from '@/lib/apiAuth'
import { stockMutationSchema, stockAdjustmentSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * GET — stock list. Read-only, so it uses the anon client per D2.
 * Reads products.stock_qty directly (spec §4 Query E / D4): O(1) per product.
 * The previous implementation summed the whole stock_ledger per product, which
 * spec D4 explicitly replaced as "slow + race-prone".
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const cursor = searchParams.get('cursor') || '0'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100)

    const { data: products, error } = await supabase
      .from('products')
      .select('id, sku, name, min_stock, unit, stock_qty')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(limit)

    if (error) throw error

    const result = (products || []).map((p: any) => {
      const stock = Number(p.stock_qty ?? 0)
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        min_stock: p.min_stock,
        current_stock: stock,
        status: stock <= 0 ? 'EMPTY' : stock <= Number(p.min_stock ?? 0) ? 'LOW' : 'OK',
      }
    })

    const nextCursor = result.length === limit ? result[result.length - 1].id : null
    return NextResponse.json({ data: result, nextCursor, hasMore: !!nextCursor })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST — stock mutation. Admin only (UC-K03), service_role, and exactly ONE
 * stock_ledger insert per spec §5.2: "stock mutation = single stock_ledger
 * insert (T1 does the rest)".
 *
 * Two modes:
 *   mode "ledger"     — explicit qty_in / qty_out movement.
 *   mode "adjustment" — absolute stock count; the server reads stock_qty and
 *                       derives the delta.
 *
 * balance_after is NEVER sent. Trigger T1 computes it under a per-product
 * advisory lock and updates products.stock_qty. The previous implementation
 * computed balance_after in JS from a full ledger scan — a lost-update race,
 * and the value was overwritten by T1 anyway.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAdmin()

    let raw: any
    try {
      raw = await req.json()
    } catch {
      throw new ApiAuthError(400, 'Invalid JSON body')
    }

    const admin = getSupabaseAdmin()
    const mode = raw?.mode ?? raw?.action ?? 'ledger'

    if (mode === 'adjustment') {
      const parsed = stockAdjustmentSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: parsed.error.flatten() },
          { status: 400 }
        )
      }
      const { product_id, target_qty, note } = parsed.data

      const { data: product, error: pErr } = await admin
        .from('products')
        .select('id, stock_qty')
        .eq('id', product_id)
        .single()

      if (pErr || !product) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }

      const current = Number((product as any).stock_qty ?? 0)
      const diff = target_qty - current

      if (diff === 0) {
        return NextResponse.json({ data: { product_id, stock_qty: current, changed: false } })
      }

      const { data: entry, error } = await admin
        .from('stock_ledger')
        .insert({
          product_id,
          ref_type: 'adjustment',
          qty_in: diff > 0 ? diff : 0,
          qty_out: diff < 0 ? -diff : 0,
          note: note || `Manual adjustment by ${user.username}`,
        })
        .select('id, product_id, qty_in, qty_out, balance_after, created_at')
        .single()

      if (error) throw error
      return NextResponse.json({ data: entry }, { status: 201 })
    }

    const parsed = stockMutationSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const input = parsed.data

    // Guard against driving stock negative. T1 does not enforce this.
    if (input.qty_out > 0) {
      const { data: product, error: pErr } = await admin
        .from('products')
        .select('id, stock_qty')
        .eq('id', input.product_id)
        .single()

      if (pErr || !product) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      }
      const current = Number((product as any).stock_qty ?? 0)
      if (current < input.qty_out) {
        return NextResponse.json(
          { error: `Insufficient stock: have ${current}, need ${input.qty_out}` },
          { status: 409 }
        )
      }
    }

    const { data: entry, error } = await admin
      .from('stock_ledger')
      .insert({
        product_id: input.product_id,
        ref_type: input.ref_type,
        ref_id: input.ref_id ?? null,
        qty_in: input.qty_in,
        qty_out: input.qty_out,
        note: input.note ?? null,
      })
      .select('id, product_id, ref_type, qty_in, qty_out, balance_after, created_at')
      .single()

    if (error) throw error
    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
