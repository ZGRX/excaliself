// Personal access tokens. A token acts as the member who made it, under the
// same Space rule as their browser session. Kept out of server.ts so the MCP
// route can use it without the server-function wrappers.

import { createHash, randomBytes, randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import type { Db } from "@/db"
import { accessTokens, users } from "@/db/schema"

// Marks the string as an Excaliself token, for people and secret scanners.
const PREFIX = "exs_"
// lastUsedAt is written at most this often, not on every request.
const LAST_USED_GRANULARITY_MS = 60_000

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")

/** Returns the token itself: the only time it exists outside the client. */
export async function createAccessToken(db: Db, userId: string, name: string) {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`
  const id = randomUUID()
  await db.insert(accessTokens).values({
    id,
    userId,
    name,
    tokenHash: hashToken(token),
    start: token.slice(0, PREFIX.length + 4),
    createdAt: new Date(),
  })
  return { id, token }
}

export function listAccessTokens(db: Db, userId: string) {
  return db
    .select({
      id: accessTokens.id,
      name: accessTokens.name,
      start: accessTokens.start,
      lastUsedAt: accessTokens.lastUsedAt,
      createdAt: accessTokens.createdAt,
    })
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(desc(accessTokens.createdAt))
}

/** Revokes one of `userId`'s own tokens; anyone else's id is "not found". */
export async function revokeAccessToken(db: Db, userId: string, id: string) {
  const revoked = await db
    .delete(accessTokens)
    .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)))
    .returning({ id: accessTokens.id })
  if (revoked.length === 0) throw new Error("Token not found")
}

/** The member a token acts as, or null when it is unknown or revoked. */
export async function memberForToken(db: Db, token: string) {
  if (!token.startsWith(PREFIX)) return null
  const [row] = await db
    .select({
      tokenId: accessTokens.id,
      lastUsedAt: accessTokens.lastUsedAt,
      member: { id: users.id, name: users.name, email: users.email },
    })
    .from(accessTokens)
    .innerJoin(users, eq(users.id, accessTokens.userId))
    .where(eq(accessTokens.tokenHash, hashToken(token)))
  if (!row) return null
  const now = new Date()
  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS
  ) {
    await db
      .update(accessTokens)
      .set({ lastUsedAt: now })
      .where(eq(accessTokens.id, row.tokenId))
  }
  return row.member
}
