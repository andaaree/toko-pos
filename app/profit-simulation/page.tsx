'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Product {
  id: number
  sku: string
  name: string
}

interface SimResult {
  product_id: number
  product_name: string
  product_sku: string
  hpp: number
  sim_sell_price: number
  profit_per_unit: number
  total_revenue: number
  total_cogs: number
  total_profit: number
  margin_pct: number
  est_qty: number
}

const rupiah = (n: unknown) =>
  `Rp ${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`

export default function ProfitSimulationPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [productsError, setProductsError] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState('')
  const [mode, setMode] = useState<'margin' | 'price'>('margin')
  const [marginValue, setMarginValue] = useState('30')
  const [sellPrice, setSellPrice] = useState('')
  const [estQty, setEstQty] = useState('100')
  const [result, setResult] = useState<SimResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * READ — direct anon client (D2). This is a plain lookup of id/sku/name for a
   * dropdown, so it does not need the HPP computation endpoint.
   *
   * The previous version fetched /api/hpp-pricing and then RECURSED through
   * every page of results, appending into state on each pass — an unbounded
   * request chain that computed weighted HPP for the whole catalogue just to
   * populate a <select>, and duplicated entries because it appended without
   * resetting.
   */
  const loadProducts = useCallback(async () => {
    setProductsError(null)
    try {
      const { data, error: qErr } = await supabase
        .from('products')
        .select('id, sku, name')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(500)

      if (qErr) throw new Error(qErr.message)
      setProducts((data as Product[]) || [])
    } catch (err) {
      setProductsError(err instanceof Error ? err.message : 'Failed to load products')
      setProducts([])
    }
  }, [])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  const runSimulation = async () => {
    if (!selectedProduct) return

    const qty = Number(estQty)
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Estimasi qty harus bilangan bulat >= 1')
      return
    }
    if (mode === 'price' && !(Number(sellPrice) > 0)) {
      setError('Masukkan rencana harga jual lebih besar dari 0')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('productId', selectedProduct)
      params.set('estQty', String(qty))
      if (mode === 'margin') params.set('simMargin', marginValue)
      else params.set('simPrice', sellPrice)

      const res = await fetch(`/api/profit-simulation?${params.toString()}`)
      const json = await res.json().catch(() => ({}))
      // Was `if (res.ok)` with no else: a failed simulation left the previous
      // result on screen with no indication it was stale.
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)

      setResult(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Simulasi Profit</h1>

      {productsError && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {productsError}
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-6 space-y-4">
        <div>
          <label htmlFor="product" className="block text-sm font-medium text-gray-700 mb-1">
            Pilih Produk
          </label>
          <select
            id="product"
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm sm:text-sm"
          >
            <option value="">-- Pilih Produk --</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-gray-700 mb-1">Mode Simulasi</legend>
          <div className="flex space-x-4">
            <label className="inline-flex items-center">
              <input
                type="radio"
                name="mode"
                checked={mode === 'margin'}
                onChange={() => setMode('margin')}
              />
              <span className="ml-2">Margin (%)</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                name="mode"
                checked={mode === 'price'}
                onChange={() => setMode('price')}
              />
              <span className="ml-2">Harga Jual (Rp)</span>
            </label>
          </div>
        </fieldset>

        {mode === 'margin' ? (
          <div>
            <label htmlFor="margin" className="block text-sm font-medium text-gray-700 mb-1">
              Target Margin (%)
            </label>
            <input
              id="margin"
              type="number"
              value={marginValue}
              onChange={(e) => setMarginValue(e.target.value)}
              step="0.01"
              className="w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
              Rencana Harga Jual (Rp)
            </label>
            <input
              id="price"
              type="number"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              step="1"
              min="0"
              className="w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        )}

        <div>
          <label htmlFor="qty" className="block text-sm font-medium text-gray-700 mb-1">
            Estimasi Qty Terjual
          </label>
          <input
            id="qty"
            type="number"
            value={estQty}
            onChange={(e) => setEstQty(e.target.value)}
            min="1"
            step="1"
            className="w-full rounded-md border-gray-300 shadow-sm"
          />
        </div>

        {error && (
          <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={runSimulation}
          disabled={loading || !selectedProduct}
          className="w-full inline-flex justify-center items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Menghitung...' : 'Jalankan Simulasi'}
        </button>
      </div>

      {result && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Hasil Simulasi: {result.product_name}
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-50 p-4 rounded-md">
              <dt className="text-sm text-gray-500">HPP (Harga Pokok)</dt>
              <dd className="mt-1 text-xl font-semibold text-gray-900">{rupiah(result.hpp)}</dd>
            </div>
            <div className="bg-gray-50 p-4 rounded-md">
              <dt className="text-sm text-gray-500">Harga Simulasi</dt>
              <dd className="mt-1 text-xl font-semibold text-gray-900">
                {rupiah(result.sim_sell_price)}
              </dd>
            </div>
            <div className="bg-blue-50 p-4 rounded-md">
              <dt className="text-sm text-blue-600">Profit per Unit</dt>
              <dd className="mt-1 text-xl font-semibold text-blue-700">
                {rupiah(result.profit_per_unit)}
              </dd>
            </div>
            <div className="bg-blue-50 p-4 rounded-md">
              <dt className="text-sm text-blue-600">Margin %</dt>
              <dd className="mt-1 text-xl font-semibold text-blue-700">
                {Number(result.margin_pct ?? 0).toFixed(2)}%
              </dd>
            </div>
            <div className="bg-green-50 p-4 rounded-md">
              <dt className="text-sm text-green-600">Total Revenue</dt>
              <dd className="mt-1 text-xl font-semibold text-green-700">
                {rupiah(result.total_revenue)}
              </dd>
            </div>
            <div className="bg-green-50 p-4 rounded-md">
              <dt className="text-sm text-green-600">
                Total Profit ({Number(result.est_qty ?? 0)} unit)
              </dt>
              <dd className="mt-1 text-xl font-semibold text-green-700">
                {rupiah(result.total_profit)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}
