'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

type Product = {
  id: number
  sku: string
  name: string
  unit: string
  min_stock: number
  category: string
  hpp: number
  sell_price: number
  margin_pct: number
  min_discount: number
  auto_update: boolean
  current_stock: number
  pricing_type: string
  margin_value: number
}

const rupiah = (n: unknown) =>
  `Rp ${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`

export default function HPPPricingPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'

  const [products, setProducts] = useState<Product[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [pricingType, setPricingType] = useState<'percentage' | 'fixed'>('percentage')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /**
   * READ via /api/hpp-pricing: this endpoint is a computation (weighted HPP +
   * margin resolution), not a plain table read, so it stays an API call. Simple
   * table reads elsewhere use the anon client directly per D2.
   */
  const loadProducts = useCallback(
    async (nextCursor?: string, append = false) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set('cursor', nextCursor || '0')
        params.set('limit', '50')
        if (search) params.set('search', search)

        const res = await fetch(`/api/hpp-pricing?${params.toString()}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)

        const rows: Product[] = json.data || []
        setProducts((prev) => (append ? [...prev, ...rows] : rows))
        setCursor(json.nextCursor)
        setHasMore(!!json.hasMore)
      } catch (err) {
        // Was console.error only, which rendered an empty table with no reason.
        setError(err instanceof Error ? err.message : 'Failed to load products')
        if (!append) setProducts([])
      } finally {
        setLoading(false)
      }
    },
    [search]
  )

  // Single fetch trigger. Previously a useEffect on [search] AND the submit
  // handler both fired loadProducts, double-requesting on every search.
  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  const saveMargin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return

    const form = e.target as HTMLFormElement
    const data = Object.fromEntries(new FormData(form).entries())
    const value = Number(data.margin_value)

    if (!Number.isFinite(value) || value < 0) {
      setSaveError('Nilai margin harus berupa angka >= 0')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/hpp-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: editing.id,
          pricing_type: pricingType,
          // For "fixed", the entered number IS the sell price; the backend
          // requires sell_price to be present when pricing_type is fixed.
          margin_value: pricingType === 'fixed' ? 0 : value,
          sell_price: pricingType === 'fixed' ? value : null,
          min_discount: Number(data.min_discount) || 0,
          auto_update: data.auto_update === 'true',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)

      setEditing(null)
      await loadProducts()
    } catch (err) {
      // Was a raw alert(); inline errors keep the entered values visible.
      setSaveError(err instanceof Error ? err.message : 'Failed to save margin')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">HPP &amp; Harga Jual</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(searchInput)
          }}
          className="flex space-x-2"
        >
          <label htmlFor="search" className="sr-only">
            Cari SKU atau nama produk
          </label>
          <input
            id="search"
            type="text"
            placeholder="Cari SKU atau nama..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm sm:text-sm"
          />
          <button
            type="submit"
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            Cari
          </button>
        </form>
      </div>

      {!isAdmin && (
        <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700">
          Anda masuk sebagai kasir — pengaturan margin hanya dapat diubah oleh admin.
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <caption className="sr-only">Daftar HPP dan harga jual produk</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nama Produk</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">HPP</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Harga Jual</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin %</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stok</th>
              {isAdmin && (
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Aksi</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && products.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-6 py-8 text-center text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && !error && products.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-6 py-8 text-center text-sm text-gray-500">
                  Tidak ada produk ditemukan.
                </td>
              </tr>
            )}
            {products.map((p) => {
              // Number() guards: a product with no purchase history returns
              // hpp/sell_price of 0 or null, and .toLocaleString() on null threw.
              const marginPct = Number(p.margin_pct ?? 0)
              return (
                <tr key={p.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{p.sku}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {p.name}
                    <div className="text-xs text-gray-500">{p.category}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">{rupiah(p.hpp)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                    {rupiah(p.sell_price)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        marginPct >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {marginPct.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        Number(p.current_stock ?? 0) <= Number(p.min_stock ?? 0)
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {Number(p.current_stock ?? 0)}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          setSaveError(null)
                          setPricingType(p.pricing_type === 'fixed' ? 'fixed' : 'percentage')
                          setEditing(p)
                        }}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        Edit Margin
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {hasMore && (
          <div className="px-6 py-4 border-t">
            <button
              onClick={() => loadProducts(cursor || undefined, true)}
              disabled={loading}
              className="w-full inline-flex justify-center px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>

      {editing && isAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="margin-title"
            className="bg-white rounded-lg shadow-xl max-w-md w-full"
          >
            <h2 id="margin-title" className="text-lg font-semibold text-gray-900 px-6 pt-6">
              Edit Margin: {editing.name}
            </h2>
            <p className="px-6 pt-1 text-sm text-gray-500">HPP saat ini: {rupiah(editing.hpp)}</p>
            <form onSubmit={saveMargin} className="px-6 py-4 space-y-4">
              {saveError && (
                <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {saveError}
                </div>
              )}
              <div>
                <label htmlFor="pricing_type" className="block text-sm font-medium text-gray-700 mb-1">
                  Metode Pricing
                </label>
                <select
                  id="pricing_type"
                  name="pricing_type"
                  value={pricingType}
                  onChange={(e) => setPricingType(e.target.value as 'percentage' | 'fixed')}
                  className="w-full rounded-md border-gray-300 shadow-sm"
                >
                  <option value="percentage">Persentase (%)</option>
                  <option value="fixed">Fixed (Rp)</option>
                </select>
              </div>
              <div>
                <label htmlFor="margin_value" className="block text-sm font-medium text-gray-700 mb-1">
                  {pricingType === 'fixed' ? 'Harga Jual Tetap (Rp)' : 'Margin (%)'}
                </label>
                <input
                  id="margin_value"
                  type="number"
                  name="margin_value"
                  defaultValue={
                    pricingType === 'fixed'
                      ? Number(editing.sell_price ?? 0)
                      : Number(editing.margin_value ?? 0)
                  }
                  step="0.01"
                  min="0"
                  className="w-full rounded-md border-gray-300 shadow-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="min_discount" className="block text-sm font-medium text-gray-700 mb-1">
                  Diskon Maks (%)
                </label>
                <input
                  id="min_discount"
                  type="number"
                  name="min_discount"
                  defaultValue={Number(editing.min_discount ?? 0)}
                  min="0"
                  max="100"
                  className="w-full rounded-md border-gray-300 shadow-sm"
                />
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    name="auto_update"
                    defaultChecked={editing.auto_update}
                    value="true"
                  />
                  <span className="text-sm text-gray-700">Auto update saat HPP berubah</span>
                </label>
              </div>
              <div className="flex justify-end space-x-2 pt-4">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
