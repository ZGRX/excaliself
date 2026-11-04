"use server"

import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { z } from "zod"
import { db } from "@/db"
import { authMiddleware } from "@/middleware/auth"
import { checkAuthorizeRequest, clientRedirect } from "./authorize"
import { originOf } from "./endpoints"
import { createGrant, listGrants, revokeGrant } from "./grants"

// The consent page and the Settings list. Each acts for the signed-in
// member only. Allow and Cancel are POSTs, so TanStack Start's CSRF check
// (Sec-Fetch-Site or Origin must be this site) guards them.

const authorizeParams = z.object({
  response_type: z.string().optional(),
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  state: z.string().optional(),
  resource: z.string().optional(),
  scope: z.string().optional(),
})

const check = (data: z.infer<typeof authorizeParams>) =>
  checkAuthorizeRequest(db, data, originOf(getRequest()))

export const getAuthorizeRequest = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(authorizeParams)
  .handler(async ({ data, context }) => {
    const result = await check(data)
    if (result.kind !== "ok") return result
    const { name, email } = context.session.user
    return {
      kind: "consent" as const,
      clientName: result.clientName,
      redirectHost: new URL(result.redirectUri).host,
      member: { name, email },
    }
  })

/** Allow: a one-time code for the client, at its redirect URI. */
export const approveAuthorize = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(authorizeParams)
  .handler(async ({ data, context }) => {
    const result = await check(data)
    if (result.kind === "invalid") throw new Error(result.message)
    if (result.kind === "error") return { redirectTo: result.redirectTo }
    const code = await createGrant(db, {
      userId: context.session.user.id,
      clientId: result.clientId,
      redirectUri: result.redirectUri,
      codeChallenge: result.codeChallenge,
    })
    return {
      redirectTo: clientRedirect(result.redirectUri, originOf(getRequest()), {
        code,
        state: result.state,
      }),
    }
  })

/** Cancel: tells the client the member said no. */
export const denyAuthorize = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(authorizeParams)
  .handler(async ({ data }) => {
    const result = await check(data)
    if (result.kind === "invalid") throw new Error(result.message)
    if (result.kind === "error") return { redirectTo: result.redirectTo }
    return {
      redirectTo: clientRedirect(result.redirectUri, originOf(getRequest()), {
        error: "access_denied",
        state: result.state,
      }),
    }
  })

export const getConnectedApps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(({ context }) => listGrants(db, context.session.user.id))

export const disconnectApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(({ data, context }) =>
    revokeGrant(db, context.session.user.id, data.id),
  )
