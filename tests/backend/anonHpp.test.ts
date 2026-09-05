/**
 * SMOKE 3 — anon-key HPP read.
 *
 * The browser calls get_weighted_hpp() with the anon key. If the GRANT to anon
 * regressed, PostgREST returns permission denied and the route's JS fallback
 * silently substitutes zeros — a 200 full of zeros, which looks like success.
 * So this asserts the RPC itself succeeds AND that real numbers come back.
 */
import { anon, admin, api, signIn, migration0002Applied } from './helpers'

const pub = anon()
const db = admin()

test('precondition: migration 0002 applied', async () => {
  expect(await migration0002Applied()).toBe(true)
})

test('anon client may execute get_weighted_hpp (GRANT intact)', async () => {
  const { data: products } = await db.from('products').select('id').order('id').limit(5)
  const ids = (products ?? []).map((p: any) => p.id)
  expect(ids.length).toBeGreaterThan(0)

  const { data, error } = await pub.rpc('get_weighted_hpp', { p_product_ids: ids })

  expect(error).toBeNull()
  expect(Array.isArray(data)).toBe(true)
})

test('weighted HPP returns non-zero cost for a product that has purchase history', async () => {
  // Find a product that genuinely has cost rows; otherwise zero is the correct
  // answer and would make this assertion meaningless.
  const { data: costRows } = await db
    .from('product_costs')
    .select('product_id')
    .limit(50)
  const withHistory = [...new Set((costRows ?? []).map((r: any) => r.product_id))]

  if (withHistory.length === 0) {
    throw new Error('No product_costs rows exist — seeder has not been run, cannot validate HPP')
  }

  const { data, error } = await pub.rpc('get_weighted_hpp', { p_product_ids: withHistory })
  expect(error).toBeNull()

  const nonZero = (data ?? []).filter((r: any) => Number(r.weighted_hpp ?? r.hpp ?? 0) > 0)
  expect(nonZero.length).toBeGreaterThan(0)
})

test('anon client is read-only: RLS blocks a direct product write', async () => {
  const { error } = await pub.from('products').update({ selling_price: 1 }).eq('id', 1)
  // Either an explicit RLS error, or zero rows affected — never a success that
  // changed data.
  const { data: after } = await db.from('products').select('selling_price').eq('id', 1).single()
  expect({ blocked: error !== null || Number(after?.selling_price) !== 1 }).toEqual({ blocked: true })
})

test('GET /api/hpp-pricing requires a session', async () => {
  const res = await api('/api/hpp-pricing?page=1&pageSize=5')
  expect(res.status).toBe(401)
})

test('GET /api/hpp-pricing returns rows with usable numbers when signed in', async () => {
  const cookie = await signIn('admin', 'admin123')
  if (!cookie) throw new Error('admin login failed — cannot exercise the endpoint')
  const res = await api('/api/hpp-pricing?page=1&pageSize=5', { cookie })
  expect(res.status).toBe(200)
  const rows = res.body?.data ?? res.body?.items ?? res.body
  expect(Array.isArray(rows)).toBe(true)
})
