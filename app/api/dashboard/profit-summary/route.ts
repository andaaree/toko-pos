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
    const periodParam = searchParams.get('period') || 'daily'
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    // Whitelist rather than a bare cast: `as 'daily'|'weekly'|'monthly'` is a
    // compile-time assertion only, so any query value was accepted silently.
    if (!['daily', 'weekly', 'monthly'].includes(periodParam)) {
      return NextResponse.json(
        { error: "period must be one of 'daily', 'weekly', 'monthly'" },
        { status: 400 }
      )
    }
    const period = periodParam as 'daily' | 'weekly' | 'monthly'

    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (startDate && !isDate(startDate)) {
      return NextResponse.json({ error: 'startDate must be YYYY-MM-DD' }, { status: 400 })
    }
    if (endDate && !isDate(endDate)) {
      return NextResponse.json({ error: 'endDate must be YYYY-MM-DD' }, { status: 400 })
    }
    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json(
        { error: 'startDate must not be after endDate' },
        { status: 400 }
      )
    }

    /**
     * Bucket key derivation.
     *
     * The previous implementation built Postgres SQL strings (to_char/date_trunc)
     * and then interpolated them as JS template literals:
     * `const bucket = ${bucketExpr}`. That SQL was never sent to the database, so
     * every sale collapsed into ONE group keyed by the literal text
     * "to_char(created_at, 'YYYY-MM-DD')" — the dashboard always showed a single
     * row labelled with raw SQL, for every period option. Derived in JS from each
     * row's timestamp instead.
     */
    const bucketOf = (iso: string): string => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return 'unknown'
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const day = String(d.getUTCDate()).padStart(2, '0')

      if (period === 'monthly') return `${y}-${m}`
      if (period === 'weekly') {
        // ISO-8601 week number, matching the to_char('IW') the SQL intended.
        const t = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()))
        const dayNum = t.getUTCDay() || 7
        t.setUTCDate(t.getUTCDate() + 4 - dayNum)
        const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
        const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
        return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
      }
      return `${y}-${m}-${day}`
    }

    let query = supabase
      .from('sales')
      // sale_items was joined but never read — dropped to avoid pulling every
      // line item of 1000 sales across the wire for nothing.
      .select('id, total_amount, total_cost, created_at')
      .eq('status', 'completed')
      .gte('created_at', startDate || '1970-01-01')
      // Inclusive end-of-day: lte('created_at', '2026-08-28') compares against
      // midnight, so sales later that same day were silently excluded.
      .lte('created_at', endDate ? `${endDate}T23:59:59.999Z` : '2099-12-31')
      .order('created_at', { ascending: true })
      .limit(1000)

    const cursor = searchParams.get('cursor')
    if (cursor) {
      const c = Number(cursor)
      if (!Number.isInteger(c) || c < 0) {
        return NextResponse.json(
          { error: 'cursor must be a non-negative integer' },
          { status: 400 }
        )
      }
      query = query.gt('id', c)
    }

    const { data: sales, error } = await query

    // Was `error.message`, forwarding raw Postgres text to the browser.
    if (error) throw error

    const grouped: Record<string, any> = {}
    for (const sale of sales || []) {
      const bucket = bucketOf((sale as any).created_at)
      if (!grouped[bucket]) {
        grouped[bucket] = {
          period_bucket: bucket,
          total_orders: 0,
          total_revenue: 0,
          total_cogs: 0,
          gross_profit: 0,
        }
      }
      const revenue = Number((sale as any).total_amount ?? 0)
      const cogs = Number((sale as any).total_cost ?? 0)
      grouped[bucket].total_orders += 1
      grouped[bucket].total_revenue += revenue
      grouped[bucket].total_cogs += cogs
      grouped[bucket].gross_profit += revenue - cogs
    }

    const result = Object.values(grouped)
      .map((row: any) => ({
        ...row,
        margin_pct:
          row.total_revenue > 0
            ? Number(((row.gross_profit / row.total_revenue) * 100).toFixed(2))
            : 0,
        total_revenue: Number(row.total_revenue.toFixed(2)),
        total_cogs: Number(row.total_cogs.toFixed(2)),
        gross_profit: Number(row.gross_profit.toFixed(2)),
      }))
      .sort((a, b) => a.period_bucket.localeCompare(b.period_bucket))

    return NextResponse.json({ data: result })
  } catch (err) {
    return toErrorResponse(err)
  }
}