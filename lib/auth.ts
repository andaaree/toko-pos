import NextAuth from "next-auth"
import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { getSupabaseAdmin } from "./supabaseAdmin"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }

        try {
          // MUST use service_role: 0001 puts ENABLE + FORCE ROW LEVEL SECURITY on
          // users and defines NO anon policy.
          const admin = getSupabaseAdmin()
          const loginInput = credentials.username.trim()

          // Query by username OR email to allow signing in with either credential
          const { data: user, error } = await admin
            .from('users')
            .select('id, username, email, name, password_hash, role, is_active')
            .or(`username.eq.${loginInput},email.eq.${loginInput}`)
            .maybeSingle()

          if (error || !user) {
            console.error('[auth] User lookup failed or not found:', error?.message || 'User not found')
            return null
          }

          const row = user as {
            id: number
            username: string
            email: string | null
            name: string | null
            password_hash: string
            role: string
            is_active: boolean | null
          }

          if (row.is_active === false) {
            return null
          }

          if (!row.password_hash) {
            return null
          }

          const isValid = await bcrypt.compare(credentials.password, row.password_hash)

          if (!isValid) {
            return null
          }

          return {
            id: String(row.id),
            username: row.username,
            email: row.email,
            name: row.name,
            role: row.role,
            isActive: true
          }
        } catch (err) {
          console.error('[auth] Authorize exception:', err)
          return null
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.username = user.username
        token.role = user.role
        token.isActive = user.isActive
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.username = token.username as string
        session.user.role = token.role as string
        session.user.isActive = token.isActive as boolean
      }
      return session
    }
  },
  pages: {
    signIn: '/login',
    error: '/login'
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "default_toko_pos_nextauth_secret_key_32bytes",
}