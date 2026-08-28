'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'

type StockItem = {
  id: number
  sku: string
  name: string
  unit: string
  min_stock: number
  current_stock: number
  status: 'OK' | 'LOW' | 'EMPTY'
}

const PAGE_SIZE = 100

function statusOf(stock: number, min: number): StockItem['status'] {
  if (stock <= 0) return 'EMPTY'
  if (stock <= min) return 'LOW'
  return 'OK'
}

export default function StockManagementPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'

  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'ALL' | 'LOW' | 'EMPTY'>('ALL')
  const [hasMore, setHasMore] = useState(false)
  const [adjustModal, setAdjustModal] = useState<{ item: StockItem; qty: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /**
   * READ — direct Supabase anon client per spec D2.
   * Uses the cached products.stock_qty column (D4), not a ledger aggregation.
   */
  const load = useCallback(async (afterId = 0, append = false) => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await supabase
        .from('products')
        .select('id, sku, name, unit, min_stock, stock_qty')
        .eq('is_active', true)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)

      if (qErr) throw new Error(qErr.message)

      const rows: StockItem[] = (data || []).map((p: any) => {
        const stock = Number(p.stock_qty ?? 0)
        const min = Number(p.min_stock ?? 0)
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          min_stock: min,
          current_stock: stock,
          status: statusOf(stock, min),
        }
      })

      setItems((prev) => (append ? [...prev, ...rows] : rows))
      setHasMore(rows.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock')
      if (!append) setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Client-side filter: status is derived, so filtering here avoids a round trip.
  const visible = items.filter((i) => (filter === 'ALL' ? true : i.status === filter))

  /**
   * WRITE — goes through the API route (service_role, admin-only). The browser
   * never writes to Supabase directly.
   *
   * Sends target_qty, the absolute counted quantity; the server reads current
   * stock_qty and derives the ledger delta. The previous version sent
   * `{ action, qty }`, but the endpoint expects `target_qty` — Zod stripped
   * `qty`, so every adjustment silently failed validation.
   */
  const handleAdjust = async () => {
    if (!adjustModal) return
    const target = Number(adjustModal.qty)
    if (!Number.isInteger(target) || target < 0) {
      setSaveError('Jumlah harus berupa bilangan bulat >= 0')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/stock-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'adjustment',
          product_id: adjustModal.item.id,
          target_qty: target,
          note: `Stock opname: ${adjustModal.item.current_stock} -> ${target}`,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)

      setAdjustModal(null)
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to adjust stock')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Stock Management</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="filter" className="text-sm text-gray-600">
            Status
          </label>
          <select
            id="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'ALL' | 'LOW' | 'EMPTY')}
            className="rounded-md border-gray-300 shadow-sm sm:text-sm"
          >
            <option value="ALL">Semua</option>
            <option value="LOW">Stok Rendah</option>
            <option value="EMPTY">Stok Habis</option>
          </select>
        </div>
      </div>

      {!isAdmin && (
        <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700">
          Anda masuk sebagai kasir — penyesuaian stok hanya dapat dilakukan oleh admin.
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <caption className="sr-only">Daftar stok produk</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nama Produk</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stok Saat Ini</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Min Stock</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Status</th>
              {isAdmin && (
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Aksi</th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-6 py-8 text-center text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && !error && visible.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} className="px-6 py-8 text-center text-sm text-gray-500">
                  Tidak ada produk yang cocok.
                </td>
              </tr>
            )}
            {visible.map((item) => (
              <tr key={item.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.sku}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{item.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                  {item.current_stock} {item.unit}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                  {item.min_stock} {item.unit}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded-full ${
                      item.status === 'OK'
                        ? 'bg-green-100 text-green-800'
                        : item.status === 'LOW'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => {
                        setSaveError(null)
                        setAdjustModal({ item, qty: String(item.current_stock) })
                      }}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      Adjust
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {hasMore && (
          <div className="px-6 py-4 border-t">
            <button
              onClick={() => load(items[items.length - 1]?.id ?? 0, true)}
              disabled={loading}
              className="w-full inline-flex justify-center px-4 py-2 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>

      {adjustModal && isAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div role="dialog" aria-modal="true" aria-labelledby="adjust-title" className="bg-white rounded shadow-xl max-w-sm w-full p-6">
            <h2 id="adjust-title" className="text-lg font-semibold text-gray-900 mb-4">
              Adjust Stock: {adjustModal.item.name}
            </h2>
            <p className="text-sm text-gray-500 mb-3">
              Stok tercatat saat ini: {adjustModal.item.current_stock} {adjustModal.item.unit}
            </p>
            {saveError && (
              <div role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="mb-4">
              <label htmlFor="qty" className="block text-sm text-gray-700 mb-1">
                Jumlah Aktual (hasil hitung fisik)
              </label>
              <input
                id="qty"
                type="number"
                min="0"
                step="1"
                value={adjustModal.qty}
                onChange={(e) => setAdjustModal({ ...adjustModal, qty: e.target.value })}
                className="w-full rounded-md border-gray-300"
              />
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setAdjustModal(null)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 border rounded hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                onClick={handleAdjust}
                disabled={saving}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
