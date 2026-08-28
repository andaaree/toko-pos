import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin, toErrorResponse } from '@/lib/apiAuth'
import { marginSchema } from '@/lib/validation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const cursor = searchParams.get('cursor') || '0'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const search = searchParams.get('search') || ''

    let query = supabase
      .from('products')
      .select(`
        id,
        sku,
        name,
        unit,
        min_stock,
        is_active,
        category:category_id ( name )
      `)
      .eq('is_active', true)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(limit)

    if (search) {
      query = query.or(`sku.ilike.%${search}%,name.ilike.%${search}%`)
    }

    const { data: products, error: productError } = await query
    if (productError) {
      throw productError
    }

    // Fetch latest margin per product + aggregated product_costs
    const productIds = products?.map((p) => p.id) || []
    let hppMap: Record<number, number> = {}
    let marginMap: Record<number, any> = {}
    let stockMap: Record<number, number> = {}

    if (productIds.length > 0) {
      let costAgg: any[] | null = null
      let costErr: unknown = null
      try {
        const rpcResult = await supabase.rpc('get_weighted_hpp', {
          product_ids: productIds,
        })
        costAgg = rpcResult.data as any[] | null
        costErr = rpcResult.error
      } catch (e) {
        costAgg = null
        costErr = e
      }

      // fallback: client-side compute if RPC not available
      if (costAgg && !costErr) {
        costAgg.forEach((row: any) => {
          hppMap[row.product_id] = row.weighted_hpp
        })
      } else {
        // Direct select + compute client-side
        const { data: costs } = await supabase
          .from('product_costs')
          .select('product_id, effective_cost, quantity')
          .in('product_id', productIds)

        for (const pid of productIds) {
          const related = (costs || []).filter((c) => c.product_id === pid)
          if (related.length > 0) {
            const totalCost = related.reduce((sum, c) => sum + Number(c.effective_cost) * c.quantity, 0)
            const totalQty = related.reduce((sum, c) => sum + c.quantity, 0)
            hppMap[pid] = totalQty > 0 ? totalCost / totalQty : 0
          }
        }
      }

      // Get latest margin per product
      const { data: margins } = await supabase
        .from('margins')
        .select('product_id, pricing_type, margin_value, sell_price, auto_update, min_discount')
        .in('product_id', productIds)
        .order('effective_from', { ascending: false })

      const seen = new Set<number>()
      margins?.forEach((m: any) => {
        if (!seen.has(m.product_id)) {
          seen.add(m.product_id)
          marginMap[m.product_id] = m
        }
      })

      // Get current stock per product (cursor via stock_ledger)
      const { data: ledgers } = await supabase
        .from('stock_ledger')
        .select('product_id, qty_in, qty_out')
        .in('product_id', productIds)

      ledgers?.forEach((l: any) => {
        if (!stockMap[l.product_id]) stockMap[l.product_id] = 0
        stockMap[l.product_id] += (l.qty_in || 0) - (l.qty_out || 0)
      })
    }

    const result = products?.map((p: any): any => {
      const hpp = hppMap[p.id] || 0
      const margin = marginMap[p.id]
      let sellPrice = 0
      if (margin) {
        if (margin.auto_update) {
          if (margin.pricing_type === 'percentage') {
            sellPrice = Math.round(hpp * (1 + Number(margin.margin_value) / 100))
          } else {
            sellPrice = Number(margin.margin_value)
          }
        } else {
          sellPrice = Number(margin.sell_price) || 0
        }
      }
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        min_stock: p.min_stock,
        category: (Array.isArray(p.category) ? p.category[0]?.name : p.category?.name) || '',
        hpp: Math.round(hpp),
        sell_price: sellPrice,
        margin_pct: sellPrice > 0 ? Math.round(((sellPrice - hpp) / hpp) * 100) : 0,
        min_discount: margin?.min_discount || 0,
        auto_update: margin?.auto_update ?? true,
        current_stock: stockMap[p.id] || 0,
        pricing_type: margin?.pricing_type || 'percentage',
        margin_value: margin?.margin_value || 0,
      }
    }) || []

    const nextCursor = result.length === limit
      ? result[result.length - 1].id
      : null

    return NextResponse.json({
      data: result,
      nextCursor,
      hasMore: !!nextCursor,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST — upsert a margin row for a product (UC-K02, admin only).
 *
 * Three defects fixed here:
 *  1. It wrote through the anon client, which is read-only under RLS — every
 *     write would have failed in production. Now uses service_role.
 *  2. The role check trusted session.user.role from the JWT, a login-time
 *     snapshot. requireAdmin() re-reads users.role from the database.
 *  3. The body was destructured straight into the query with no validation.
 *     Now validated with Zod.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin()

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = marginSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const input = parsed.data
    const admin = getSupabaseAdmin()

    const { data, error } = await admin
      .from('margins')
      .upsert(
        {
          product_id: input.product_id,
          pricing_type: input.pricing_type,
          margin_value: input.margin_value,
          sell_price: input.sell_price ?? null,
          min_discount: input.min_discount,
          auto_update: input.auto_update,
          effective_from: input.effective_from ?? new Date().toISOString().split('T')[0],
        },
        // Target the real unique key so re-pricing the same product on the same
        // day updates that row instead of raising a duplicate-key error.
        { onConflict: 'product_id,effective_from' }
      )
      .select('id, product_id, pricing_type, margin_value, sell_price, min_discount, effective_from')
      .single()

    if (error) throw error

    return NextResponse.json({ data })
  } catch (err) {
    return toErrorResponse(err)
  }
}