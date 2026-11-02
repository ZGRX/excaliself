import type { BetterAuthOptions } from "better-auth"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import { env } from "@/env"

export type SsoProvider = { id: "google" | "microsoft" | "oidc"; name: string }

// A provider's settings as non-optional strings, or null when none are set.
// Throws on a partial set, so a typo fails at boot instead of at sign-in.
function configured<T extends Record<string, string | undefined>>(
  values: T,
): { [K in keyof T]: string } | null {
  const names = Object.keys(values)
  const missing = names.filter((name) => !values[name])
  if (missing.length === names.length) return null
  if (missing.length > 0) throw new Error(`Set ${missing.join(", ")} too`)
  return values as { [K in keyof T]: string }
}

// Each PR preview has its own host, so no redirect URI could be registered.
const ssoEnv: Partial<typeof env> = env.PREVIEW_MODE ? {} : env

const google = configured({
  GOOGLE_CLIENT_ID: ssoEnv.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: ssoEnv.GOOGLE_CLIENT_SECRET,
})
const microsoft = configured({
  MICROSOFT_CLIENT_ID: ssoEnv.MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: ssoEnv.MICROSOFT_CLIENT_SECRET,
  MICROSOFT_TENANT_ID: ssoEnv.MICROSOFT_TENANT_ID,
})
const oidc = configured({
  OIDC_ISSUER: ssoEnv.OIDC_ISSUER,
  OIDC_CLIENT_ID: ssoEnv.OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET: ssoEnv.OIDC_CLIENT_SECRET,
})

export const socialProviders: BetterAuthOptions["socialProviders"] = {
  ...(google && {
    google: {
      clientId: google.GOOGLE_CLIENT_ID,
      clientSecret: google.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  }),
  ...(microsoft && {
    microsoft: {
      clientId: microsoft.MICROSOFT_CLIENT_ID,
      clientSecret: microsoft.MICROSOFT_CLIENT_SECRET,
      tenantId: microsoft.MICROSOFT_TENANT_ID,
    },
  }),
}

// Registers as a social provider with id "oidc": same sign-in and
// /api/auth/callback/oidc endpoints as Google.
export const ssoPlugins = oidc
  ? [
      genericOAuth({
        config: [
          {
            providerId: "oidc",
            discoveryUrl: `${oidc.OIDC_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`,
            clientId: oidc.OIDC_CLIENT_ID,
            clientSecret: oidc.OIDC_CLIENT_SECRET,
            scopes: ["openid", "email", "profile"],
          },
        ],
      }),
    ]
  : []

// The sign-in buttons, in display order.
export const ssoProviders: SsoProvider[] = [
  ...(google ? [{ id: "google" as const, name: "Google" }] : []),
  ...(microsoft ? [{ id: "microsoft" as const, name: "Microsoft" }] : []),
  ...(oidc ? [{ id: "oidc" as const, name: env.OIDC_NAME }] : []),
]

/**
 * Whether a first SSO sign-in may create an account. Existing members always
 * sign in; everyone else needs an invite.
 */
export function mayJoinWithSso(
  email: string,
  providerId: string,
  profile: Record<string, unknown> | undefined,
  allowedDomains: readonly string[],
) {
  const domain = email.toLowerCase().split("@")[1]
  if (!domain || !allowedDomains.includes(domain)) return false
  // A personal Google account can have any address; hd marks a Workspace one.
  if (providerId === "google") return profile?.hd === domain
  // Microsoft is pinned to one tenant, and OIDC is the admin's own provider.
  return true
}
