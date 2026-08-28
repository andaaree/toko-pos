import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { requireUser, toErrorResponse, ApiAuthError } from '@/lib/apiAuth'
import { createSaleSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/sales — create a sale (spec §5.2, D5).
 *
 * Cashier AND admin may sell; requireUser (not requireAdmin) is correct here.
 *
 * ATOMICITY: delegates to the create_sale() SQL function via RPC. The whole
 * unit of work — sales insert, per-item weighted-average unit_cost snapshot,
 * sale_items inserts, stock_ledger out-entries — runs in ONE database
 * transaction. Doing this with separate supabase-js calls could not be atomic:
 * each call is its own HTTP request and its own implicit transaction, so a
 * failure midway would leave an item-less sale with totals stuck at 0.
 *
 * The route never sends unit_cost, balance_after, or sales totals: those are
 * owned by the SQL snapshot logic and by triggers T1/T2 respectively.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser()

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      throw new ApiAuthError(400, 'Invalid JSON body')
    }

    const parsed = createSaleSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const input = parsed.data

    // Reject duplicate product lines: two rows for one product would each fire
    // T1 and produce a confusing double ledger entry.
    const productIds = input.items.map((i) => i.product_id)
    if (new Set(productIds).size !== productIds.length) {
      return NextResponse.json(
        { error: 'Duplicate product in items; merge quantities instead' },
        { status: 400 }
      )
    }

    // Server-generated invoice number when the client omits one.
    const invoiceNo =
      input.invoice_no ??
      `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now()
        .toString()
        .slice(-6)}`

    const admin = getSupabaseAdmin()

    const { data, error } = await admin.rpc('create_sale', {
      p_invoice_no: invoiceNo,
      p_customer_id: input.customer_id ?? null,
      p_payment_method: input.payment_method,
      p_created_by: user.id,
      p_items: input.items,
    })

    if (error) {
      // Business-rule violations raised by create_sale() are client errors, not
      // server faults. Distinguish them so the UI can show something useful.
      const msg = error.message || ''

      // Checked FIRST: PostgREST reports a missing function as
      // "function public.create_sale(...) does not exist", which the generic
      // /does not exist/ branch below would otherwise swallow as a 400.
      if (/create_sale/i.test(msg) && /does not exist|PGRST202/i.test(msg)) {
        console.error('[api/sales] create_sale() missing — apply migration 0002')
        return NextResponse.json(
          { error: 'Sales function not installed; apply migration 0002' },
          { status: 500 }
        )
      }
      if (/insufficient stock/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 })
      }
      if (/duplicate key/i.test(msg) && /invoice_no/i.test(msg)) {
        return NextResponse.json(
          { error: 'Invoice number already exists' },
          { status: 409 }
        )
      }
      if (/product .* does not exist|must be positive|at least one item/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      throw error
    }

    const saleId = data as unknown as number

    // Read back the trigger-computed totals so the client does not have to
    // guess what T2 produced.
    const { data: sale } = await admin
      .from('sales')
      .select('id, invoice_no, total_amount, total_cost, payment_method, status, created_at')
      .eq('id', saleId)
      .single()

    return NextResponse.json({ data: sale ?? { id: saleId, invoice_no: invoiceNo } }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
