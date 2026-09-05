/**
 * SMOKE 2 — PATCH / DELETE against a nonexistent id must return 404.
 *
 * Exercises the two mappings added during the Stage 3 review and never
 * executed: PGRST116 -> 404 on update, and count:'exact' with count === 0 ->
 * 404 on delete.
 */
import { api, signIn } from './helpers'

const MISSING_ID = 99999999

let adminCookie: string | null = null

beforeAll(async () => {
  adminCookie = await signIn('admin', 'admin123')
})

test('precondition: admin login works', () => {
  expect(adminCookie).not.toBeNull()
})

describe.each([
  ['products', { name: 'smoke-rename' }],
  ['categories', { name: 'smoke-rename' }],
  ['suppliers', { name: 'smoke-rename' }],
  ['customers', { name: 'smoke-rename' }],
])('%s', (resource, patchBody) => {
  test(`PATCH /api/${resource}?id=${MISSING_ID} -> 404`, async () => {
    const res = await api(`/api/${resource}?id=${MISSING_ID}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: JSON.stringify(patchBody),
    })
    expect({ resource, status: res.status }).toEqual({ resource, status: 404 })
  })

  test(`DELETE /api/${resource}?id=${MISSING_ID} -> 404`, async () => {
    const res = await api(`/api/${resource}?id=${MISSING_ID}`, {
      method: 'DELETE',
      cookie: adminCookie,
    })
    expect({ resource, status: res.status }).toEqual({ resource, status: 404 })
  })
})

test('error bodies do not leak Postgres internals', async () => {
  const res = await api(`/api/products?id=${MISSING_ID}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: JSON.stringify({ name: 'smoke-rename' }),
  })
  // No table/column/constraint names, no PostgREST error codes.
  expect(res.raw).not.toMatch(/PGRST|pg_|relation |column |constraint /i)
})

test('unauthenticated write is rejected with JSON, not an HTML redirect', async () => {
  const res = await api(`/api/products?id=${MISSING_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'smoke-rename' }),
  })
  expect({
    status: res.status,
    isJson: res.body !== null,
    isHtml: res.raw.trimStart().startsWith('<'),
  }).toEqual({ status: 401, isJson: true, isHtml: false })
})
