/**
 * SMOKE 1 — concurrent sale of the last unit.
 *
 * Two POST /api/sales requests fire simultaneously for the final unit of a
 * product. Exactly one must succeed (201) and one must fail (409 insufficient
 * stock). If both succeed, the advisory lock inside create_sale() is not
 * serialising and stock has gone negative.
 */
import { admin, api, signIn, migration0002Applied } from './helpers'

const db = admin()

let cookie: string | null = null
let has0002 = false
let productId: number | null = null

beforeAll(async () => {
  has0002 = await migration0002Applied()
  cookie = await signIn('admin', 'admin123')
})

afterAll(async () => {
  // Remove sales created by this suite, then restore stock via a ledger entry.
  if (productId != null) {
    const { data: sales } = await db.from('sales').select('id').like('invoice_no', 'SMOKE-%')
    for (const s of sales ?? []) {
      await db.from('sale_items').delete().eq('sale_id', s.id)
      await db.from('sales').delete().eq('id', s.id)
    }
    await db.from('stock_ledger').delete().like('note', 'SMOKE-%')
  }
})

test('preconditions: migration 0002 applied and login works', async () => {
  expect({ migration0002Applied: has0002, loginSucceeded: cookie !== null }).toEqual({
    migration0002Applied: true,
    loginSucceeded: true,
  })
})

test('two concurrent sales of the last unit: exactly one 201, one 409', async () => {
  if (!has0002 || !cookie) {
    throw new Error(
      `Cannot run: migration0002Applied=${has0002}, loginSucceeded=${cookie !== null}`
    )
  }

  // Pick a product and drive its stock to exactly 1 via the ledger (trigger T1
  // recomputes products.stock_qty; we never write stock_qty ourselves).
  const { data: product } = await db
    .from('products')
    .select('id, stock_qty, selling_price')
    .order('id')
    .limit(1)
    .single()
  productId = product!.id

  const delta = Number(product!.stock_qty) - 1
  if (delta > 0) {
    await db.from('stock_ledger').insert({
      product_id: productId,
      qty_out: delta,
      note: 'SMOKE-setup drive stock to 1',
    })
  }

  const { data: check } = await db.from('products').select('stock_qty').eq('id', productId).single()
  expect(Number(check!.stock_qty)).toBe(1)

  const payload = (inv: string) => ({
    method: 'POST',
    cookie,
    body: JSON.stringify({
      invoice_no: inv,
      items: [{ product_id: productId, quantity: 1, unit_price: 1000 }],
    }),
  })

  const [a, b] = await Promise.all([
    api('/api/sales', payload('SMOKE-A')),
    api('/api/sales', payload('SMOKE-B')),
  ])

  const statuses = [a.status, b.status].sort()
  const { data: after } = await db.from('products').select('stock_qty').eq('id', productId).single()

  expect({ statuses, finalStock: Number(after!.stock_qty) }).toEqual({
    statuses: [201, 409],
    finalStock: 0,
  })
})
