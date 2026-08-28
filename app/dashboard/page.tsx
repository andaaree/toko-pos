'use client'

import { useCallback, useEffect, useState } from 'react'

type PeriodType = 'daily' | 'weekly' | 'monthly'

type SummaryRow = {
  period_bucket: string
  total_orders: number
  total_revenue: number
  total_cogs: number
  gross_profit: number
  margin_pct: number
}

const rupiah = (n: unknown) =>
  `Rp ${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`

export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodType>('daily')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ period })
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/dashboard/profit-summary?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
      setSummary(json.data || [])
    } catch (err) {
      // Previously swallowed into console.error, leaving a blank page with no
      // explanation of why.
      setError(err instanceof Error ? err.message : 'Failed to load summary')
      setSummary([])
    } finally {
      setLoading(false)
    }
  }, [period, startDate, endDate])

  // Load on mount. The old version only fetched when "Apply" was clicked, so the
  // dashboard was permanently empty on arrival.
  useEffect(() => {
    fetchSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = summary.reduce(
    (acc, r) => ({
      orders: acc.orders + Number(r.total_orders ?? 0),
      revenue: acc.revenue + Number(r.total_revenue ?? 0),
      cogs: acc.cogs + Number(r.total_cogs ?? 0),
      profit: acc.profit + Number(r.gross_profit ?? 0),
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 }
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Profit Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="period">
            Periode
          </label>
          <select
            id="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodType)}
            className="rounded-md border-gray-300 shadow-sm sm:text-sm"
          >
            <option value="daily">Harian</option>
            <option value="weekly">Mingguan</option>
            <option value="monthly">Bulanan</option>
          </select>
          <label className="sr-only" htmlFor="startDate">
            Tanggal mulai
          </label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm sm:text-sm"
          />
          <span className="text-gray-500">to</span>
          <label className="sr-only" htmlFor="endDate">
            Tanggal akhir
          </label>
          <input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-md border-gray-300 shadow-sm sm:text-sm"
          />
          <button
            onClick={fetchSummary}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Apply'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && summary.length > 0 && (
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-4">
          <div className="bg-white shadow rounded-lg p-5">
            <dt className="text-sm font-medium text-gray-500">Total Orders</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{totals.orders}</dd>
          </div>
          <div className="bg-white shadow rounded-lg p-5">
            <dt className="text-sm font-medium text-gray-500">Revenue</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{rupiah(totals.revenue)}</dd>
          </div>
          <div className="bg-white shadow rounded-lg p-5">
            <dt className="text-sm font-medium text-gray-500">COGS</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{rupiah(totals.cogs)}</dd>
          </div>
          <div className="bg-white shadow rounded-lg p-5">
            <dt className="text-sm font-medium text-gray-500">Gross Profit</dt>
            <dd className="mt-1 text-2xl font-semibold text-green-600">{rupiah(totals.profit)}</dd>
          </div>
        </dl>
      )}

      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <caption className="sr-only">Ringkasan profit per periode</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Periode</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Orders</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">COGS</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Profit</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading && summary.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && !error && summary.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                  Belum ada data penjualan untuk periode ini.
                </td>
              </tr>
            )}
            {summary.map((row) => (
              <tr key={row.period_bucket}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.period_bucket}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">{row.total_orders}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">{rupiah(row.total_revenue)}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">{rupiah(row.total_cogs)}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-green-600">
                  {rupiah(row.gross_profit)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                  {Number(row.margin_pct ?? 0).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
