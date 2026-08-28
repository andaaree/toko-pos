import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { toErrorResponse } from '@/lib/apiAuth'

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
    const productId = Number(searchParams.get('productId'))
    const simPrice = searchParams.get('simPrice')
    const simMargin = searchParams.get('simMargin')
    const estQty = parseInt(searchParams.get('estQty') || '1', 10)

    // Was: productId passed through unvalidated and estQty parsed without a
    // radix or NaN check, so `?estQty=abc` produced NaN and every derived total
    // serialised as null.
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json(
        { error: 'productId must be a positive integer' },
        { status: 400 }
      )
    }
    if (!Number.isInteger(estQty) || estQty < 1) {
      return NextResponse.json(
        { error: 'estQty must be an integer >= 1' },
        { status: 400 }
      )
    }
    if (simPrice !== null && !(Number.isFinite(Number(simPrice)) && Number(simPrice) >= 0)) {
      return NextResponse.json({ error: 'simPrice must be a number >= 0' }, { status: 400 })
    }
    if (simMargin !== null && !Number.isFinite(Number(simMargin))) {
      return NextResponse.json({ error: 'simMargin must be a number' }, { status: 400 })
    }

    // Get weighted HPP
    const { data: costs, error: costsErr } = await supabase
      .from('product_costs')
      .select('effective_cost, quantity')
      .eq('product_id', productId)

    if (costsErr) throw costsErr

    const { data: product, error: prodErr } = await supabase
      .from('products')
      .select('id, name, sku')
      .eq('id', productId)
      .single()

    // Was: both errors discarded, so a missing product returned a result
    // object with an empty name and hpp 0 — indistinguishable from a real
    // product that has no purchase history.
    if (prodErr || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const totalCost = (costs || []).reduce(
      (s, c: any) => s + Number(c.effective_cost ?? 0) * Number(c.quantity ?? 0),
      0
    )
    const totalQty = (costs || []).reduce((s, c: any) => s + Number(c.quantity ?? 0), 0)
    const hpp = totalQty > 0 ? totalCost / totalQty : 0

    let finalPrice = hpp
    if (simPrice) {
      finalPrice = Number(simPrice)
    } else if (simMargin) {
      finalPrice = hpp * (1 + Number(simMargin) / 100)
    }

    const profitPerUnit = finalPrice - hpp

    return NextResponse.json({
      data: {
        product_id: productId,
        product_name: product?.name || '',
        product_sku: product?.sku || '',
        hpp: Math.round(hpp * 100) / 100,
        sim_sell_price: Math.round(finalPrice * 100) / 100,
        profit_per_unit: Math.round(profitPerUnit * 100) / 100,
        total_revenue: Math.round(finalPrice * estQty * 100) / 100,
        total_cogs: Math.round(hpp * estQty * 100) / 100,
        total_profit: Math.round(profitPerUnit * estQty * 100) / 100,
        margin_pct: finalPrice > 0 ? Math.round((profitPerUnit / finalPrice) * 10000) / 100 : 0,
        est_qty: estQty,
      },
    })
  } catch (err) {
    // Was `err?.message`, which forwarded raw Postgres/PostgREST text — table
    // and column names, constraint details — straight to the browser. Errors are
    // logged server-side and generalised for the client.
    return toErrorResponse(err)
  }
}