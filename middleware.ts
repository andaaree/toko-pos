import { withAuth } from 'next-auth/middleware'

/**
 * SERVER-SIDE route gate.
 *
 * components/AppShell.tsx gates with useSession() + router.push, which is a
 * CLIENT-side check and therefore cosmetic: hitting /stock-management directly
 * still served the prerendered HTML shell, and the redirect only happened after
 * React hydrated. This middleware rejects the request before any page HTML is
 * produced, so the client gate becomes defence-in-depth rather than the only
 * barrier.
 *
 * withAuth redirects unauthenticated requests to authOptions.pages.signIn
 * ('/login') and preserves the original path as a callbackUrl.
 */
export default withAuth({
  pages: {
    signIn: '/login',
  },
})

export const config = {
  /**
   * Protected paths only. Deliberately excluded:
   *  - /login              — would loop.
   *  - /api/auth/*         — NextAuth's own endpoints must stay reachable.
   *  - /                   — a redirect stub to /dashboard, which is protected.
   *  - _next, favicon      — static assets.
   *
   * API routes are NOT listed here: each one performs its own session and role
   * check (requireUser / requireAdmin) and must return a JSON 401/403 rather
   * than the HTML redirect middleware would issue.
   */
  matcher: ['/dashboard/:path*', '/stock-management/:path*', '/hpp-pricing/:path*', '/profit-simulation/:path*'],
}
