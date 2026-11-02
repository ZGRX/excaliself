"use server"

import { createServerFn } from "@tanstack/react-start"
import { env } from "@/env"
import { ssoProviders } from "./sso"

// What the sign-in pages offer besides the password form. previewMode adds
// one-click preview sign-in links.
export const getSignInOptions = createServerFn({ method: "GET" }).handler(
  () => ({
    previewMode: env.PREVIEW_MODE,
    ssoProviders,
    ssoAllowedDomains: ssoProviders.length > 0 ? env.SSO_ALLOWED_DOMAINS : [],
  }),
)

export type SignInOptions = Awaited<ReturnType<typeof getSignInOptions>>
