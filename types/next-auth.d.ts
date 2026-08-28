import type { DefaultSession, DefaultUser } from "next-auth"
import type { DefaultJWT } from "next-auth/jwt"

/**
 * Module augmentation for NextAuth.
 * The credentials provider in lib/auth.ts returns username/role/isActive on top
 * of the default user shape, and the jwt/session callbacks forward those fields.
 * Declaring them here keeps `session.user.role` type-safe across the app.
 */
declare module "next-auth" {
  interface User extends DefaultUser {
    id: string
    username: string
    role: string
    isActive: boolean
  }

  interface Session extends DefaultSession {
    user: {
      id: string
      username: string
      role: string
      isActive: boolean
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string
    username: string
    role: string
    isActive: boolean
  }
}
