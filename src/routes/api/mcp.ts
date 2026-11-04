// The MCP endpoint (Streamable HTTP) a member's AI client connects to.
//
// Auth is a bearer token only, never the session cookie: another site can
// make a browser send the cookie, but it can't know a token. That is also
// why no Origin check is needed. The token is a static access token from
// Settings, or an OAuth access token (features/oauth). The 401 points OAuth
// clients at the discovery metadata.

import { createMcpHandler } from "@modelcontextprotocol/server"
import { createFileRoute } from "@tanstack/react-router"
import { db } from "@/db"
import { memberForToken } from "@/features/access-tokens/tokens"
import { createMcpServer, type Member } from "@/features/mcp/tools"
import {
  originOf,
  protectedResourceMetadataUrl,
} from "@/features/oauth/endpoints"
import { memberForOAuthToken } from "@/features/oauth/grants"

type Caller = { member: Member; origin: string }

// Stateless: every request gets a fresh server for the member it carries.
const handler = createMcpHandler(({ authInfo }) => {
  // mcpHandler always passes authInfo, so a missing one is a bug.
  if (!authInfo?.extra) throw new Error("MCP request without a caller")
  const { member, origin } = authInfo.extra as Caller
  return createMcpServer(db, member, origin)
})

// RFC 9728 §5.1. error="invalid_token" only when a token was sent (RFC 6750).
function unauthorized(origin: string, sentToken: boolean): Response {
  const metadata = `resource_metadata="${protectedResourceMetadataUrl(origin)}"`
  return Response.json(
    {
      error: "invalid_token",
      error_description:
        "Sign in with OAuth, or send an Excaliself access token as Authorization: Bearer <token>. Make one in Settings, under MCP.",
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": sentToken
          ? `Bearer error="invalid_token", ${metadata}`
          : `Bearer ${metadata}`,
      },
    },
  )
}

export async function mcpHandler(request: Request): Promise<Response> {
  const origin = originOf(request)
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return unauthorized(origin, false)
  const staticMember = await memberForToken(db, token)
  const member = staticMember ?? (await memberForOAuthToken(db, token))
  if (!member) return unauthorized(origin, true)

  const caller: Caller = { member, origin }
  return handler.fetch(request, {
    authInfo: {
      token,
      clientId: staticMember ? "access-token" : "oauth",
      scopes: [],
      extra: caller,
    },
  })
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => mcpHandler(request),
      POST: ({ request }) => mcpHandler(request),
      DELETE: ({ request }) => mcpHandler(request),
    },
  },
})
