// OAuth 2.1 for the MCP endpoint, so clients that can't send a static
// header (Claude.ai connectors) sign in as a member. Public clients only:
// Dynamic Client Registration, authorization code + PKCE S256, rotating
// refresh tokens. A grant acts as its member under the same rule as an
// access token. Kept free of HTTP so tests drive it with a real database.

import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  notExists,
} from "drizzle-orm"
import type { Db } from "@/db"
import { oauthClients, oauthGrants, users } from "@/db/schema"
import { hashToken } from "@/features/access-tokens/tokens"

const ACCESS_PREFIX = "exo_"
const REFRESH_PREFIX = "exr_"
const CODE_TTL_MS = 5 * 60_000
export const ACCESS_TOKEN_TTL_S = 60 * 60
// Claude.ai registers a new client on every fresh connection. One no
// member ever approved is dropped after this long.
const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60_000
const LAST_USED_GRANULARITY_MS = 60_000

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

const secret = (prefix = "") =>
  `${prefix}${randomBytes(32).toString("base64url")}`

/** The MCP endpoint's URL: the resource every token is for. */
export const mcpResource = (origin: string) => `${origin}/api/mcp`

/**
 * Whether a client's `resource` (RFC 8707) names this MCP endpoint.
 * Compared in canonical form: lowercase host, no default port, no trailing
 * slash. Clients may leave it out.
 */
export function isOurResource(resource: string | undefined, origin: string) {
  if (resource === undefined) return true
  const canonical = (value: string) => {
    const url = new URL(value)
    if (url.search || url.hash) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
  }
  try {
    return canonical(resource) === canonical(mcpResource(origin))
  } catch {
    return false
  }
}

const isLoopback = (url: URL) =>
  url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)

/** HTTPS, or plain HTTP on a loopback host (a CLI's local callback). */
export function isAllowedRedirectUri(value: string) {
  try {
    const url = new URL(value)
    if (url.hash || url.username || url.password) return false
    return url.protocol === "https:" || isLoopback(url)
  } catch {
    return false
  }
}

/**
 * Exact match against a registered URI. A loopback URI matches on any port
 * (RFC 8252 §7.3): a CLI picks a free one each run.
 */
export function redirectUriMatches(registered: string[], value: string) {
  if (registered.includes(value)) return true
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (!isLoopback(url)) return false
  return registered.some((entry) => {
    const candidate = new URL(entry)
    return (
      isLoopback(candidate) &&
      candidate.hostname === url.hostname &&
      candidate.pathname === url.pathname &&
      candidate.search === url.search
    )
  })
}

/** Registers a client (RFC 7591) and drops old ones nobody approved. */
export async function registerClient(
  db: Db,
  input: { name: string; redirectUris: string[] },
) {
  const now = new Date()
  await db
    .delete(oauthClients)
    .where(
      and(
        lt(
          oauthClients.createdAt,
          new Date(now.getTime() - UNUSED_CLIENT_TTL_MS),
        ),
        notExists(
          db
            .select({ id: oauthGrants.id })
            .from(oauthGrants)
            .where(eq(oauthGrants.clientId, oauthClients.id)),
        ),
      ),
    )
  const [client] = await db
    .insert(oauthClients)
    .values({ id: randomUUID(), ...input, createdAt: now })
    .returning()
  return client
}

export async function findClient(db: Db, id: string) {
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, id))
  return client ?? null
}

/**
 * Records a member's consent and returns the one-time code for it. The
 * client trades the code for tokens with `exchangeCode`.
 */
export async function createGrant(
  db: Db,
  input: {
    userId: string
    clientId: string
    redirectUri: string
    codeChallenge: string
  },
) {
  const now = new Date()
  // Codes nobody traded in are dead weight.
  await db
    .delete(oauthGrants)
    .where(
      and(
        isNull(oauthGrants.refreshTokenHash),
        lt(oauthGrants.codeExpiresAt, now),
      ),
    )
  const code = secret()
  await db.insert(oauthGrants).values({
    id: randomUUID(),
    ...input,
    codeHash: hashToken(code),
    codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS),
    createdAt: now,
  })
  return code
}

export type TokenPair = { accessToken: string; refreshToken: string }

// `exr_<grant id>.<secret>`: a spent refresh token still names its grant.
const REFRESH_TOKEN = /^exr_([0-9a-f-]{36})\.[\w-]+$/

function newTokens(now: Date, grantId: string) {
  const tokens: TokenPair = {
    accessToken: secret(ACCESS_PREFIX),
    refreshToken: `${REFRESH_PREFIX}${grantId}.${secret()}`,
  }
  const columns = {
    accessTokenHash: hashToken(tokens.accessToken),
    accessTokenExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
    refreshTokenHash: hashToken(tokens.refreshToken),
  }
  return { tokens, columns }
}

const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url")

/**
 * Trades a code for tokens. The code works once, for its client, redirect
 * URI, and PKCE verifier; anything else burns it. Null means invalid_grant.
 */
export async function exchangeCode(
  db: Db,
  input: {
    code: string
    clientId: string
    redirectUri: string
    codeVerifier: string
  },
): Promise<TokenPair | null> {
  const now = new Date()
  // One statement: two racing requests can't both spend the code.
  const [grant] = await db
    .update(oauthGrants)
    .set({ codeHash: null })
    .where(
      and(
        eq(oauthGrants.codeHash, hashToken(input.code)),
        gt(oauthGrants.codeExpiresAt, now),
      ),
    )
    .returning({
      id: oauthGrants.id,
      clientId: oauthGrants.clientId,
      redirectUri: oauthGrants.redirectUri,
      codeChallenge: oauthGrants.codeChallenge,
    })
  if (!grant) return null
  const valid =
    grant.clientId === input.clientId &&
    grant.redirectUri === input.redirectUri &&
    s256(input.codeVerifier) === grant.codeChallenge
  if (!valid) {
    await db.delete(oauthGrants).where(eq(oauthGrants.id, grant.id))
    return null
  }
  const { tokens, columns } = newTokens(now, grant.id)
  await db.update(oauthGrants).set(columns).where(eq(oauthGrants.id, grant.id))
  return tokens
}

/**
 * Rotates both tokens. The old refresh token stops working at once, as
 * OAuth 2.1 asks for public clients. Null means invalid_grant.
 */
export async function refreshTokens(
  db: Db,
  input: { refreshToken: string; clientId: string },
): Promise<TokenPair | null> {
  const grantId = REFRESH_TOKEN.exec(input.refreshToken)?.[1]
  if (!grantId) return null
  const ofClient = and(
    eq(oauthGrants.id, grantId),
    eq(oauthGrants.clientId, input.clientId),
  )
  const { tokens, columns } = newTokens(new Date(), grantId)
  const rotated = await db
    .update(oauthGrants)
    .set(columns)
    .where(
      and(
        ofClient,
        eq(oauthGrants.refreshTokenHash, hashToken(input.refreshToken)),
      ),
    )
    .returning({ id: oauthGrants.id })
  if (rotated.length > 0) return tokens
  // A spent token came back, so two parties hold this grant's tokens. We
  // can't tell which one is the thief, so the grant ends (RFC 9700 §4.14.2).
  await db
    .delete(oauthGrants)
    .where(and(ofClient, isNotNull(oauthGrants.refreshTokenHash)))
  return null
}

/** The member an OAuth access token acts as, `client` being the app's name, or null. */
export async function memberForOAuthToken(db: Db, token: string) {
  if (!token.startsWith(ACCESS_PREFIX)) return null
  const now = new Date()
  const [row] = await db
    .select({
      grantId: oauthGrants.id,
      lastUsedAt: oauthGrants.lastUsedAt,
      member: {
        id: users.id,
        name: users.name,
        email: users.email,
        client: oauthClients.name,
      },
    })
    .from(oauthGrants)
    .innerJoin(users, eq(users.id, oauthGrants.userId))
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(
      and(
        eq(oauthGrants.accessTokenHash, hashToken(token)),
        gt(oauthGrants.accessTokenExpiresAt, now),
      ),
    )
  if (!row) return null
  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS
  ) {
    await db
      .update(oauthGrants)
      .set({ lastUsedAt: now })
      .where(eq(oauthGrants.id, row.grantId))
  }
  return row.member
}

/** A member's connected apps: grants whose code was traded for tokens. */
export async function listGrants(db: Db, userId: string) {
  const rows = await db
    .select({
      id: oauthGrants.id,
      clientName: oauthClients.name,
      redirectUri: oauthGrants.redirectUri,
      lastUsedAt: oauthGrants.lastUsedAt,
      createdAt: oauthGrants.createdAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
    .where(
      and(
        eq(oauthGrants.userId, userId),
        isNotNull(oauthGrants.refreshTokenHash),
      ),
    )
    .orderBy(desc(oauthGrants.createdAt))
  return rows.map(({ redirectUri, ...row }) => ({
    ...row,
    redirectHost: new URL(redirectUri).host,
  }))
}

/** Revokes one of `userId`'s own grants; anyone else's id is "not found". */
export async function revokeGrant(db: Db, userId: string, id: string) {
  const revoked = await db
    .delete(oauthGrants)
    .where(and(eq(oauthGrants.id, id), eq(oauthGrants.userId, userId)))
    .returning({ id: oauthGrants.id })
  if (revoked.length === 0) throw new Error("App not found")
}
