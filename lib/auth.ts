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

        // MUST use service_role: 0001 puts ENABLE + FORCE ROW LEVEL SECURITY on
        // users and defines NO anon policy (anon_read covers only the 10
        // business tables). Reading users with the anon client always returns an
        // RLS error, so this lookup failed for every credential and login was
        // impossible for all accounts.
        const admin = getSupabaseAdmin()
        const { data: user, error } = await admin
          .from('users')
          .select('id, username, email, name, password_hash, role, is_active')
          .eq('username', credentials.username)
          .single()

        if (error || !user) {
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

        // Disabled accounts must not obtain a session. requireUser() rejects
        // them per request, but without this check a deactivated user could
        // still sign in and hold a valid token.
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
          // NextAuth's User.id is typed as string by contract; the database
          // column is an integer. Converted here, and parsed back where a
          // numeric id is needed (lib/apiAuth requireUser).
          id: String(row.id),
          username: row.username,
          email: row.email,
          name: row.name,
          role: row.role,
          // Narrowed to true by the is_active === false guard above; a NULL
          // column (pre-existing rows created before the is_active migration)
          // is treated as active.
          isActive: true
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
  secret: process.env.NEXTAUTH_SECRET,
}

export default NextAuth(authOptions)