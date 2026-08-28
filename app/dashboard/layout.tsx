'use client'

import AppShell from '@/components/AppShell'

/**
 * Route-group layout. All shell/gating logic lives in components/AppShell so
 * that every authenticated page shares one implementation.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
