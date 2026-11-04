// The OAuth HTTP endpoints an MCP client calls without a browser: discovery
// metadata, client registration, and the token endpoint. Each takes the
// database, so tests call them with a real one.

import { z } from "zod"
import type { Db } from "@/db"
import { env } from "@/env"
import { clientIpKey, socketIpOf } from "@/lib/client-ip"
import { createRateLimiter } from "@/lib/rate-limit"
import { resolveOrigin } from "@/lib/site-origin"
import {
  ACCESS_TOKEN_TTL_S,
  exchangeCode,
  isAllowedRedirectUri,
  isOurResource,
  mcpResource,
  refreshTokens,
  registerClient,
  type TokenPair,
} from "./grants"

/** The instance's public origin: the OAuth issuer. */
export const originOf = (request: Request) =>
  resolveOrigin({
    baseUrl: env.BASE_URL,
    headers: request.headers,
    requestUrl: request.url,
  })

export const protectedResourceMetadataUrl = (origin: string) =>
  `${origin}/.well-known/oauth-protected-resource/api/mcp`

// Browser-based clients (the MCP Inspector) read these cross-origin. None
// of them uses cookies.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, MCP-Protocol-Version",
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store" },
  })

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status)

export const preflight = () =>
  new Response(null, { status: 204, headers: CORS })

/** RFC 9728: where the MCP endpoint's tokens come from. */
export function protectedResourceMetadata(request: Request) {
  const origin = originOf(request)
  return json({
    resource: mcpResource(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "Excaliself",
  })
}

/** RFC 8414. The issuer is the bare origin. */
export function authorizationServerMetadata(request: Request) {
  const origin = originOf(request)
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  })
}

// Bounded: registration is open to anyone, and every row is kept a day.
const registration = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().optional(),
})

// Registration needs no account, so it is capped per IP. Claude.ai's
// connectors share a few egress IPs, so the cap is loose.
const registerLimiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000 })

/** RFC 7591 Dynamic Client Registration. Every client is public. */
export async function register(db: Db, request: Request) {
  const ip = clientIpKey({
    headers: request.headers,
    socketIp: socketIpOf(request),
  })
  if (!registerLimiter.allow(ip, Date.now())) {
    return oauthError("too_many_requests", "Try again later", 429)
  }
  const body = registration.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return oauthError(
      "invalid_client_metadata",
      "Send 1 to 10 redirect_uris of up to 2000 characters",
    )
  }
  const redirectUris = body.data.redirect_uris
  if (!redirectUris.every(isAllowedRedirectUri)) {
    return oauthError(
      "invalid_redirect_uri",
      "Redirect URIs must use https, or http on localhost",
    )
  }
  const name = body.data.client_name?.trim().slice(0, 100) || "Unnamed app"
  const client = await registerClient(db, { name, redirectUris })
  return json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  )
}

const tokenResponse = (tokens: TokenPair) =>
  json({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: tokens.refreshToken,
  })

/** The token endpoint: authorization_code and refresh_token grants. */
export async function token(db: Db, request: Request) {
  const form = await request
    .formData()
    .then((data) => new Map([...data].map(([k, v]) => [k, String(v)])))
    .catch(() => null)
  if (!form) {
    return oauthError("invalid_request", "Send a form-encoded body")
  }
  const clientId = form.get("client_id")
  if (!clientId) return oauthError("invalid_request", "Send client_id")
  if (!isOurResource(form.get("resource"), originOf(request))) {
    return oauthError("invalid_target", "Unknown resource")
  }

  const grantType = form.get("grant_type")
  if (grantType === "authorization_code") {
    const code = form.get("code")
    const redirectUri = form.get("redirect_uri")
    const codeVerifier = form.get("code_verifier")
    if (!code || !redirectUri || !codeVerifier) {
      return oauthError(
        "invalid_request",
        "Send code, redirect_uri, and code_verifier",
      )
    }
    const tokens = await exchangeCode(db, {
      code,
      clientId,
      redirectUri,
      codeVerifier,
    })
    return tokens
      ? tokenResponse(tokens)
      : oauthError("invalid_grant", "The code is invalid, used, or expired")
  }
  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token")
    if (!refreshToken)
      return oauthError("invalid_request", "Send refresh_token")
    const tokens = await refreshTokens(db, { refreshToken, clientId })
    return tokens
      ? tokenResponse(tokens)
      : oauthError("invalid_grant", "The refresh token is invalid or revoked")
  }
  return oauthError(
    "unsupported_grant_type",
    "Use authorization_code or refresh_token",
  )
}
