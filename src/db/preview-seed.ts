import { hashPassword } from "better-auth/crypto"
import { hashToken } from "@/features/access-tokens/tokens"
import { extractSceneText } from "@/features/drawings/search"
import {
  demoAccessToken,
  demoAdmin,
  demoDrawings,
  demoFolders,
} from "./demo-content.ts"
import type { Db } from "./index.ts"
import * as schema from "./schema.ts"

export type PreviewUser = {
  id: string
  name: string
  email: string
  password: string
  role: "admin" | "user"
}

/** A user who signs in with email and password, as better-auth stores one. */
export async function insertPreviewUser(db: Db, user: PreviewUser) {
  const { password, ...row } = user
  await db.insert(schema.users).values({ ...row, emailVerified: true })
  await db.insert(schema.accounts).values({
    id: `${user.id}-credential`,
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password: await hashPassword(password),
  })
}

/**
 * An admin, so the instance is past /setup, with a public MCP token, and
 * drawings to fill Home.
 */
export async function seedDemoContent(db: Db) {
  await insertPreviewUser(db, { ...demoAdmin, role: "admin" })
  await db.insert(schema.accessTokens).values({
    id: "demo-access-token",
    userId: demoAdmin.id,
    name: "Preview (public)",
    tokenHash: hashToken(demoAccessToken),
    start: demoAccessToken.slice(0, 8),
  })
  // Parents come first in demoFolders, so one insert satisfies the self-FK.
  await db
    .insert(schema.folders)
    .values(
      demoFolders.map((folder) => ({ ...folder, createdBy: demoAdmin.id })),
    )
  for (const { elements, minutesAgo, starred, ...drawing } of demoDrawings) {
    const data = JSON.stringify({ elements, appState: {} })
    const editedAt = new Date(Date.now() - minutesAgo * 60_000)
    await db.insert(schema.drawings).values({
      ...drawing,
      data,
      searchText: extractSceneText(data),
      createdBy: demoAdmin.id,
      createdAt: editedAt,
      updatedAt: editedAt,
    })
    if (starred) {
      await db
        .insert(schema.stars)
        .values({ userId: demoAdmin.id, drawingId: drawing.id })
    }
  }
}
