// Checks an authorization request (the query a client sends the member's
// browser to /oauth/authorize with). The consent page and its Allow and
// Cancel actions all run it, so a tampered form gets the same answer.

import type { Db } from "@/db"
import { findClient, isOurResource, redirectUriMatches } from "./grants"

export type AuthorizeParams = {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  code_challenge?: string
  code_challenge_method?: string
  state?: string
  resource?: string
  scope?: string
}

export type AuthorizeCheck =
  // No trusted redirect URI, so the member sees the error here.
  | { kind: "invalid"; message: string }
  // The client gets the error at its redirect URI.
  | { kind: "error"; redirectTo: string }
  | {
      kind: "ok"
      clientId: string
      clientName: string
      redirectUri: string
      codeChallenge: string
      state?: string
    }

/** `redirectUri` with the response parameters, plus `iss` (RFC 9207). */
export function clientRedirect(
  redirectUri: string,
  origin: string,
  params: Record<string, string | undefined>,
) {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  url.searchParams.set("iss", origin)
  return url.toString()
}

// base64url of a SHA-256 digest.
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/

export async function checkAuthorizeRequest(
  db: Db,
  params: AuthorizeParams,
  origin: string,
): Promise<AuthorizeCheck> {
  const client = params.client_id
    ? await findClient(db, params.client_id)
    : null
  if (!client) {
    return {
      kind: "invalid",
      message: "This app isn't registered with Excaliself. Add it again.",
    }
  }
  const redirectUri = params.redirect_uri
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return {
      kind: "invalid",
      message: "This app asked to return to an address it didn't register.",
    }
  }

  const fail = (error: string, description: string): AuthorizeCheck => ({
    kind: "error",
    redirectTo: clientRedirect(redirectUri, origin, {
      error,
      error_description: description,
      state: params.state,
    }),
  })
  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Only response_type=code works")
  }
  if (
    params.code_challenge_method !== "S256" ||
    !params.code_challenge ||
    !S256_CHALLENGE.test(params.code_challenge)
  ) {
    return fail("invalid_request", "PKCE with S256 is required")
  }
  if (!isOurResource(params.resource, origin)) {
    return fail("invalid_target", "Unknown resource")
  }
  return {
    kind: "ok",
    clientId: client.id,
    clientName: client.name,
    redirectUri,
    codeChallenge: params.code_challenge,
    state: params.state,
  }
}
