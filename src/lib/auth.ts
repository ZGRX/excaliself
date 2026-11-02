import { type BetterAuthOptions, betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import * as schema from "@/db/schema"
import { env } from "@/env"
import {
  mayJoinWithSso,
  socialProviders,
  ssoPlugins,
} from "@/features/auth/sso"
import { rooms } from "@/features/collab/room-registry"
import { evictUser } from "@/features/collab/room-session"

type DynamicBaseURL = Exclude<NonNullable<BetterAuthOptions["baseURL"]>, string>

// Each PR preview has its own host (42.draw.example.com), so its base URL
// comes from each request, limited to PREVIEW_HOSTS. A fixed one would also
// let a production BASE_URL copied into the preview take effect. Localhost
// covers `pnpm dev:preview`.
const previewBaseURL: DynamicBaseURL = {
  allowedHosts: [
    ...env.PREVIEW_HOSTS,
    "localhost",
    "localhost:*",
    "127.0.0.1",
    "127.0.0.1:*",
  ],
  protocol: "auto",
}

export const auth = betterAuth({
  // Public origin when behind a reverse proxy; better-auth infers from the
  // request when unset.
  baseURL: env.PREVIEW_MODE ? previewBaseURL : env.BASE_URL,
  // Read from env.ts, which gives preview a default.
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
  account: {
    accountLinking: {
      // Password members never verify their email (no SMTP). The provider's
      // verified email proves the match instead.
      requireLocalEmailVerified: false,
      // Entra seldom sends email_verified. One tenant, whose admin sets
      // the emails, makes them safe to match.
      trustedProviders: ["microsoft"],
    },
  },
  databaseHooks: {
    account: {
      create: {
        // SSO proves who owns the email; a password account never did (an
        // invitee could type a colleague's address). So linking SSO ends the
        // password, all sessions and access tokens, before the SSO session
        // is made. An admin reset link gives the password back.
        before: async (account, ctx) => {
          if (account.providerId === "credential" || !ctx) return
          const { internalAdapter } = ctx.context
          const credential = (
            await internalAdapter.findAccounts(account.userId)
          ).find((row) => row.providerId === "credential")
          if (!credential) return
          await internalAdapter.deleteAccount(credential.id)
          await internalAdapter.deleteUserSessions(account.userId)
          await db
            .delete(schema.accessTokens)
            .where(eq(schema.accessTokens.userId, account.userId))
          // Open sockets checked the session only when they joined.
          await evictUser(rooms, account.userId)
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Registration is invite-only. Accounts are created server-side via
      // registerWithInvite/setupAdmin, which call auth.api.signUpEmail
      // directly (no ctx.request). Block the public HTTP endpoint, which
      // would otherwise let anyone self-register past the invite check.
      if (ctx.path === "/sign-up/email" && ctx.request) {
        throw new APIError("FORBIDDEN", {
          message: "Sign-up is invite-only",
        })
      }
    }),
  },
  // No cookie cache: every request reads the session row, so a deleted or
  // signed-out member loses access at once.
  user: {
    // Every new account passes here. Email sign-ups come only from the
    // invite and setup server functions (see the hook above). Any other
    // method is SSO and must pass the domain rule.
    validateUserInfo: ({ user, source }) => {
      if (source.action !== "create-user" || source.method === "email-password")
        return
      const allowed =
        user.email &&
        mayJoinWithSso(
          user.email,
          source.oauth?.providerId ?? "",
          source.oauth?.profile,
          env.SSO_ALLOWED_DOMAINS,
        )
      if (!allowed) return { error: "signup_not_allowed" }
    },
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
        returned: true,
      },
    },
  },
  advanced: {
    // Preview sits behind Coolify's proxy, whose x-forwarded-proto makes the
    // derived scheme https. allowedHosts bounds a forged x-forwarded-host.
    trustedProxyHeaders: env.PREVIEW_MODE,
  },
  plugins: [...ssoPlugins, tanstackStartCookies()],
})
