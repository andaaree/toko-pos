'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Shared authenticated shell: session gate + nav + user badge.
 *
 * Previously each of stock-management, hpp-pricing and profit-simulation
 * carried its own copy of the nav array, session gate and logout button. Four
 * copies had already drifted (dashboard/layout.tsx had no logout button at all).
 * One component keeps gating consistent — an auth check that exists in three
 * places out of four is a hole.
 */

const navigation = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'HPP & Harga Jual', href: '/hpp-pricing' },
  { name: 'Simulasi Profit', href: '/profit-simulation' },
  { name: 'Stock Management', href: '/stock-management' },
]

export function useIsAdmin() {
  const { data: session } = useSession()
  return session?.user?.role === 'admin'
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading...
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <span className="text-xl font-bold text-indigo-600">POS Admin</span>
              </div>
              <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                      pathname === item.href
                        ? 'border-indigo-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    {item.name}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">{session.user?.name}</span>
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800">
                {session.user?.role}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
